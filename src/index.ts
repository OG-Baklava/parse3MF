/**
 * `parse3mf` — Drop-in 3MF file parser and multicolor 3D model viewer
 * for React. Slicer-accurate colour detection for Bambu Studio and PrusaSlicer
 * files.
 *
 * ## Quick Start
 *
 * ### All-in-one
 * ```tsx
 * import { ThreeMFWorkbench } from 'parse3mf'
 *
 * <ThreeMFWorkbench file={file} onParsed={r => console.log(r)} />
 * ```
 *
 * ### Composable
 * ```tsx
 * import {
 *   ThreeMFProvider,
 *   useThreeMF,
 *   Viewer,
 *   ColorPicker,
 *   PlateSelector,
 * } from 'parse3mf'
 *
 * function App() {
 *   return (
 *     <ThreeMFProvider>
 *       <MyCustomLayout />
 *     </ThreeMFProvider>
 *   )
 * }
 * ```
 *
 * ### Parser only (no React)
 * ```ts
 * import { parse3MF } from 'parse3mf/core'
 * ```
 *
 * @packageDocumentation
 */

// ─── Core (parser + types) ──────────────────────────────────────────────────
export { parse3MF, ThreeMFParseError } from './core/parser'
export { calculateVolume, calculateBoundingBox } from './core/analyzer'

// ─── Types ──────────────────────────────────────────────────────────────────
export type {
  ParsedThreeMF,
  MaterialSlot,
  Plate,
  BoundingBox,
  ThreeMFMetadata,
  ViewerTheme,
  ColorOption,
  ThreeMFViewerProps,
  ParsedTriangle,
  ParsedGeomObject,
} from './core/types'

// ─── React components ───────────────────────────────────────────────────────
export { ThreeMFProvider, useThreeMF } from './react/context'
export type { ThreeMFProviderProps, ThreeMFContextValue, ThreeMFState } from './react/context'

export { Viewer } from './react/Viewer'
export type { ViewerProps } from './react/Viewer'

export { ColorPicker } from './react/ColorPicker'
export type { ColorPickerProps } from './react/ColorPicker'

export { PlateSelector } from './react/PlateSelector'
export type { PlateSelectorProps } from './react/PlateSelector'

export { ThreeMFWorkbench } from './react/Workbench'

// ─── Theming ────────────────────────────────────────────────────────────────
export { DEFAULT_THEME, DEFAULT_COLOR_OPTIONS, resolveTheme, colorToHex, colorToCss } from './styles/theme'
