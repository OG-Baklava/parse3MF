/**
 * 3MF Parser — spec-compliant implementation (v2.7)
 *
 * Multicolor detection paths (checked in order):
 *  1. XML colorgroups/basematerials with triangle-level pid/p1 (standard 3MF)
 *  2. Bambu Studio: filament colors from JSON project_settings.config
 *  3. Bambu Studio: per-object/part extruder assignments from model_settings.config
 *  4. Bambu Studio: paint_color hex attributes on <triangle> elements (per-tri painting)
 *  5. Bambu Studio: filament count from JSON array lengths (e.g. 3-entry arrays = 3 filaments)
 *  6. PrusaSlicer: volume triangle ranges + per-volume extruder assignments
 *  7. Component-level pid/pindex from main model applied to external objects
 *  8. External object ID remapping with composite map fixup
 *
 * @packageDocumentation
 */

import { BufferGeometry, BufferAttribute } from 'three'
import type { ParsedThreeMF, MaterialSlot, Plate, ParsedTriangle, ParsedGeomObject } from './types'
import { calculateVolume, calculateBoundingBox } from './analyzer'
import JSZip from 'jszip'

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Thrown when a 3MF file cannot be parsed. */
export class ThreeMFParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ThreeMFParseError'
  }
}

// ---------------------------------------------------------------------------
// Internal Types
// ---------------------------------------------------------------------------

interface PropertyResource {
  id: string
  type: 'basematerials' | 'colorgroup'
  colors: string[]
  names?: string[]
}

interface BuildItem {
  objectId: number
  transform?: string
}

interface ComponentRef {
  objectId: number
  path?: string
  pid?: string
  pindex?: number
}

// ---------------------------------------------------------------------------
// XML Helper
// ---------------------------------------------------------------------------

function findElements(container: Document | Element, localName: string): Element[] {
  const found = new Set<Element>()
  const lowerName = localName.toLowerCase()

  try {
    container.querySelectorAll(localName).forEach(el => found.add(el))
  } catch { /* ignore */ }

  const allElements = container.getElementsByTagName('*')
  for (let i = 0; i < allElements.length; i++) {
    const elem = allElements[i]
    const elemLocal = (elem.localName || '').toLowerCase()
    const tagLower = elem.tagName.toLowerCase()
    if (elemLocal === lowerName || tagLower === lowerName || tagLower.endsWith(':' + lowerName)) {
      found.add(elem)
    }
  }

  return Array.from(found)
}

function normalizeColor(color: string): string {
  if (!color || color.trim() === '') return '#808080'
  let c = color.trim()
  if (!c.startsWith('#')) c = '#' + c
  if (c.length === 9) c = c.substring(0, 7) // strip alpha
  return c.toUpperCase()
}

// ---------------------------------------------------------------------------
// Resource Parsing
// ---------------------------------------------------------------------------

function parseResources(xmlDoc: Document | Element): Map<string, PropertyResource> {
  const resources = new Map<string, PropertyResource>()

  for (const bmElem of findElements(xmlDoc, 'basematerials')) {
    const id = bmElem.getAttribute('id') || bmElem.getAttribute('Id') || ''
    if (!id) continue
    const colors: string[] = []
    const names: string[] = []
    for (const base of findElements(bmElem, 'base')) {
      colors.push(normalizeColor(base.getAttribute('displaycolor') || base.getAttribute('DisplayColor') || ''))
      names.push(base.getAttribute('name') || base.getAttribute('Name') || '')
    }
    if (colors.length > 0) resources.set(id, { id, type: 'basematerials', colors, names })
  }

  for (const cgElem of findElements(xmlDoc, 'colorgroup')) {
    const id = cgElem.getAttribute('id') || cgElem.getAttribute('Id') || ''
    if (!id) continue
    const colors: string[] = []
    for (const colorElem of findElements(cgElem, 'color')) {
      const c = colorElem.getAttribute('color') || colorElem.getAttribute('Color') || ''
      if (c) colors.push(normalizeColor(c))
    }
    if (colors.length > 0) resources.set(id, { id, type: 'colorgroup', colors })
  }

  return resources
}

function resolveColor(
  pid: string | null | undefined,
  pindex: number,
  resources: Map<string, PropertyResource>,
): string | null {
  if (!pid) return null
  const resource = resources.get(pid)
  if (!resource) return null
  if (pindex < 0 || pindex >= resource.colors.length) return null
  return resource.colors[pindex]
}

// ---------------------------------------------------------------------------
// Object Parsing
// ---------------------------------------------------------------------------

