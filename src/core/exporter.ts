/**
 * 3MF Exporter — re-packages a .3MF file with **only** color values changed.
 *
 * ★ DESIGN PRINCIPLE: surgical, field-specific string replacements only.
 *   No DOM parsing / re-serialization. No JSON parse / stringify.
 *   Only the exact color hex values inside known color fields are touched.
 *   Every other byte of the original file is preserved exactly as-is.
 *   Safe for production 3D printing workflows.
 *
 * @packageDocumentation
 */

import JSZip from 'jszip'
import type { MaterialSlot, ColorOption } from './types'

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------

const DEFAULT_COLOR_MAP: Record<string, string> = {
  White: '#F1F5F9',
  Black: '#1E293B',
  Red: '#EF4444',
  Blue: '#3B82F6',
  Green: '#22C55E',
  Yellow: '#EAB308',
  Orange: '#F97316',
  Grey: '#64748B',
  Clear: '#E0F2FE',
}

/**
 * Resolve a user color selection to an uppercase hex string (#RRGGBB).
 * Accepts hex strings or named colors.
 */
function resolveToHex(color: string, colorOptions?: ColorOption[]): string {
  if (color.startsWith('#')) {
    let c = color.toUpperCase()
    if (c.length === 4) c = `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}`
    if (c.length === 9) c = c.substring(0, 7)
    return c
  }
  if (colorOptions) {
    const opt = colorOptions.find((o) => o.name === color)
    if (opt) return opt.hex.toUpperCase()
  }
  const hex = DEFAULT_COLOR_MAP[color]
  return hex ? hex.toUpperCase() : '#808080'
}

/** Normalize a color string to uppercase #RRGGBB (stripping alpha). */
function normalizeColor(color: string): string {
  if (!color || color.trim() === '') return '#808080'
  let c = color.trim()
  if (!c.startsWith('#')) c = '#' + c
  if (c.length === 9) c = c.substring(0, 7)
  return c.toUpperCase()
}

/**
 * Build a case-insensitive regex that matches a specific 6-digit hex color
 * (with optional 2-digit alpha suffix), ensuring no trailing hex chars.
 */
function hexPattern(hex6: string): RegExp {
  // hex6 is like "#AABBCC" — build pattern that matches case-insensitively
  // and captures optional alpha suffix
  const body = hex6.slice(1) // "AABBCC"
  return new RegExp(
    '#' + body + '([0-9a-fA-F]{2})?(?![0-9a-fA-F])',
    'gi',
  )
}

/** Replace a hex color in a string, preserving any alpha suffix. */
function replaceHex(text: string, oldHex: string, newHex: string): string {
  return text.replace(hexPattern(oldHex), (_match, alpha) => {
    return newHex + (alpha || '')
  })
}

// ---------------------------------------------------------------------------
// Cross-referencing helpers: extract color values from different sources
// so we can map between them when they don't exactly match.
// ---------------------------------------------------------------------------

/**
 * Extract the ordered list of filament colors from the project_settings
 * config file (JSON or INI format). Returns normalized hex values in
 * filament order. Returns [] if not found.
 */
async function extractConfigFilamentColors(zipContent: JSZip): Promise<string[]> {
  for (const path of ['Metadata/project_settings.config', 'Metadata/Project_settings.config']) {
    const file = zipContent.file(path)
    if (!file) continue

    try {
      const content = await file.async('text')
      const trimmed = content.trim()

      if (trimmed.startsWith('{')) {
        // JSON format
        try {
          const json = JSON.parse(trimmed)
          const colorKey = Object.keys(json).find(
            (k) => k.toLowerCase() === 'filament_colour' || k.toLowerCase() === 'filament_color',
          )
          if (colorKey) {
            const val = json[colorKey]
            if (Array.isArray(val)) {
              return val.map((c: string) => normalizeColor(String(c)))
            }
            if (typeof val === 'string') {
              return val
                .split(';')
                .map((c: string) => c.trim())
                .filter((c: string) => c.length > 0)
                .map((c) => normalizeColor(c))
            }
          }
        } catch {
          /* try INI fallback */
        }
      }

      // INI format
      const match = content.match(/filament_colou?r\s*=\s*(.+)/i)
      if (match) {
        return match[1]
          .split(';')
          .map((c) => c.trim())
          .filter((c) => c.length > 0)
          .map((c) => normalizeColor(c))
      }
    } catch {
      continue
    }
  }

  return []
}

