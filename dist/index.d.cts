import { BufferGeometry } from 'three';
import * as react_jsx_runtime from 'react/jsx-runtime';
import { ReactNode } from 'react';

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
/** Theme overrides for the viewer components. */
interface ViewerTheme {
    /** Background colour of the 3D viewport (CSS colour or Three.js hex). Default: `"#0f172a"`. */
    background?: string;
    /** Font family for overlay text. Default: `"monospace"`. */
    fontFamily?: string;
    /** Accent colour used for borders, focus rings, etc. Default: `"#3b82f6"`. */
    accent?: string;
    /** Surface colour for panels/cards. Default: `"#1e293b"`. */
    surface?: string;
    /** Primary text colour. Default: `"#e2e8f0"`. */
    text?: string;
    /** Muted/secondary text colour. Default: `"#94a3b8"`. */
    textMuted?: string;
    /** Border colour. Default: `"rgba(59,130,246,0.3)"`. */
    border?: string;
}
/** Named colour map: display name → hex value. */
type ColorOption = {
    name: string;
    hex: string;
};
/** Props common to all wrapper components. */
interface ThreeMFViewerProps {
    /** The file to parse and display. Triggers re-parse when changed. */
    file?: File | null;
    /**
     * Colour options available in the picker dropdown.
     * Default: White, Black, Red, Blue, Green, Yellow, Orange, Grey.
     */
    colorOptions?: ColorOption[];
    /** Theme overrides. */
    theme?: ViewerTheme;
    /** Called when parsing completes. */
    onParsed?: (result: ParsedThreeMF) => void;
    /** Called when a material slot colour is changed. */
    onSlotColorChange?: (slotId: string, color: string, allSlots: MaterialSlot[]) => void;
    /** Called when the active plate changes. */
    onPlateChange?: (plateId: number) => void;
    /** Called on parse error. */
    onError?: (error: Error) => void;
    /** Called after a successful export/download. */
    onExported?: (blob: Blob) => void;
    /** Whether to show the save/download button. Default: true when model is loaded. */
    showSaveButton?: boolean;
    /** CSS class name for the root container. */
    className?: string;
    /** Inline style for the root container. */
    style?: React.CSSProperties;
}
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

interface ThreeMFState {
    /** The parsed model data (null before first parse). */
    model: ParsedThreeMF | null;
    /** The original file (kept for re-export). */
    originalFile: File | null;
    /** Whether the parser is currently running. */
    loading: boolean;
    /** Whether an export is currently running. */
    exporting: boolean;
    /** Last parse error, if any. */
    error: Error | null;
    /** Currently selected plate ID. */
    selectedPlateId: number | null;
    /** Current material slot state (with user color selections). */
    materialSlots: MaterialSlot[];
    /** The user's single-colour pick (for non-multicolor models). */
    color: string;
}
interface ThreeMFContextValue extends ThreeMFState {
    /** Parse a .3MF file. */
    loadFile: (file: File) => Promise<ParsedThreeMF | null>;
    /** Change the color of a material slot. */
    setSlotColor: (slotId: string, color: string) => void;
    /** Select a plate. */
    selectPlate: (plateId: number | null) => void;
    /** Set the single colour for non-multicolor models. */
    setColor: (color: string) => void;
    /** Export the modified .3MF as a Blob. */
    exportFile: (colorOptions?: ColorOption[]) => Promise<Blob | null>;
    /** Export and trigger a browser download of the modified .3MF. */
    downloadFile: (filename?: string, colorOptions?: ColorOption[]) => Promise<void>;
    /** Whether the model has color changes compared to the original. */
    hasColorChanges: boolean;
    /** Reset all state. */
    reset: () => void;
    isMultiColor: boolean;
    plates: Plate[];
    geometries: BufferGeometry[];
    triangleMaterialMaps: Map<number, Map<number, string>> | undefined;
    objectIdToGeometryIndex: Map<number, number> | undefined;
    compositeToGeometryMap: Map<number, number[]> | undefined;
    plateObjectMap: Map<number, number[]> | undefined;
}
interface ThreeMFProviderProps {
    children: ReactNode;
    /** Called after a successful parse. */
    onParsed?: (result: ParsedThreeMF) => void;
    /** Called on parse error. */
    onError?: (error: Error) => void;
    /** Called when a slot colour changes. */
    onSlotColorChange?: (slotId: string, color: string, allSlots: MaterialSlot[]) => void;
    /** Called when the active plate changes. */
    onPlateChange?: (plateId: number) => void;
    /** Called after a successful export/download. */
    onExported?: (blob: Blob) => void;
}
declare function ThreeMFProvider({ children, onParsed, onError, onSlotColorChange, onPlateChange, onExported, }: ThreeMFProviderProps): react_jsx_runtime.JSX.Element;
/**
 * Access the 3MF viewer state and actions.
 *
 * Must be used inside a `<ThreeMFProvider>`.
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { loadFile, model, materialSlots } = useThreeMF()
 *   return <input type="file" onChange={e => loadFile(e.target.files![0])} />
 * }
 * ```
 */