function parseGeometryObjects(
  xmlDoc: Document | Element,
  resources: Map<string, PropertyResource>,
  defaultColor?: string | null,
): ParsedGeomObject[] {
  const objects: ParsedGeomObject[] = []

  for (const objElem of findElements(xmlDoc, 'object')) {
    const type = objElem.getAttribute('type')
    if (type && type !== 'model') continue

    const id = parseInt(objElem.getAttribute('id') || '0')
    const name = objElem.getAttribute('name') || objElem.getAttribute('Name') || `Object ${id}`

    const objPid = objElem.getAttribute('pid') || null
    const objPindexStr = objElem.getAttribute('pindex')
    const objPindex = objPindexStr !== null ? parseInt(objPindexStr) : 0
    const objDefaultColor = resolveColor(objPid, objPindex, resources) || defaultColor || null

    const meshElems = findElements(objElem, 'mesh')
    if (meshElems.length === 0) continue

    const meshElem = meshElems[0]
    const vertices: number[] = []
    for (const v of findElements(meshElem, 'vertex')) {
      vertices.push(
        parseFloat(v.getAttribute('x') || '0'),
        parseFloat(v.getAttribute('y') || '0'),
        parseFloat(v.getAttribute('z') || '0'),
      )
    }
    if (vertices.length === 0) continue

    const triangles: ParsedTriangle[] = []
    for (const t of findElements(meshElem, 'triangle')) {
      const v1 = parseInt(t.getAttribute('v1') || '0')
      const v2 = parseInt(t.getAttribute('v2') || '0')
      const v3 = parseInt(t.getAttribute('v3') || '0')

      const triPid = t.getAttribute('pid') || null
      const p1Str = t.getAttribute('p1')
      let colorHex: string | null = null

      if (triPid && p1Str !== null) {
        colorHex = resolveColor(triPid, parseInt(p1Str), resources)
      } else if (triPid) {
        colorHex = resolveColor(triPid, 0, resources)
      }
      if (!colorHex && objDefaultColor) colorHex = objDefaultColor

      // Read BambuStudio paint_color / mmu_segmentation attribute
      let paintAttr =
        t.getAttribute('paint_color') ||
        t.getAttribute('slic3rpe:mmu_segmentation') ||
        t.getAttribute('mmu_segmentation') ||
        null
      if (!paintAttr) {
        for (let ai = 0; ai < t.attributes.length; ai++) {
          const aName = t.attributes[ai].name.toLowerCase()
          if (aName.includes('paint_color') || aName.includes('mmu_segmentation')) {
            paintAttr = t.attributes[ai].value
            break
          }
        }
      }

      triangles.push({ v1, v2, v3, colorHex, paintAttr: paintAttr || undefined })
    }

    if (vertices.length > 0 && triangles.length > 0) {
      objects.push({ id, name, vertices, triangles })
    }
  }

  return objects
}

function parseComponents(objElem: Element): ComponentRef[] {
  const components: ComponentRef[] = []
  const seen = new Set<Element>()

  const compElems = [
    ...Array.from(objElem.querySelectorAll('components > component')),
    ...findElements(objElem, 'component'),
  ]

  for (const comp of compElems) {
    if (seen.has(comp)) continue
    seen.add(comp)

    const objectId = parseInt(comp.getAttribute('objectid') || '0')
    if (objectId <= 0) continue

    let path: string | undefined
    for (let i = 0; i < comp.attributes.length; i++) {
      const attr = comp.attributes[i]
      if (attr.localName === 'path' || attr.name.endsWith(':path')) {
        path = attr.value
        break
      }
    }

    const pid = comp.getAttribute('pid') || undefined
    const pindex = pid ? parseInt(comp.getAttribute('pindex') || '0') : undefined

    components.push({ objectId, path, pid, pindex })
  }

  return components
}

// ---------------------------------------------------------------------------
// Bambu Studio / Slicer Metadata
// ---------------------------------------------------------------------------