/**
 * Extract ordered displaycolor values from `<base>` elements inside
 * `<basematerials>` blocks in model XML. Also extracts color values
 * from `<color>` elements inside `<colorgroup>` blocks.
 * Returns raw (unnormalized) strings as they appear in the file.
 */
function extractXmlColorValues(xml: string): string[] {
  const colors: string[] = []

  // From <base ... displaycolor="VALUE" ...>
  const basePattern = /<base\b[^>]*?displaycolor\s*=\s*["']([^"']*?)["'][^>]*?>/gi
  let match
  while ((match = basePattern.exec(xml)) !== null) {
    if (match[1]) colors.push(match[1])
  }

  // If we found basematerials colors, return them.
  // Otherwise fall back to colorgroup colors.
  if (colors.length > 0) return colors

  const colorPattern = /<color\b[^>]*?\bcolor\s*=\s*["']([^"']*?)["'][^>]*?>/gi
  while ((match = colorPattern.exec(xml)) !== null) {
    if (match[1]) colors.push(match[1])
  }

  return colors
}

/**
 * Build an expanded color remap for the model XML by cross-referencing
 * the config filament colors and the XML basematerials/colorgroup colors.
 *
 * If basematerials has #000000FF for filament 1 but the config has #FF0000FF,
 * and the primary remap (from slot IDs) maps #FF0000 → #3B82F6, then we also
 * need to map #000000 → #3B82F6 in the model XML. This function adds those
 * extra entries.
 */
