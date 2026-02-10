import type { BufferGeometry } from 'three'

// ---------------------------------------------------------------------------
// Public types — these form the library's API contract
// ---------------------------------------------------------------------------

/** A material/color slot that the user can configure. */
export interface MaterialSlot {
  /** Unique identifier (usually the hex color from the file, e.g. "#FF0000", or "filament_1"). */
  id: string
  /** Display name shown in the UI (e.g. "Color 1", "Filament 2"). */
  name: string
  /** Geometry indices that use this material. */
  objectIds: number[]
  /** Current color selection — either a hex string ("#RRGGBB") or a named color. */
  selectedColor: string
}

/** A print plate defined in the 3MF file. */
export interface Plate {
  id: number
  name: string
  /** Object IDs assigned to this plate. */
  objectIds: number[]
}

/** Metadata extracted from the 3MF file header. */
export interface ThreeMFMetadata {
  title?: string
  designer?: string
  description?: string
  copyright?: string
}

/** Bounding box dimensions in millimetres. */
export interface BoundingBox {
  x: number
  y: number
  z: number
}

/**
 * The complete result of parsing a `.3MF` file.
 *
 * This is the single object that connects the parser to the viewer.
 */
export interface ParsedThreeMF {
  /** Model volume in cm³. */
  volume: number
  /** Bounding box in mm. */
  boundingBox: BoundingBox
  /** Material/color slots for the UI. */
  materialSlots: MaterialSlot[]
  /** Whether the file contains multicolor data. */
  isMultiColor: boolean
  /** File-level metadata. */
  metadata: ThreeMFMetadata
  /** One `BufferGeometry` per geometry object in the file. */
  geometries: BufferGeometry[]
  /**
   * Per-triangle color assignments.
   * Outer key: geometry index.  Inner map: triangle index → color hex.
   */
  triangleMaterialMaps?: Map<number, Map<number, string>>
  /** All plates found in the file. */
  plates?: Plate[]
  /** Plate ID → array of object IDs on that plate. */
  plateObjectMap?: Map<number, number[]>
  /** 3MF object ID → index in `geometries` array. */
  objectIdToGeometryIndex?: Map<number, number>
  /** Composite object ID → array of child geometry object IDs. */
  compositeToGeometryMap?: Map<number, number[]>
}

// ---------------------------------------------------------------------------
// Viewer configuration
// ---------------------------------------------------------------------------

/** Theme overrides for the viewer components. */
export interface ViewerTheme {
  /** Background colour of the 3D viewport (CSS colour or Three.js hex). Default: `"#0f172a"`. */
  background?: string
  /** Font family for overlay text. Default: `"monospace"`. */
  fontFamily?: string
  /** Accent colour used for borders, focus rings, etc. Default: `"#3b82f6"`. */
  accent?: string
  /** Surface colour for panels/cards. Default: `"#1e293b"`. */
  surface?: string
  /** Primary text colour. Default: `"#e2e8f0"`. */
  text?: string
  /** Muted/secondary text colour. Default: `"#94a3b8"`. */
  textMuted?: string
  /** Border colour. Default: `"rgba(59,130,246,0.3)"`. */
  border?: string
}

/** Named colour map: display name → hex value. */
export type ColorOption = { name: string; hex: string }

/** Props common to all wrapper components. */
export interface ThreeMFViewerProps {
  /** The file to parse and display. Triggers re-parse when changed. */
  file?: File | null
  /**
   * Colour options available in the picker dropdown.
   * Default: White, Black, Red, Blue, Green, Yellow, Orange, Grey.
   */
  colorOptions?: ColorOption[]
  /** Theme overrides. */
  theme?: ViewerTheme
  /** Called when parsing completes. */
  onParsed?: (result: ParsedThreeMF) => void
  /** Called when a material slot colour is changed. */
  onSlotColorChange?: (slotId: string, color: string, allSlots: MaterialSlot[]) => void
  /** Called when the active plate changes. */
  onPlateChange?: (plateId: number) => void
  /** Called on parse error. */
  onError?: (error: Error) => void
  /** CSS class name for the root container. */
  className?: string
  /** Inline style for the root container. */
  style?: React.CSSProperties
}

// ---------------------------------------------------------------------------
// Internal parser types (re-exported for advanced use)
// ---------------------------------------------------------------------------

export interface ParsedTriangle {
  v1: number
  v2: number
  v3: number
  colorHex: string | null
  /** Raw `paint_color` / `mmu_segmentation` hex attribute from BambuStudio/PrusaSlicer. */
  paintAttr?: string
}

export interface ParsedGeomObject {
  id: number
  name: string
  vertices: number[]
  triangles: ParsedTriangle[]
  sourceFile?: string
}