async function extractFilamentColors(
  zipContent: JSZip,
): Promise<{ colors: string[]; filamentCount: number }> {
  let filamentCount = 0

  // Source 1: project_settings.config (JSON in Bambu Studio)
  for (const path of ['Metadata/project_settings.config', 'Metadata/Project_settings.config']) {
    const file = zipContent.file(path)
    if (!file) continue
    try {
      const content = await file.async('text')
      const trimmed = content.trim()

      if (trimmed.startsWith('{')) {
        try {
          const json = JSON.parse(trimmed)
          for (const key of Object.keys(json)) {
            if (Array.isArray(json[key]) && json[key].length > 1) {
              filamentCount = Math.max(filamentCount, json[key].length)
            }
          }

          const colorKey = Object.keys(json).find(
            (k) => k.toLowerCase() === 'filament_colour' || k.toLowerCase() === 'filament_color',
          )

          if (colorKey) {
            let rawColors: string[] = []
            const val = json[colorKey]
            if (Array.isArray(val)) {
              rawColors = val.map((c: string) => String(c).trim()).filter((c: string) => c.length > 0)
            } else if (typeof val === 'string') {
              rawColors = val
                .split(';')
                .map((c: string) => c.trim())
                .filter((c: string) => c.length > 0)
            }
            const colors = rawColors.map((c) => normalizeColor(c))
            if (colors.length > 0)
              return { colors, filamentCount: Math.max(filamentCount, colors.length) }
          }

          if (filamentCount > 1) return { colors: [], filamentCount }
        } catch {
          /* try INI fallback */
        }
      }

      const match = content.match(/filament_colou?r\s*=\s*(.+)/i)
      if (match) {
        const raw = match[1]
          .split(';')
          .map((c) => c.trim())
          .filter((c) => c.length > 0)
        const colors = raw.map((c) => normalizeColor(c))
        if (colors.length > 0) return { colors, filamentCount: Math.max(filamentCount, colors.length) }
      }
    } catch {
      /* ignore */
    }
  }

  // Source 2: slice_info.config
  const sliceInfoFile = zipContent.file('Metadata/slice_info.config')
  if (sliceInfoFile) {
    try {
      const content = await sliceInfoFile.async('text')
      const parser = new DOMParser()
      const doc = parser.parseFromString(content, 'text/xml')
      const colors: string[] = []
      for (const f of findElements(doc, 'filament')) {
        const c = f.getAttribute('color') || f.getAttribute('Color') || ''
        if (c && c.trim()) colors.push(normalizeColor(c))
      }
      const unique = [...new Set(colors)]
      if (unique.length > 0) return { colors: unique, filamentCount: Math.max(filamentCount, unique.length) }
    } catch {
      /* ignore */
    }
  }

  // Source 3: Any other .config file
  const configFiles = Object.keys(zipContent.files).filter(
    (f) => f.endsWith('.config') && !f.includes('model_settings'),
  )
  for (const path of configFiles) {
    try {
      const content = await zipContent.file(path)?.async('text')
      if (!content) continue
      const trimmed = content.trim()
      if (trimmed.startsWith('{')) {
        try {
          const json = JSON.parse(trimmed)
          const colorKey = Object.keys(json).find(
            (k) => k.toLowerCase() === 'filament_colour' || k.toLowerCase() === 'filament_color',
          )
          if (colorKey) {
            let rawColors: string[] = []
            const val = json[colorKey]
            if (Array.isArray(val)) {
              rawColors = val.map((c: string) => String(c).trim()).filter((c: string) => c.length > 0)
            } else if (typeof val === 'string') {
              rawColors = val.split(';').map((c: string) => c.trim()).filter((c: string) => c.length > 0)
            }
            const colors = rawColors.map((c) => normalizeColor(c))
            if (colors.length > 0) return { colors, filamentCount: Math.max(filamentCount, colors.length) }
          }
        } catch {
          /* ignore */
        }
      }
      const match = content.match(/filament_colou?r\s*=\s*(.+)/i)
      if (match) {
        const raw = match[1].split(';').map((c) => c.trim()).filter((c) => c.length > 0)
        const colors = raw.map((c) => normalizeColor(c))
        if (colors.length > 0) return { colors, filamentCount: Math.max(filamentCount, colors.length) }
      }
    } catch {
      /* ignore */
    }
  }

  return { colors: [], filamentCount }
}

async function parseModelSettings(
  zipContent: JSZip,
): Promise<{
  objectExtruderMap: Map<number, number>
  hasMmuSegmentation: boolean
  distinctExtruders: Set<number>
}> {
  const objectExtruderMap = new Map<number, number>()
  let hasMmuSegmentation = false
  const distinctExtruders = new Set<number>()

  const modelSettingsFile = zipContent.file('Metadata/model_settings.config')
  if (!modelSettingsFile) return { objectExtruderMap, hasMmuSegmentation, distinctExtruders }

  try {
    const content = await modelSettingsFile.async('text')
    const parser = new DOMParser()
    const configDoc = parser.parseFromString(content, 'text/xml')
    const configObjects = findElements(configDoc, 'object')

    for (const obj of configObjects) {
      const objId = parseInt(obj.getAttribute('id') || '0')
      if (objId <= 0) continue

      const allObjMeta = new Map<string, string>()
      const partMeta = new Set<Element>()

      const parts = findElements(obj, 'part')
      for (const part of parts) {
        for (const meta of findElements(part, 'metadata')) {
          partMeta.add(meta)
          const key = meta.getAttribute('key') || ''
          const value = meta.getAttribute('value') || meta.textContent?.trim() || ''
          if (key === 'mmu_segmentation' && value.length > 0) hasMmuSegmentation = true
        }
      }

      for (const meta of findElements(obj, 'metadata')) {
        if (partMeta.has(meta)) continue
        const key = meta.getAttribute('key') || ''
        const value = meta.getAttribute('value') || meta.textContent?.trim() || ''
        allObjMeta.set(key, value)
        if (key === 'mmu_segmentation' && value.length > 0) hasMmuSegmentation = true
      }

      // Process parts (most specific)
      for (const part of parts) {
        const subObjId = parseInt(part.getAttribute('sub_object_id') || '0')
        const partIdAttr = parseInt(part.getAttribute('id') || '0')
        const targetId = subObjId || partIdAttr

        const partMetaMap = new Map<string, string>()
        for (const meta of findElements(part, 'metadata')) {
          const key = meta.getAttribute('key') || ''
          const value = meta.getAttribute('value') || meta.textContent?.trim() || ''
          partMetaMap.set(key, value)
        }

        // Check child elements
        for (const childTag of ['paint_color', 'mmu_segmentation']) {
          if (findElements(part, childTag).length > 0) hasMmuSegmentation = true
        }

        if (targetId <= 0) continue

        const extruderStr = partMetaMap.get('extruder')
        if (extruderStr !== undefined) {
          const extruder = parseInt(extruderStr)
          if (!isNaN(extruder) && extruder >= 0) {
            const effectiveExtruder = extruder === 0 ? 1 : extruder
            objectExtruderMap.set(targetId, effectiveExtruder)
            distinctExtruders.add(effectiveExtruder)
          }
        }
      }

      // Object-level extruder (fallback)
      const objExtruderStr = allObjMeta.get('extruder')
      if (objExtruderStr !== undefined) {
        const objExtruder = parseInt(objExtruderStr)
        if (!isNaN(objExtruder) && objExtruder >= 0) {
          const effectiveExtruder = objExtruder === 0 ? 1 : objExtruder
          if (!objectExtruderMap.has(objId)) {
            objectExtruderMap.set(objId, effectiveExtruder)
            distinctExtruders.add(effectiveExtruder)
          }
          for (const part of parts) {
            const subObjId = parseInt(part.getAttribute('sub_object_id') || '0')
            const partIdAttr = parseInt(part.getAttribute('id') || '0')
            const targetId = subObjId || partIdAttr
            if (targetId > 0 && !objectExtruderMap.has(targetId)) {
              objectExtruderMap.set(targetId, effectiveExtruder)
              distinctExtruders.add(effectiveExtruder)
            }
          }
        }
      }
    }

    return { objectExtruderMap, hasMmuSegmentation, distinctExtruders }
  } catch {
    return { objectExtruderMap, hasMmuSegmentation, distinctExtruders }
  }
}