function buildModelRemap(
  xml: string,
  primaryRemap: Map<string, string>,
  configColors: string[],
  materialSlots: MaterialSlot[],
  colorOptions?: ColorOption[],
): Map<string, string> {
  if (primaryRemap.size === 0) return primaryRemap

  const expanded = new Map(primaryRemap)
  const xmlColors = extractXmlColorValues(xml)

  if (xmlColors.length === 0 || configColors.length === 0) return expanded

  // For each filament position, cross-reference the XML color with the config color.
  // If only one of them is in the remap, add the other with the same replacement.
  const len = Math.min(xmlColors.length, configColors.length)
  for (let i = 0; i < len; i++) {
    const xmlNorm = normalizeColor(xmlColors[i])
    const cfgNorm = configColors[i] // already normalized

    // Find the slot that corresponds to this filament position.
    // A slot matches if its ID equals either the config color or the XML color.
    const slot = materialSlots.find((s) => {
      if (!s.id.startsWith('#')) return false
      const slotNorm = normalizeColor(s.id)
      return slotNorm === cfgNorm || slotNorm === xmlNorm
    })

    if (!slot) continue

    const newHex = resolveToHex(slot.selectedColor, colorOptions)
    const slotNorm = normalizeColor(slot.id)

    // Only add if this slot's color was actually changed
    if (slotNorm === newHex) continue

    // Add the XML basematerials color to the remap if it's not already there
    if (!expanded.has(xmlNorm)) {
      expanded.set(xmlNorm, newHex)
    }
    // Also ensure the config color is in the remap (covers the reverse mismatch)
    if (!expanded.has(cfgNorm)) {
      expanded.set(cfgNorm, newHex)
    }
  }

  return expanded
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface Export3MFOptions {
  /**
   * The original .3MF file. Used as the base — only color values are changed.
   */
  originalFile: File | Blob | ArrayBuffer
  /**
   * The current material slots with the user's color selections.
   */
  materialSlots: MaterialSlot[]
  /**
   * Optional color options to resolve named colors to hex.
   * Defaults to the built-in color map.
   */
  colorOptions?: ColorOption[]
  /**
   * Output filename (without extension). Default: original filename + "_modified".
   */
  filename?: string
}

// ---------------------------------------------------------------------------
// Core export function
// ---------------------------------------------------------------------------

/**
 * Export a modified `.3MF` file with **only** updated color values.
 *
 * Every byte of the original file is preserved except for the exact color
 * hex strings inside known color fields. No XML re-serialization, no JSON
 * reformatting. Safe for production 3D printing workflows.
 *
 * @example
 * ```ts
 * import { export3MF } from 'parse3mf/core'
 *
 * const blob = await export3MF({
 *   originalFile: myFile,
 *   materialSlots: updatedSlots,
 * })
 * ```
 */
export async function export3MF(options: Export3MFOptions): Promise<Blob> {
  const { originalFile, materialSlots, colorOptions } = options

  const arrayBuffer =
    originalFile instanceof ArrayBuffer
      ? originalFile
      : await (originalFile as Blob).arrayBuffer()

  const zip = new JSZip()
  const zipContent = await zip.loadAsync(arrayBuffer)

  // Build color remap: original (slot.id) → new hex.
  // Only entries where the color actually changed.
  const colorRemap = new Map<string, string>()
  for (const slot of materialSlots) {
    // Skip non-hex slot IDs (e.g. "filament_1") — these can't be
    // matched in the raw file text.
    if (!slot.id.startsWith('#')) continue

    const originalNorm = normalizeColor(slot.id)
    const newHex = resolveToHex(slot.selectedColor, colorOptions)
    if (originalNorm !== newHex) {
      colorRemap.set(originalNorm, newHex)
    }
  }

  if (colorRemap.size === 0) {
    // Nothing changed — return the original file byte-for-byte.
    return new Blob([arrayBuffer], {
      type: 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml',
    })
  }

  // -----------------------------------------------------------------------
  // Extract config filament colors for cross-referencing.
  // The parser may derive slot IDs from config colors, but the model XML
  // basematerials might have different hex values for the same filaments.
  // We need to cover both representations in the remap.
  // -----------------------------------------------------------------------
  const configColors = await extractConfigFilamentColors(zipContent)

  // Build a comprehensive remap that covers BOTH config-derived AND
  // XML-derived color values (for when they differ).
  let comprehensiveRemap = colorRemap

  // -----------------------------------------------------------------------
  // 1. Patch .model XML files
  //    Only touches displaycolor="..." on <base> elements
  //    and color="..." on <color> elements.
  // -----------------------------------------------------------------------
  const modelFiles = Object.keys(zipContent.files).filter(
    (f) => f.endsWith('.model') && f.startsWith('3D/'),
  )

  for (const modelPath of modelFiles) {
    const modelFile = zipContent.file(modelPath)
    if (!modelFile) continue

    const xml = await modelFile.async('text')

    // Build an expanded remap for this model file that includes
    // basematerials colors even if they differ from the slot IDs.
    const modelRemap = buildModelRemap(xml, colorRemap, configColors, materialSlots, colorOptions)

    // Merge any new entries back into the comprehensive remap so that
    // config and slice_info files also benefit from the cross-reference.
    if (modelRemap.size > colorRemap.size) {
      comprehensiveRemap = new Map([...comprehensiveRemap, ...modelRemap])
    }

    const patched = patchModelXmlColors(xml, modelRemap)
    if (patched !== xml) {
      zipContent.file(modelPath, patched)
    }
  }

  // -----------------------------------------------------------------------
  // 2. Patch Bambu Studio project_settings.config
  //    ONLY touches filament_colour / filament_color field values.
  // -----------------------------------------------------------------------
  for (const configPath of [
    'Metadata/project_settings.config',
    'Metadata/Project_settings.config',
  ]) {
    const configFile = zipContent.file(configPath)
    if (!configFile) continue

    try {
      const content = await configFile.async('text')
      const patched = patchProjectSettingsColors(content, comprehensiveRemap)
      if (patched !== content) {
        zipContent.file(configPath, patched)
      }
    } catch {
      /* leave file untouched */
    }
  }

  // -----------------------------------------------------------------------
  // 3. Patch slice_info.config
  //    ONLY touches color="..." attributes on <filament> elements.
  // -----------------------------------------------------------------------
  const sliceInfoFile = zipContent.file('Metadata/slice_info.config')
  if (sliceInfoFile) {
    try {
      const content = await sliceInfoFile.async('text')
      const patched = patchSliceInfoColors(content, comprehensiveRemap)
      if (patched !== content) {
        zipContent.file('Metadata/slice_info.config', patched)
      }
    } catch {
      /* leave file untouched */
    }
  }

  // -----------------------------------------------------------------------
  // 4. Patch PrusaSlicer config files
  //    ONLY touches extruder_colour / filament_colour lines.
  // -----------------------------------------------------------------------
  const slicerConfigs = Object.keys(zipContent.files).filter(
    (f) => f.includes('Slic3r') && f.endsWith('.config'),
  )
  for (const configPath of slicerConfigs) {
    const configFile = zipContent.file(configPath)
    if (!configFile) continue

    try {
      const content = await configFile.async('text')
      const patched = patchPrusaSlicerColors(content, comprehensiveRemap)
      if (patched !== content) {
        zipContent.file(configPath, patched)
      }
    } catch {
      /* leave file untouched */
    }
  }

  // -----------------------------------------------------------------------
  // 5. Re-package ZIP — let JSZip preserve original compression per file.
  // -----------------------------------------------------------------------
  const blob = await zipContent.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml',
  })

  return blob
}

