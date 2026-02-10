import { BufferGeometry } from 'three';

/** A material/color slot that the user can configure. */
interface MaterialSlot {
    /** Unique identifier (usually the hex color from the file, e.g. "#FF0000", or "filament_1"). */
    id: string;
    /** Display name shown in the UI (e.g. "Color 1", "Filament 2"). */
    name: string;
    /** Geometry indices that use this material. */
    objectIds: number[];
    /** Current color selection — either a hex string ("#RRGGBB") or a named color. */
    selectedColor: string;
}
/** A print plate defined in the 3MF file. */
interface Plate {
    id: number;
    name: string;
    /** Object IDs assigned to this plate. */
    objectIds: number[];
}
/** Metadata extracted from the 3MF file header. */
interface ThreeMFMetadata {
    title?: string;
    designer?: string;
    description?: string;
    copyright?: string;
}
/** Bounding box dimensions in millimetres. */
interface BoundingBox {
    x: number;
    y: number;
    z: number;
}
/**
 * The complete result of parsing a `.3MF` file.
 *
 * This is the single object that connects the parser to the viewer.
 */
interface ParsedThreeMF {
    /** Model volume in cm³. */
    volume: number;
    /** Bounding box in mm. */
    boundingBox: BoundingBox;
    /** Material/color slots for the UI. */
    materialSlots: MaterialSlot[];
    /** Whether the file contains multicolor data. */
    isMultiColor: boolean;
    /** File-level metadata. */
    metadata: ThreeMFMetadata;
    /** One `BufferGeometry` per geometry object in the file. */
    geometries: BufferGeometry[];
    /**
     * Per-triangle color assignments.
     * Outer key: geometry index.  Inner map: triangle index → color hex.
     */
    triangleMaterialMaps?: Map<number, Map<number, string>>;
    /** All plates found in the file. */
    plates?: Plate[];
    /** Plate ID → array of object IDs on that plate. */
    plateObjectMap?: Map<number, number[]>;
    /** 3MF object ID → index in `geometries` array. */
    objectIdToGeometryIndex?: Map<number, number>;
    /** Composite object ID → array of child geometry object IDs. */
    compositeToGeometryMap?: Map<number, number[]>;
}
/** Named colour map: display name → hex value. */
type ColorOption = {
    name: string;
    hex: string;
};
interface ParsedTriangle {
    v1: number;
    v2: number;
    v3: number;
    colorHex: string | null;
    /** Raw `paint_color` / `mmu_segmentation` hex attribute from BambuStudio/PrusaSlicer. */
    paintAttr?: string;
}
interface ParsedGeomObject {
    id: number;
    name: string;
    vertices: number[];
    triangles: ParsedTriangle[];
    sourceFile?: string;
}

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

/** Thrown when a 3MF file cannot be parsed. */
declare class ThreeMFParseError extends Error {
    constructor(message: string);
}
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
declare function parse3MF(file: File): Promise<ParsedThreeMF>;

/**
 * Calculate volume of a BufferGeometry using the signed-tetrahedron method.
 * @returns Volume in cm³ (assumes model units are mm).
 */
declare function calculateVolume(geometry: BufferGeometry): number;
/**
 * Calculate bounding-box dimensions.
 * @returns { x, y, z } in mm.
 */
declare function calculateBoundingBox(geometry: BufferGeometry): BoundingBox;

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

interface Export3MFOptions {
    /**
     * The original .3MF file. Used as the base — only color values are changed.
     */
    originalFile: File | Blob | ArrayBuffer;
    /**
     * The current material slots with the user's color selections.
     */
    materialSlots: MaterialSlot[];
    /**
     * Optional color options to resolve named colors to hex.
     * Defaults to the built-in color map.
     */
    colorOptions?: ColorOption[];
    /**
     * Output filename (without extension). Default: original filename + "_modified".
     */
    filename?: string;
}
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
declare function export3MF(options: Export3MFOptions): Promise<Blob>;
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
declare function download3MF(options: Export3MFOptions): Promise<void>;

export { type BoundingBox, type Export3MFOptions, type MaterialSlot, type ParsedGeomObject, type ParsedThreeMF, type ParsedTriangle, type Plate, type ThreeMFMetadata, ThreeMFParseError, calculateBoundingBox, calculateVolume, download3MF, export3MF, parse3MF };