async function parseBambuPlates(
  zipContent: JSZip,
): Promise<{ plates: Plate[]; plateObjectMap: Map<number, number[]> }> {
  const plates: Plate[] = []
  const plateObjectMap = new Map<number, number[]>()

  const plateFiles = Object.keys(zipContent.files)
    .filter((f) => /Metadata\/plate_\d+\.json/i.test(f))
    .sort()

  if (plateFiles.length > 0) {
    for (const platePath of plateFiles) {
      try {
        const content = await zipContent.file(platePath)?.async('text')
        if (!content) continue
        const plateData = JSON.parse(content)
        const plateNum = parseInt(platePath.match(/plate_(\d+)/)?.[1] || '0')
        if (plateNum <= 0) continue

        const objectIds: number[] = []
        if (Array.isArray(plateData)) {
          plateData.forEach((item: any) => {
            if (item.id !== undefined) objectIds.push(item.id)
          })
        } else if (plateData.objects) {
          plateData.objects.forEach((item: any) => {
            if (item.id !== undefined) objectIds.push(item.id)
          })
        }

        plates.push({ id: plateNum, name: `Plate ${plateNum}`, objectIds })
        plateObjectMap.set(plateNum, objectIds)
      } catch {
        /* ignore */
      }
    }
  }

  if (plates.length === 0) {
    const filamentSeqFile = zipContent.file('Metadata/filament_sequence.json')
    if (filamentSeqFile) {
      try {
        const content = await filamentSeqFile.async('text')
        const seq = JSON.parse(content)
        const plateKeys = Object.keys(seq).filter((k) => k.startsWith('plate_'))
        for (const key of plateKeys) {
          const plateNum = parseInt(key.replace('plate_', '')) || 0
          if (plateNum > 0) {
            plates.push({ id: plateNum, name: `Plate ${plateNum}`, objectIds: [] })
            plateObjectMap.set(plateNum, [])
          }
        }
      } catch {
        /* ignore */
      }
    }
  }

  return { plates, plateObjectMap }
}

async function parsePrusaSlicerMetadata(
  zipContent: JSZip,
): Promise<{
  volumeRanges: Array<{ firstid: number; lastid: number; extruder: number }>
  extruderColors: string[]
}> {
  const volumeRanges: Array<{ firstid: number; lastid: number; extruder: number }> = []
  const extruderColors: string[] = []

  const configFiles = Object.keys(zipContent.files).filter(
    (f) => f.includes('Slic3r') && f.endsWith('.config'),
  )
  if (configFiles.length === 0) return { volumeRanges, extruderColors }

  const modelConfigFile = configFiles.find((f) => f.includes('model'))
  if (modelConfigFile) {
    try {
      const content = await zipContent.file(modelConfigFile)?.async('text')
      if (content) {
        const parser = new DOMParser()
        const configDoc = parser.parseFromString(content, 'text/xml')
        configDoc.querySelectorAll('volume').forEach((volume) => {
          const firstid = parseInt(volume.getAttribute('firstid') || '-1')
          const lastid = parseInt(volume.getAttribute('lastid') || '-1')
          if (firstid < 0 || lastid < 0) return
          let extruder = 1
          for (const meta of Array.from(volume.querySelectorAll('metadata'))) {
            if (meta.getAttribute('key') === 'extruder') {
              extruder = parseInt(meta.getAttribute('value') || meta.textContent || '1')
            }
          }
          volumeRanges.push({ firstid, lastid, extruder })
        })
      }
    } catch {
      /* ignore */
    }
  }

  for (const configFile of configFiles) {
    if (configFile === modelConfigFile) continue
    try {
      const content = await zipContent.file(configFile)?.async('text')
      if (!content) continue
      const match = content.match(/extruder_colou?r\s*=\s*(.+)/i)
      if (match) {
        extruderColors.push(...match[1].split(';').map((c) => normalizeColor(c.trim())))
        break
      }
    } catch {
      /* ignore */
    }
  }

  return { volumeRanges, extruderColors }
}