// ---------------------------------------------------------------------------
// 1. Model XML: displaycolor on <base>, color on <color> elements
//
//    We match the ENTIRE <base .../> or <color .../> element tag and only
//    replace the color attribute value within it. This avoids accidentally
//    matching a "color" attribute on unrelated elements.
// ---------------------------------------------------------------------------

function patchModelXmlColors(xml: string, remap: Map<string, string>): string {
  if (remap.size === 0) return xml

  let result = xml

  // <base ... displaycolor="VALUE" ...> — basematerials color definitions
  result = patchAttrInTag(result, 'base', 'displaycolor', remap)

  // <color ... color="VALUE" ...> — colorgroup color definitions
  result = patchAttrInTag(result, 'color', 'color', remap)

  return result
}

/**
 * Inside all occurrences of <tagName ...>, find the attribute `attrName="VALUE"`
 * and replace VALUE using the color remap. Everything else is untouched.
 */
function patchAttrInTag(
  xml: string,
  tagName: string,
  attrName: string,
  remap: Map<string, string>,
): string {
  // Match: <tagName ... attrName="value" ...> (self-closing or not)
  // We use a two-pass approach:
  //   1. Find each <tagName ...> tag
  //   2. Within that tag, find and replace the specific attribute value
  const tagPattern = new RegExp(
    `(<${tagName}\\b)([^>]*>)`,
    'gi',
  )

  return xml.replace(tagPattern, (fullTag, tagOpen, rest) => {
    // Within this tag, find attrName="value" and replace the value
    const attrPattern = new RegExp(
      `(\\b${attrName}\\s*=\\s*(["']))([^"']*?)(\\2)`,
      'gi',
    )

    const newRest = rest.replace(attrPattern, (
      attrMatch: string,
      prefix: string,
      _quote: string,
      colorVal: string,
      closingQuote: string,
    ) => {
      const normalized = normalizeColor(colorVal)
      const replacement = remap.get(normalized)
      if (!replacement) return attrMatch

      const newVal = preserveAlpha(colorVal, replacement)
      return prefix + newVal + closingQuote
    })

    return tagOpen + newRest
  })
}

/** Given original color value "colorVal" and new hex, preserve alpha suffix. */
function preserveAlpha(originalVal: string, newHex: string): string {
  const trimmed = originalVal.trim()
  // Check if original had alpha (9 chars with #, or 8 chars without)
  const withHash = trimmed.startsWith('#') ? trimmed : '#' + trimmed
  if (withHash.length === 9) {
    // Preserve the original alpha characters
    return newHex + withHash.slice(7)
  }
  return newHex
}