declare function useThreeMF(): ThreeMFContextValue;

interface ViewerProps {
    /** Theme overrides. */
    theme?: ViewerTheme;
    /** CSS class for the container div. */
    className?: string;
    /** Inline styles for the container div. */
    style?: React.CSSProperties;
    /** Show multicolor debug overlay. Default: false. */
    showDebugOverlay?: boolean;
}
/**
 * The 3D viewport that renders the parsed model.
 *
 * Must be used inside a `<ThreeMFProvider>`.
 */
declare function Viewer({ theme: themeOverrides, className, style, showDebugOverlay }: ViewerProps): react_jsx_runtime.JSX.Element;

interface ColorPickerProps {
    /** Available named colours. Falls back to built-in defaults. */
    colorOptions?: ColorOption[];
    /** Theme overrides. */
    theme?: ViewerTheme;
    /** CSS class for the root element. */
    className?: string;
    /** Inline styles for the root element. */
    style?: React.CSSProperties;
}
/**
 * Colour picker for each material slot.
 *
 * Only renders when the model has multiple colours detected.
 * Must be used inside a `<ThreeMFProvider>`.
 */
declare function ColorPicker({ colorOptions, theme: themeOverrides, className, style }: ColorPickerProps): react_jsx_runtime.JSX.Element | null;

interface PlateSelectorProps {
    /** Theme overrides. */
    theme?: ViewerTheme;
    /** CSS class for the root element. */
    className?: string;
    /** Inline styles for the root element. */
    style?: React.CSSProperties;
}
/**
 * Plate selector dropdown.
 *
 * Only renders when the model has multiple plates.
 * Must be used inside a `<ThreeMFProvider>`.
 */
declare function PlateSelector({ theme: themeOverrides, className, style }: PlateSelectorProps): react_jsx_runtime.JSX.Element | null;

interface SaveButtonProps {
    /** Theme overrides. */
    theme?: ViewerTheme;
    /** Color options to resolve named colors. */
    colorOptions?: ColorOption[];
    /** Custom filename (without extension). */
    filename?: string;
    /** CSS class for the root element. */
    className?: string;
    /** Inline styles for the root element. */
    style?: React.CSSProperties;
}
/**
 * Save/download button for the modified 3MF file.
 *
 * Shows a download button that exports the current color selections
 * back into the .3MF file.
 *
 * Must be used inside a `<ThreeMFProvider>`.
 */
declare function SaveButton({ theme: themeOverrides, colorOptions, filename, className, style, }: SaveButtonProps): react_jsx_runtime.JSX.Element | null;

/**
 * All-in-one 3MF viewer: viewport + plate selector + colour picker + save button.
 *
 * Wraps its own `<ThreeMFProvider>` — no extra setup needed.
 *
 * @example
 * ```tsx
 * import { ThreeMFWorkbench } from 'parse3mf'
 *
 * function App() {
 *   const [file, setFile] = useState<File | null>(null)
 *   return (
 *     <>
 *       <input type="file" onChange={e => setFile(e.target.files?.[0] ?? null)} />
 *       <ThreeMFWorkbench file={file} />
 *     </>
 *   )
 * }
 * ```
 */
declare function ThreeMFWorkbench(props: ThreeMFViewerProps): react_jsx_runtime.JSX.Element;

declare const DEFAULT_THEME: Required<ViewerTheme>;
declare const DEFAULT_COLOR_OPTIONS: ColorOption[];
declare function resolveTheme(overrides?: ViewerTheme): Required<ViewerTheme>;
/** Convert a named color or #hex string → Three.js int. */
declare function colorToHex(v: string): number;
/** CSS-safe hex for a named or hex colour. */
declare function colorToCss(v: string): string;

export { type BoundingBox, type ColorOption, ColorPicker, type ColorPickerProps, DEFAULT_COLOR_OPTIONS, DEFAULT_THEME, type Export3MFOptions, type MaterialSlot, type ParsedGeomObject, type ParsedThreeMF, type ParsedTriangle, type Plate, PlateSelector, type PlateSelectorProps, SaveButton, type SaveButtonProps, type ThreeMFContextValue, type ThreeMFMetadata, ThreeMFParseError, ThreeMFProvider, type ThreeMFProviderProps, type ThreeMFState, type ThreeMFViewerProps, ThreeMFWorkbench, Viewer, type ViewerProps, type ViewerTheme, calculateBoundingBox, calculateVolume, colorToCss, colorToHex, download3MF, export3MF, parse3MF, resolveTheme, useThreeMF };
