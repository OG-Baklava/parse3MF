/**
 * Core (framework-agnostic) exports.
 *
 * Use `parse3mf/core` when you only need the parser
 * and don't want a React dependency.
 *
 * @example
 * ```ts
 * import { parse3MF } from 'parse3mf/core'
 *
 * const result = await parse3MF(file)
 * console.log(result.isMultiColor, result.materialSlots)
 * ```
 *
 * @packageDocumentation
 */

export { parse3MF, ThreeMFParseError } from './parser'
export { calculateVolume, calculateBoundingBox } from './analyzer'
export { export3MF, download3MF } from './exporter'
export type { Export3MFOptions } from './exporter'

// Re-export all public types
export type {
  ParsedThreeMF,
  MaterialSlot,
  Plate,
  BoundingBox,
  ThreeMFMetadata,
  ParsedTriangle,
  ParsedGeomObject,
} from './types'