// ---------------------------------------------------------------------------
// 2. project_settings.config: ONLY filament_colour / filament_color fields
//
//    In JSON format: "filament_colour": ["#FF0000FF", "#00FF00FF"]
//    In INI format:  filament_colour = #FF0000FF;#00FF00FF
//
//    We locate the specific field and replace colors within it only.
// ---------------------------------------------------------------------------

function patchProjectSettingsColors(
  content: string,
  remap: Map<string, string>,
): string {
  if (remap.size === 0) return content

  const trimmed = content.trim()

  if (trimmed.startsWith('{')) {
    // JSON format — find the filament_colour/filament_color key and
    // replace hex values within its array value only.
    return patchJsonFilamentColors(content, remap)
  }

  // INI format — only touch the filament_colour line
  return patchIniColorLine(content, remap)
}

/**
 * In a JSON config string, find the "filament_colour" (or "filament_color")
 * array and replace each color value. Everything else is untouched.
 */
function patchJsonFilamentColors(
  content: string,
  remap: Map<string, string>,
): string {
  // Match: "filament_colour" : [ ... ] or "filament_color" : [ ... ]
  // We capture the key + the array content.
  const pattern = /("filament_colou?r"\s*:\s*\[)([^\]]*?)(\])/gi

  return content.replace(pattern, (fullMatch, prefix, arrayContent, suffix) => {
    // Within the array content, replace each hex color value
    let newContent = arrayContent
    for (const [oldHex, newHex] of remap) {
      newContent = replaceHex(newContent, oldHex, newHex)
    }
    return prefix + newContent + suffix
  })
}

/**
 * In an INI-style config, only replace colors on the filament_colour line.
 */
function patchIniColorLine(content: string, remap: Map<string, string>): string {
  return content.replace(
    /^(filament_colou?r\s*=\s*)(.+)$/gim,
    (_fullMatch, prefix, colorsLine) => {
      let newLine = colorsLine
      for (const [oldHex, newHex] of remap) {
        newLine = replaceHex(newLine, oldHex, newHex)
      }
      return prefix + newLine
    },
  )
}

// ---------------------------------------------------------------------------
// 3. slice_info.config: ONLY color="..." on <filament> elements
// ---------------------------------------------------------------------------

function patchSliceInfoColors(
  content: string,
  remap: Map<string, string>,
): string {
  if (remap.size === 0) return content

  // Match <filament ...> tags and replace color attributes within them
  return patchAttrInTag(content, 'filament', 'color', remap)
}

// ---------------------------------------------------------------------------
// 4. PrusaSlicer: ONLY extruder_colour / filament_colour lines
// ---------------------------------------------------------------------------

function patchPrusaSlicerColors(content: string, remap: Map<string, string>): string {
  if (remap.size === 0) return content

  return content.replace(
    /^((?:extruder|filament)_colou?r\s*=\s*)(.+)$/gim,
    (_fullMatch, prefix, colorsLine) => {
      let newLine = colorsLine
      for (const [oldHex, newHex] of remap) {
        newLine = replaceHex(newLine, oldHex, newHex)
      }
      return prefix + newLine
    },
  )
}

// ---------------------------------------------------------------------------
// Convenience: trigger download in the browser
// ---------------------------------------------------------------------------

/**
 * Export a modified `.3MF` and trigger a browser download.
 *
 * @example
 * ```ts
 * import { download3MF } from 'parse3mf/core'
 *
 * await download3MF({
 *   originalFile: myFile,
 *   materialSlots: updatedSlots,
 *   filename: 'my-model-recolored',
 * })
 * ```
 */
export async function download3MF(options: Export3MFOptions): Promise<void> {
  const blob = await export3MF(options)

  const defaultName =
    options.originalFile instanceof File
      ? options.originalFile.name.replace(/\.3mf$/i, '') + '_modified'
      : 'model_modified'

  const filename = (options.filename || defaultName) + '.3mf'

  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
