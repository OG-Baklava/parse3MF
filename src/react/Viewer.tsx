import { useEffect, useRef, useMemo, useState } from 'react'
import * as THREE from 'three'
import { BufferAttribute } from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { useThreeMF } from './context'
import type { MaterialSlot, ViewerTheme } from '../core/types'
import { resolveTheme, colorToHex } from '../styles/theme'

// ---------------------------------------------------------------------------
// Multi-material group builder
// ---------------------------------------------------------------------------

function buildMultiMaterialGeometry(
  src: THREE.BufferGeometry,
  triColorMap: Map<number, string>,
  slots: MaterialSlot[],
): { geometry: THREE.BufferGeometry; materials: THREE.MeshPhongMaterial[]; slotOrder: number[] } | null {
  const idx = src.index
  const pos = src.attributes.position
  if (!idx || !pos || slots.length === 0) return null

  const arr = idx.array
  const triCount = idx.count / 3
  const c2s = new Map<string, number>()
  slots.forEach((s, i) => c2s.set(s.id, i))

  const buckets: number[][] = slots.map(() => [])
  for (let t = 0; t < triCount; t++) {
    const hex = triColorMap.get(t)
    if (hex === undefined) {
      buckets[0].push(t)
    } else {
      const si = c2s.get(hex)
      if (si !== undefined) buckets[si].push(t)
      else buckets[0].push(t)
    }
  }

  const sortedIndices = new Uint32Array(triCount * 3)
  const groups: { start: number; count: number; materialIndex: number }[] = []
  const slotOrder: number[] = []
  let writeOffset = 0

  for (let si = 0; si < slots.length; si++) {
    const bucket = buckets[si]
    if (bucket.length === 0) continue
    const groupStart = writeOffset * 3
    for (const triIdx of bucket) {
      const base = triIdx * 3
      sortedIndices[writeOffset * 3] = arr[base]
      sortedIndices[writeOffset * 3 + 1] = arr[base + 1]
      sortedIndices[writeOffset * 3 + 2] = arr[base + 2]
      writeOffset++
    }
    groups.push({ start: groupStart, count: bucket.length * 3, materialIndex: groups.length })
    slotOrder.push(si)
  }

  const geom = new THREE.BufferGeometry()
  geom.setAttribute('position', pos.clone())
  if (src.attributes.normal) geom.setAttribute('normal', src.attributes.normal.clone())
  geom.setIndex(new BufferAttribute(sortedIndices, 1))
  for (const g of groups) geom.addGroup(g.start, g.count, g.materialIndex)
  geom.computeVertexNormals()

  const materials = slotOrder.map((si) =>
    new THREE.MeshPhongMaterial({ color: colorToHex(slots[si].selectedColor), specular: 0x111111, shininess: 200 }),
  )

  return { geometry: geom, materials, slotOrder }
}

// ---------------------------------------------------------------------------
// Scene helpers
// ---------------------------------------------------------------------------

function centerAndScale(meshes: THREE.Mesh[], scene: THREE.Scene) {
  if (meshes.length === 0) return
  const tmp = new THREE.Group()
  meshes.forEach((m) => tmp.add(m))
  const box = new THREE.Box3().setFromObject(tmp)
  const center = new THREE.Vector3()
  const size = new THREE.Vector3()
  box.getCenter(center)
  box.getSize(size)
  const maxDim = Math.max(size.x, size.y, size.z)
  const scale = maxDim > 0 ? 100 / maxDim : 1
  meshes.forEach((m) => {
    tmp.remove(m)
    m.position.sub(center)
    m.scale.setScalar(scale)
    scene.add(m)
  })
}