// ---------------------------------------------------------------------------
// Paint Color / MMU Segmentation Decoder
// ---------------------------------------------------------------------------

function paintHexToBits(hexStr: string): number[] {
  const bits: number[] = []
  for (let i = hexStr.length - 1; i >= 0; i--) {
    const ch = hexStr.charCodeAt(i)
    let dec = 0
    if (ch >= 48 && ch <= 57) dec = ch - 48
    else if (ch >= 65 && ch <= 70) dec = 10 + ch - 65
    else if (ch >= 97 && ch <= 102) dec = 10 + ch - 97
    for (let b = 0; b < 4; b++) bits.push((dec >> b) & 1)
  }
  return bits
}

function decodePaintTreeNode(bits: number[], pos: { i: number }, depth: number): number {
  if (pos.i + 1 >= bits.length || depth > 20) return 0

  const splitSides = bits[pos.i] + bits[pos.i + 1] * 2
  pos.i += 2

  if (splitSides > 0) {
    if (pos.i + 1 >= bits.length) return 0
    pos.i += 2 // skip special_side

    const childStates: number[] = []
    for (let c = splitSides; c >= 0; c--) {
      childStates.push(decodePaintTreeNode(bits, pos, depth + 1))
    }

    const counts = new Map<number, number>()
    for (const s of childStates) {
      if (s > 0) counts.set(s, (counts.get(s) || 0) + 1)
    }
    let best = 0,
      bestCount = 0
    counts.forEach((count, state) => {
      if (count > bestCount) {
        bestCount = count
        best = state
      }
    })
    return best
  } else {
    if (pos.i + 1 >= bits.length) return 0
    const xx = bits[pos.i] + bits[pos.i + 1] * 2
    pos.i += 2

    if (xx < 3) return xx

    let n = 0
    while (pos.i + 3 < bits.length) {
      let nibble = 0
      for (let b = 0; b < 4; b++) nibble |= bits[pos.i + b] << b
      pos.i += 4
      if (nibble === 15) {
        n += 15
      } else {
        n += nibble
        break
      }
    }
    return 3 + n
  }
}

function decodePaintColorAttr(hexStr: string): number {
  if (!hexStr || hexStr.length === 0) return 0
  const bits = paintHexToBits(hexStr)
  const pos = { i: 0 }
  return decodePaintTreeNode(bits, pos, 0)
}

// ---------------------------------------------------------------------------
// Main Parser
// ---------------------------------------------------------------------------

/**
 * Parse a `.3MF` file into geometry, colors, plates, and material slots.
 *
 * Works with files exported from **Bambu Studio**, **PrusaSlicer**, **Cura**,
 * and any other slicer that follows the 3MF Core Specification.
 *
 * @param file  A `File` object (e.g. from an `<input type="file">`)
 * @returns     A {@link ParsedThreeMF} containing everything needed to render
 *              the model.
 *
 * @example
 * ```ts
 * import { parse3MF } from 'parse3mf/core'
 *
 * const result = await parse3MF(myFile)
 * console.log(result.isMultiColor) // true
 * console.log(result.materialSlots) // [{ id: '#FF0000', name: 'Color 1', ... }, ...]
 * ```
 */