function makeMaterial(hex: number): THREE.MeshPhongMaterial {
  return new THREE.MeshPhongMaterial({ color: hex, specular: 0x111111, shininess: 200 })
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface ViewerProps {
  /** Theme overrides. */
  theme?: ViewerTheme
  /** CSS class for the container div. */
  className?: string
  /** Inline styles for the container div. */
  style?: React.CSSProperties
  /** Show multicolor debug overlay. Default: false. */
  showDebugOverlay?: boolean
}

/**
 * The 3D viewport that renders the parsed model.
 *
 * Must be used inside a `<ThreeMFProvider>`.
 */
export function Viewer({ theme: themeOverrides, className, style, showDebugOverlay }: ViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const theme = resolveTheme(themeOverrides)

  // Persistent Three.js objects
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const controlsRef = useRef<OrbitControls | null>(null)
  const rafRef = useRef(0)

  const meshesRef = useRef<THREE.Mesh[]>([])
  const slotOrderRef = useRef<Map<number, number[]>>(new Map())
  const ownedGeomsRef = useRef<Set<THREE.BufferGeometry>>(new Set())

  const [debugInfo, setDebugInfo] = useState('')

  const {
    model,
    loading,
    error,
    geometries,
    materialSlots,
    isMultiColor,
    triangleMaterialMaps,
    selectedPlateId,
    plates,
    plateObjectMap,
    objectIdToGeometryIndex,
    compositeToGeometryMap,
    color,
  } = useThreeMF()

  const slotsRef = useRef(materialSlots)
  slotsRef.current = materialSlots

  // -----------------------------------------------------------------------
  // Plate filtering
  // -----------------------------------------------------------------------
  const { filteredGeometries, originalIndices } = useMemo(() => {
    const all = geometries ?? []
    const fallback = {
      filteredGeometries: all as THREE.BufferGeometry[],
      originalIndices: all.map((_: unknown, i: number) => i),
    }
    if (!geometries || !plates?.length || !selectedPlateId || !plateObjectMap || !objectIdToGeometryIndex)
      return fallback

    const plate = plates.find((p) => p.id === selectedPlateId)
    if (!plate) return fallback

    const objIds = plateObjectMap?.get(selectedPlateId) ?? plate.objectIds
    if (!objIds?.length) return fallback

    const gSet = new Set<number>()
    for (const oid of objIds) {
      const direct = objectIdToGeometryIndex?.get(oid)
      if (direct !== undefined) { gSet.add(direct); continue }
      if (compositeToGeometryMap) {
        const children = compositeToGeometryMap.get(oid)
        if (children) { children.forEach((cid) => { const ci = objectIdToGeometryIndex?.get(cid); if (ci !== undefined) gSet.add(ci) }); continue }
      }
    }
    if (gSet.size === 0) return fallback
    const sorted = [...gSet].sort((a, b) => a - b)
    return {
      filteredGeometries: sorted.map((i) => geometries[i]).filter(Boolean) as THREE.BufferGeometry[],
      originalIndices: sorted.filter((i) => !!geometries[i]),
    }
  }, [geometries, plates, selectedPlateId, plateObjectMap, objectIdToGeometryIndex, compositeToGeometryMap])

  // =======================================================================
  // EFFECT 1 — Three.js bootstrap (mount-only)
  // =======================================================================
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(theme.background)

    const w = el.clientWidth || 300
    const h = el.clientHeight || 300
    const camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 2000)
    camera.position.z = 150

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(w, h)
    renderer.setPixelRatio(window.devicePixelRatio)
    el.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.05

    scene.add(new THREE.AmbientLight(0xffffff, 0.5))
    const d1 = new THREE.DirectionalLight(0xffffff, 0.8)
    d1.position.set(1, 1, 1)
    scene.add(d1)
    const d2 = new THREE.DirectionalLight(0xffffff, 0.5)
    d2.position.set(-1, -1, -1)
    scene.add(d2)

    sceneRef.current = scene
    cameraRef.current = camera
    rendererRef.current = renderer
    controlsRef.current = controls

    const loop = () => {
      rafRef.current = requestAnimationFrame(loop)
      controls.update()
      renderer.render(scene, camera)
    }
    loop()

    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      if (width === 0 || height === 0) return
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      renderer.setSize(width, height)
    })
    ro.observe(el)

    return () => {
      cancelAnimationFrame(rafRef.current)
      ro.disconnect()
      controls.dispose()
      renderer.dispose()
      if (el.contains(renderer.domElement)) el.removeChild(renderer.domElement)
      sceneRef.current = null
      cameraRef.current = null
      rendererRef.current = null
      controlsRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // =======================================================================
  // EFFECT 2 — Build meshes
  // =======================================================================
  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return

    for (const m of meshesRef.current) {
      scene.remove(m)
      if (ownedGeomsRef.current.has(m.geometry)) { m.geometry.dispose(); ownedGeomsRef.current.delete(m.geometry) }
      const mat = m.material
      if (Array.isArray(mat)) mat.forEach((mt) => mt.dispose())
      else mat.dispose()
    }
    meshesRef.current = []
    slotOrderRef.current.clear()

    try {
      const slots = slotsRef.current
      const clr = color
      const newMeshes: THREE.Mesh[] = []
      const newSlotOrder = new Map<number, number[]>()

      if (filteredGeometries.length > 0) {
        for (let fi = 0; fi < filteredGeometries.length; fi++) {
          const geom = filteredGeometries[fi]
          if (!geom) continue
          const oi = originalIndices[fi] ?? fi

          if (isMultiColor && slots.length > 1) {
            const triMap = triangleMaterialMaps?.get(oi)
            if (triMap && triMap.size > 0) {
              const uniq = new Set(triMap.values())
              if (uniq.size > 1) {
                const result = buildMultiMaterialGeometry(geom, triMap, slots)
                if (result) {
                  ownedGeomsRef.current.add(result.geometry)
                  const mesh = new THREE.Mesh(result.geometry, result.materials)
                  newSlotOrder.set(newMeshes.length, result.slotOrder)
                  newMeshes.push(mesh)
                  continue
                }
              }
              const hex = [...uniq][0]
              const si = slots.findIndex((s) => s.id === hex)
              const slot = si >= 0 ? slots[si] : null
              const mesh = new THREE.Mesh(geom, makeMaterial(colorToHex(slot?.selectedColor ?? hex)))
              if (si >= 0) newSlotOrder.set(newMeshes.length, [si])
              newMeshes.push(mesh)
              continue
            }

            const geomSlots = slots.map((s, i) => ({ s, i })).filter(({ s }) => s.objectIds.includes(oi))
            if (geomSlots.length > 0) {
              const { s: slot, i: si } = geomSlots[0]
              const mesh = new THREE.Mesh(geom, makeMaterial(colorToHex(slot.selectedColor)))
              newSlotOrder.set(newMeshes.length, [si])
              newMeshes.push(mesh)
              continue
            }
          }

          newMeshes.push(new THREE.Mesh(geom, makeMaterial(colorToHex(clr))))
        }

        meshesRef.current = newMeshes
        slotOrderRef.current = newSlotOrder
        centerAndScale(newMeshes, scene)
      }

      setDebugInfo(
        isMultiColor && slots.length > 1
          ? `${slots.length} colors, ${newMeshes.length} mesh(es)`
          : `${newMeshes.length} mesh(es)`,
      )
    } catch (e) {
      console.error('[Viewer] render error', e)
      setDebugInfo(`ERROR: ${e instanceof Error ? e.message : 'unknown'}`)
    }

    const currentMeshes = meshesRef.current
    const currentOwnedGeoms = ownedGeomsRef.current
    return () => {
      for (const m of currentMeshes) {
        scene.remove(m)
        if (currentOwnedGeoms.has(m.geometry)) { m.geometry.dispose(); currentOwnedGeoms.delete(m.geometry) }
        const mat = m.material
        if (Array.isArray(mat)) mat.forEach((mt) => mt.dispose())
        else mat.dispose()
      }
      meshesRef.current = []
      slotOrderRef.current.clear()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredGeometries, originalIndices, isMultiColor, materialSlots.length, triangleMaterialMaps, selectedPlateId])

  // =======================================================================
  // EFFECT 3 — Lightweight colour update
  // =======================================================================
  useEffect(() => {
    if (meshesRef.current.length === 0) return

    for (const [mi, order] of slotOrderRef.current) {
      const mesh = meshesRef.current[mi]
      if (!mesh) continue
      const mat = mesh.material
      if (Array.isArray(mat) && order.length === mat.length) {
        for (let gi = 0; gi < order.length; gi++) {
          const slot = materialSlots[order[gi]]
          if (slot && mat[gi]) (mat[gi] as THREE.MeshPhongMaterial).color.setHex(colorToHex(slot.selectedColor))
        }
      } else if (order.length === 1) {
        const slot = materialSlots[order[0]]
        if (slot) {
          ;((Array.isArray(mat) ? mat[0] : mat) as THREE.MeshPhongMaterial).color.setHex(
            colorToHex(slot.selectedColor),
          )
        }
      }
    }

    if (!isMultiColor) {
      for (const m of meshesRef.current) {
        const mat = m.material
        if (!Array.isArray(mat)) (mat as THREE.MeshPhongMaterial).color.setHex(colorToHex(color))
      }
    }
  }, [materialSlots, color, isMultiColor])

  // -----------------------------------------------------------------------
  // Styles
  // -----------------------------------------------------------------------
  const containerStyle: React.CSSProperties = {
    width: '100%',
    height: '100%',
    borderRadius: 8,
    border: `1px solid ${theme.border}`,
    overflow: 'hidden',
    position: 'relative',
    ...style,
  }

  const overlayStyle: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
    background: 'rgba(15,23,42,0.5)',
  }

  const showLoading = loading || (!model && !error && geometries.length === 0)

  return (
    <div ref={containerRef} className={className} style={containerStyle}>
      {showLoading && (
        <div style={overlayStyle}>
          <div
            style={{
              width: '100%',
              height: '100%',
              background: theme.surface,
              animation: 'pulse 2s ease-in-out infinite',
              borderRadius: 8,
            }}
          />
        </div>
      )}
      {error && (
        <div style={overlayStyle}>
          <div style={{ textAlign: 'center', padding: 32 }}>
            <p style={{ color: '#ef4444', marginBottom: 8 }}>Failed to render model</p>
            <p style={{ fontSize: 12, color: theme.textMuted }}>{error.message}</p>
          </div>
        </div>
      )}
      {showDebugOverlay && isMultiColor && materialSlots.length > 1 && (
        <div
          style={{
            position: 'absolute',
            top: 8,
            left: 8,
            zIndex: 20,
            background: 'rgba(0,0,0,0.7)',
            borderRadius: 6,
            padding: '4px 8px',
            fontSize: 11,
            fontFamily: theme.fontFamily,
            color: '#4ade80',
            pointerEvents: 'none',
            maxWidth: 200,
          }}
        >
          <div>🎨 {materialSlots.length} colors</div>
          <div style={{ display: 'flex', gap: 3, marginTop: 4, flexWrap: 'wrap' }}>
            {materialSlots.map((s, i) => (
              <div
                key={i}
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: 2,
                  border: '1px solid rgba(255,255,255,0.3)',
                  backgroundColor: s.selectedColor.startsWith('#') ? s.selectedColor : undefined,
                }}
                title={`${s.name}: ${s.selectedColor}`}
              />
            ))}
          </div>
          {debugInfo && (
            <div style={{ marginTop: 4, fontSize: 9, color: 'rgba(74,222,128,0.6)', whiteSpace: 'pre-wrap' }}>
              {debugInfo}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