export async function parse3MF(file: File): Promise<ParsedThreeMF> {
  try {
    const arrayBuffer = await file.arrayBuffer()
    const zip = new JSZip()
    const zipContent = await zip.loadAsync(arrayBuffer)
    const zipFiles = Object.keys(zipContent.files)

    // -----------------------------------------------------------------------
    // Step 1: Find main model file
    // -----------------------------------------------------------------------
    let mainModelPath = '3D/3dmodel.model'
    let mainModelFile = zipContent.file(mainModelPath)
    if (!mainModelFile) {
      mainModelPath = '3D/3dModel.model'
      mainModelFile = zipContent.file(mainModelPath)
    }
    if (!mainModelFile) {
      const modelFiles = zipFiles.filter((f) => f.endsWith('.model') && f.startsWith('3D/'))
      if (modelFiles.length > 0) {
        mainModelPath = modelFiles[0]
        mainModelFile = zipContent.file(mainModelPath)
      }
    }
    if (!mainModelFile) throw new ThreeMFParseError('Invalid .3MF file: no model file found')

    const mainXML = await mainModelFile.async('text')
    const domParser = new DOMParser()
    const mainDoc = domParser.parseFromString(mainXML, 'text/xml')

    // -----------------------------------------------------------------------
    // Step 2: Parse resources
    // -----------------------------------------------------------------------
    const mainResources = parseResources(mainDoc)

    // -----------------------------------------------------------------------
    // Step 3: Build section + composites
    // -----------------------------------------------------------------------
    const buildItems: BuildItem[] = []
    const buildElems = findElements(mainDoc, 'build')
    if (buildElems.length > 0) {
      for (const item of findElements(buildElems[0], 'item')) {
        const objectId = parseInt(item.getAttribute('objectid') || '0')
        if (objectId > 0) {
          buildItems.push({ objectId, transform: item.getAttribute('transform') || undefined })
        }
      }
    }

    const compositeToGeometryMap = new Map<number, number[]>()
    const componentColorOverrides = new Map<number, string>()

    for (const objElem of findElements(mainDoc, 'object')) {
      const objId = parseInt(objElem.getAttribute('id') || '0')
      if (objId <= 0) continue

      const components = parseComponents(objElem)
      if (components.length === 0) continue

      const geomIds: number[] = []
      for (const comp of components) {
        geomIds.push(comp.objectId)
        if (comp.pid) {
          const overrideColor = resolveColor(comp.pid, comp.pindex || 0, mainResources)
          if (overrideColor) componentColorOverrides.set(comp.objectId, overrideColor)
        }
      }
      compositeToGeometryMap.set(objId, geomIds)
    }

    // -----------------------------------------------------------------------
    // Step 4: Parse ALL geometry objects
    // -----------------------------------------------------------------------
    let allGeomObjects: ParsedGeomObject[] = []

    const mainGeomObjects = parseGeometryObjects(mainDoc, mainResources)
    allGeomObjects.push(...mainGeomObjects)

    const externalObjectFiles = zipFiles
      .filter((f) => f.startsWith('3D/Objects/') && f.endsWith('.model'))
      .sort()

    const externalIdRemap = new Map<number, number>()

    if (externalObjectFiles.length > 0) {
      const mainGeomIds = new Set(mainGeomObjects.map((o) => o.id))

      for (const filePath of externalObjectFiles) {
        const fileIdMatch = filePath.match(/object_(\d+)\.model/)
        const fileId = fileIdMatch ? parseInt(fileIdMatch[1]) : 0
        if (mainGeomIds.has(fileId)) continue

        const extFile = zipContent.file(filePath)
        if (!extFile) continue

        const xml = await extFile.async('text')
        const doc = domParser.parseFromString(xml, 'text/xml')

        const fileResources = parseResources(doc)
        let componentOverride = componentColorOverrides.get(fileId) || null
        if (!componentOverride) {
          for (const [compObjId, color] of componentColorOverrides) {
            if (compositeToGeometryMap.has(compObjId)) continue
            componentOverride = color
            break
          }
        }

        const mergedResources = new Map(mainResources)
        fileResources.forEach((res, id) => mergedResources.set(id, res))

        const fileObjects = parseGeometryObjects(doc, mergedResources, componentOverride)

        for (const obj of fileObjects) {
          const mappedId = fileObjects.length === 1 && fileId > 0 ? fileId : obj.id
          allGeomObjects.push({ ...obj, id: mappedId, sourceFile: filePath })
          if (mappedId !== obj.id) externalIdRemap.set(obj.id, mappedId)
        }
      }
    }

    // Fix composite map with remapped IDs
    if (externalIdRemap.size > 0) {
      compositeToGeometryMap.forEach((geomIds, compositeId) => {
        compositeToGeometryMap.set(
          compositeId,
          geomIds.map((id) => externalIdRemap.get(id) ?? id),
        )
      })
    }

    if (allGeomObjects.length === 0) {
      throw new ThreeMFParseError('No geometry objects found in 3MF file')
    }

    // -----------------------------------------------------------------------
    // Step 5: Slicer-specific coloring
    // -----------------------------------------------------------------------

    // 5a: Bambu Studio extruder assignments
    const modelSettings = await parseModelSettings(zipContent)

    // Scan model files for painting keywords
    const allModelFiles = zipFiles.filter((f) => f.endsWith('.model'))
    for (const modelPath of allModelFiles) {
      try {
        const modelFile = zipContent.file(modelPath)
        if (!modelFile) continue
        const xml = await modelFile.async('text')
        const paintingKeywords = ['mmu_segmentation', 'paint_color', 'mmu_painting', 'FacePainting', 'face_property']
        for (const keyword of paintingKeywords) {
          if (xml.includes(keyword)) modelSettings.hasMmuSegmentation = true
        }
      } catch {
        /* ignore */
      }
    }

    const filamentData = await extractFilamentColors(zipContent)
    const filamentColors = filamentData.colors
    const filamentCount = filamentData.filamentCount
    const hasMultipleExtruders = modelSettings.distinctExtruders.size > 1
    const hasMultipleFilaments = filamentCount > 1

    // Apply extruder-based coloring
    if (modelSettings.objectExtruderMap.size > 0 && filamentColors.length > 0) {
      allGeomObjects.forEach((obj) => {
        let extruder = modelSettings.objectExtruderMap.get(obj.id)
        if (extruder === undefined) {
          compositeToGeometryMap.forEach((geomIds, compositeId) => {
            if (geomIds.includes(obj.id)) {
              const cExt = modelSettings.objectExtruderMap.get(compositeId)
              if (cExt !== undefined) extruder = cExt
            }
          })
        }
        if (extruder === undefined && obj.sourceFile) {
          const fMatch = obj.sourceFile.match(/object_(\d+)\.model/)
          const fId = fMatch ? parseInt(fMatch[1]) : 0
          if (fId > 0 && fId !== obj.id) extruder = modelSettings.objectExtruderMap.get(fId)
        }
        if (extruder !== undefined && extruder > 0 && extruder <= filamentColors.length) {
          const color = filamentColors[extruder - 1]
          if (!obj.triangles.some((t) => t.colorHex !== null)) {
            obj.triangles.forEach((t) => { t.colorHex = color })
          }
        }
      })
    }

    // 5b: PrusaSlicer volume mapping
    const prusaData = await parsePrusaSlicerMetadata(zipContent)
    if (prusaData.volumeRanges.length > 0 && prusaData.extruderColors.length > 0) {
      let globalTriOffset = 0
      allGeomObjects.forEach((obj) => {
        if (obj.triangles.some((t) => t.colorHex !== null)) {
          globalTriOffset += obj.triangles.length
          return
        }
        for (let i = 0; i < obj.triangles.length; i++) {
          const globalIdx = globalTriOffset + i
          for (const range of prusaData.volumeRanges) {
            if (globalIdx >= range.firstid && globalIdx <= range.lastid) {
              const color = prusaData.extruderColors[range.extruder - 1]
              if (color) obj.triangles[i].colorHex = color
              break
            }
          }
        }
        globalTriOffset += obj.triangles.length
      })
    }

    // 5c: Paint data attributes
    if (filamentColors.length >= 1) {
      for (const obj of allGeomObjects) {
        if (!obj.triangles.some((t) => t.paintAttr)) continue

        let defaultColor = filamentColors[0]
        let objExtruder = modelSettings.objectExtruderMap.get(obj.id)
        if (objExtruder === undefined) {
          compositeToGeometryMap.forEach((geomIds, compositeId) => {
            if (geomIds.includes(obj.id)) {
              const cExt = modelSettings.objectExtruderMap.get(compositeId)
              if (cExt !== undefined) objExtruder = cExt
            }
          })
        }
        if (objExtruder !== undefined && objExtruder > 0 && objExtruder <= filamentColors.length) {
          defaultColor = filamentColors[objExtruder - 1]
        }

        for (const tri of obj.triangles) {
          if (tri.paintAttr) {
            const state = decodePaintColorAttr(tri.paintAttr)
            if (state > 0 && state <= filamentColors.length) {
              tri.colorHex = filamentColors[state - 1]
            } else if (state > 0) {
              tri.colorHex = filamentColors[filamentColors.length - 1]
            } else {
              tri.colorHex = defaultColor
            }
          } else if (tri.colorHex === null) {
            tri.colorHex = defaultColor
          }
        }
      }
    }

    // 5d: Fallback sequential coloring
    const totalColoredTriangles = allGeomObjects.reduce(
      (sum, obj) => sum + obj.triangles.filter((t) => t.colorHex !== null).length,
      0,
    )
    if (totalColoredTriangles === 0 && filamentColors.length > 1 && allGeomObjects.length > 1) {
      if (modelSettings.hasMmuSegmentation || hasMultipleExtruders) {
        allGeomObjects.forEach((obj, idx) => {
          const color = filamentColors[idx % filamentColors.length]
          obj.triangles.forEach((t) => { t.colorHex = color })
        })
      }
    }

    // -----------------------------------------------------------------------
    // Step 6: Create BufferGeometries
    // -----------------------------------------------------------------------
    const geometries: BufferGeometry[] = []
    const objectIdToGeometryIndex = new Map<number, number>()
    const triangleMaterialMaps = new Map<number, Map<number, string>>()
    const allUniqueColors = new Set<string>()
    let totalVolume = 0
    let globalBoundingBox = { x: 0, y: 0, z: 0 }

    for (let i = 0; i < allGeomObjects.length; i++) {
      const obj = allGeomObjects[i]
      const geometry = new BufferGeometry()
      geometry.setAttribute('position', new BufferAttribute(new Float32Array(obj.vertices), 3))

      const indices = new Uint32Array(obj.triangles.length * 3)
      const triColorMap = new Map<number, string>()
      let hasAnyColor = false

      for (let t = 0; t < obj.triangles.length; t++) {
        const tri = obj.triangles[t]
        indices[t * 3] = tri.v1
        indices[t * 3 + 1] = tri.v2
        indices[t * 3 + 2] = tri.v3
        if (tri.colorHex) {
          triColorMap.set(t, tri.colorHex)
          allUniqueColors.add(tri.colorHex)
          hasAnyColor = true
        }
      }

      geometry.setIndex(new BufferAttribute(indices, 1))
      geometry.computeVertexNormals()
      geometries.push(geometry)
      objectIdToGeometryIndex.set(obj.id, i)
      if (hasAnyColor) triangleMaterialMaps.set(i, triColorMap)

      try {
        totalVolume += calculateVolume(geometry)
        const bbox = calculateBoundingBox(geometry)
        globalBoundingBox.x = Math.max(globalBoundingBox.x, bbox.x)
        globalBoundingBox.y = Math.max(globalBoundingBox.y, bbox.y)
        globalBoundingBox.z = Math.max(globalBoundingBox.z, bbox.z)
      } catch {
        /* skip */
      }
    }

    // Map composite IDs
    compositeToGeometryMap.forEach((geomIds, compositeId) => {
      if (!objectIdToGeometryIndex.has(compositeId)) {
        const firstIdx = objectIdToGeometryIndex.get(geomIds[0])
        if (firstIdx !== undefined) objectIdToGeometryIndex.set(compositeId, firstIdx)
      }
    })

    // -----------------------------------------------------------------------
    // Step 7: Material slots
    // -----------------------------------------------------------------------
    const colorArray = Array.from(allUniqueColors).sort()
    const materialSlots: MaterialSlot[] = []

    const isMultiColorFromColors = colorArray.length > 1
    const isMultiColorFromExtruders = hasMultipleExtruders && filamentColors.length > 1
    const isMultiColorFromPainting = modelSettings.hasMmuSegmentation
    const isMultiColorFromPrusa =
      prusaData.volumeRanges.length > 0 && new Set(prusaData.volumeRanges.map((r) => r.extruder)).size > 1
    const isMultiColorFromFilamentConfig = hasMultipleFilaments || filamentColors.length > 1
    const isMultiColor =
      isMultiColorFromColors ||
      isMultiColorFromExtruders ||
      isMultiColorFromPainting ||
      isMultiColorFromPrusa ||
      isMultiColorFromFilamentConfig

    if (colorArray.length > 1) {
      colorArray.forEach((colorHex, idx) => {
        const objectIds: number[] = []
        triangleMaterialMaps.forEach((triMap, geomIdx) => {
          for (const c of triMap.values()) {
            if (c === colorHex) {
              objectIds.push(geomIdx)
              break
            }
          }
        })
        if (objectIds.length === 0) objectIds.push(...geometries.map((_, i) => i))
        materialSlots.push({ id: colorHex, name: `Color ${idx + 1}`, objectIds, selectedColor: colorHex })
      })
    } else if (filamentColors.length > 1) {
      filamentColors.forEach((color, idx) => {
        const objectIds: number[] = []
        allGeomObjects.forEach((obj, geomIdx) => {
          if (obj.triangles.length > 0 && obj.triangles[0].colorHex === color) objectIds.push(geomIdx)
        })
        if (objectIds.length === 0) objectIds.push(...geometries.map((_, i) => i))
        materialSlots.push({ id: color, name: `Filament ${idx + 1}`, objectIds, selectedColor: color })
      })
    } else if (filamentCount > 1 && filamentColors.length === 0) {
      const defaultSlotColors = ['#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF', '#FF8000', '#8000FF']
      for (let i = 0; i < filamentCount; i++) {
        const slotColor =
          i < defaultSlotColors.length
            ? defaultSlotColors[i]
            : `#${((i * 37) % 256).toString(16).padStart(2, '0')}80FF`
        materialSlots.push({
          id: `filament_${i + 1}`,
          name: `Filament ${i + 1}`,
          objectIds: geometries.map((_, gi) => gi),
          selectedColor: slotColor,
        })
      }
    } else if (isMultiColor && prusaData.extruderColors.length > 1) {
      prusaData.extruderColors.forEach((color, idx) => {
        materialSlots.push({
          id: color,
          name: `Extruder ${idx + 1}`,
          objectIds: geometries.map((_, i) => i),
          selectedColor: color,
        })
      })
    } else {
      materialSlots.push({
        id: 'default',
        name: 'Material 1',
        objectIds: geometries.map((_, i) => i),
        selectedColor: '#FFFFFF',
      })
    }

    // -----------------------------------------------------------------------
    // Step 8: Plates
    // -----------------------------------------------------------------------
    let { plates, plateObjectMap } = await parseBambuPlates(zipContent)

    if (plates.length > 0) {
      const hasEmpty = plates.some((p) => p.objectIds.length === 0)
      if (hasEmpty) {
        const allIds = buildItems.length > 0 ? buildItems.map((b) => b.objectId) : allGeomObjects.map((o) => o.id)
        plates.forEach((p) => {
          if (p.objectIds.length === 0) {
            p.objectIds = [...allIds]
            plateObjectMap.set(p.id, [...allIds])
          }
        })
      }
    }

    if (plates.length === 0) {
      const allObjectIds = allGeomObjects.map((o) => o.id)
      plates = [{ id: 1, name: 'Plate 1', objectIds: allObjectIds }]
      plateObjectMap = new Map([[1, allObjectIds]])
    }

    return {
      volume: totalVolume,
      boundingBox: globalBoundingBox,
      materialSlots,
      isMultiColor,
      metadata: {},
      geometries,
      triangleMaterialMaps: triangleMaterialMaps.size > 0 ? triangleMaterialMaps : undefined,
      plates: plates.length > 0 ? plates : undefined,
      plateObjectMap: plateObjectMap.size > 0 ? plateObjectMap : undefined,
      objectIdToGeometryIndex: objectIdToGeometryIndex.size > 0 ? objectIdToGeometryIndex : undefined,
      compositeToGeometryMap: compositeToGeometryMap.size > 0 ? compositeToGeometryMap : undefined,
    }
  } catch (error) {
    if (error instanceof ThreeMFParseError) throw error
    throw new ThreeMFParseError(
      `Failed to parse .3MF file: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}
