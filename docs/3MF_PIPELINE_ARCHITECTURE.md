# 3MF Parsing & Multicolor Rendering Pipeline

> **Version:** 2.7 — Last updated: Feb 2026
>
> This document describes how `.3MF` files are parsed, how multicolor data is
> detected and resolved, and how the results are rendered in the browser. **Read
> this before modifying any of the files listed below.** The system is
> intentionally structured this way to work around real-world edge cases in
> Bambu Studio and PrusaSlicer 3MF exports.

---

## Table of Contents

1. [File Map](#1-file-map)
2. [High-Level Data Flow](#2-high-level-data-flow)
3. [3MF File Structure (Background)](#3-3mf-file-structure-background)
4. [Parser — `src/core/parser.ts`](#4-parser--srccoreparserts)
   - [Step 1: ZIP Extraction & Main Model](#step-1-zip-extraction--main-model)
   - [Step 2: Resource Parsing (Colors)](#step-2-resource-parsing-colors)
   - [Step 3: Build Section & Composites](#step-3-build-section--composites)
   - [Step 4: Geometry Objects (Main + External)](#step-4-geometry-objects-main--external)
   - [Step 5: Slicer-Specific Coloring](#step-5-slicer-specific-coloring)
   - [Step 6: BufferGeometry Creation](#step-6-buffergeometry-creation)
   - [Step 7: Material Slot Generation](#step-7-material-slot-generation)
   - [Step 8: Plate Detection](#step-8-plate-detection)
5. [Paint Color Decoding (BambuStudio)](#5-paint-color-decoding-bambustudio)
6. [State Management — `src/react/context.tsx`](#6-state-management--srcreactcontexttsx)
7. [Renderer — `src/react/Viewer.tsx`](#7-renderer--srcreactviewertsx)
   - [Effect 1: Scene Bootstrap](#effect-1-scene-bootstrap)
   - [Effect 2: Mesh Building](#effect-2-mesh-building)
   - [Effect 3: Color Updates](#effect-3-color-updates)
   - [Multi-Material Groups (`buildMultiMaterialGeometry`)](#multi-material-groups-buildmultimaterialgeometry)
8. [Color Picker — `src/react/ColorPicker.tsx`](#8-color-picker--srcreactcolorpickertsx)
9. [Type Definitions — `src/core/types.ts`](#9-type-definitions--srccoretypests)
10. [Critical Invariants (DO NOT BREAK)](#10-critical-invariants-do-not-break)
11. [Common Pitfalls & Past Bugs](#11-common-pitfalls--past-bugs)
12. [Testing Checklist](#12-testing-checklist)

---

## 1. File Map

| File | Role |
|---|---|
| `src/core/parser.ts` | Parses `.3MF` ZIP → geometry, colors, plates, material slots |
| `src/core/exporter.ts` | Re-packages a `.3MF` with only color values changed (see [EXPORTER.md](./EXPORTER.md)) |
| `src/core/analyzer.ts` | Volume and bounding-box calculation |
| `src/core/types.ts` | Public TypeScript interfaces |
| `src/react/Viewer.tsx` | Three.js renderer with 3-effect architecture |
| `src/react/ColorPicker.tsx` | Per-slot color selection UI |
| `src/react/PlateSelector.tsx` | Plate dropdown selector |
| `src/react/SaveButton.tsx` | Export / download button |
| `src/react/context.tsx` | React context provider bridging parser → renderer |
| `src/react/Workbench.tsx` | All-in-one component (viewer + sidebar) |
| `src/styles/theme.ts` | Theming system |

---

## 2. High-Level Data Flow

```
┌──────────────┐     ┌──────────────────┐     ┌────────────────┐     ┌─────────────────┐
│  User drops   │────▶│  parser.ts       │────▶│  context.tsx    │────▶│  Viewer.tsx      │
│  .3MF file    │     │  (parse3MF)      │     │  (ThreeMF-     │     │  (Three.js)      │
│               │     │                  │     │   Provider)    │     │                  │
└──────────────┘     └──────────────────┘     └────────────────┘     └─────────────────┘
                            │                         │                        │
                            │  ParsedThreeMF          │ materialSlots          │ Effect 2: mesh build
                            │  {                      │ isMultiColor           │ Effect 3: color update
                            │    geometries[]         │ triangleMaterial-      │
                            │    materialSlots[]      │   Maps                 │
                            │    triangleMaterial-    │ plates                 │
                            │      Maps               │ selectedPlateId        │
                            │    plates[]             │                        │
                            │    isMultiColor         │                        │
                            │    ...                  │                        │
                            │  }                      │                        │
                            ▼                         ▼                        ▼
                                              ┌────────────────┐     ┌─────────────────┐
                                              │ ColorPicker    │     │ SaveButton      │
                                              │ (user picks    │     │ (export3MF →    │
                                              │  colors per    │     │  download)      │
                                              │  slot)         │     │                 │
                                              └────────────────┘     └─────────────────┘
```

---

## 3. 3MF File Structure (Background)

A `.3MF` file is a ZIP archive. Relevant contents:

```
my_model.3mf (ZIP)
├── 3D/
│   ├── 3dmodel.model              ← Main model XML (build section, composites, resources)
│   └── Objects/
│       ├── object_1.model         ← External geometry (vertices + triangles)
│       ├── object_2.model         ← Each has LOCAL resources (color groups)
│       └── ...
├── Metadata/
│   ├── model_settings.config      ← Per-object/part extruder assignments (Bambu Studio)
│   ├── project_settings.config    ← Filament colors, JSON format (Bambu Studio)
│   ├── slice_info.config          ← Filament colors, XML format
│   ├── plate_1.json               ← Plate object assignments (Bambu Studio)
│   ├── plate_2.json
│   └── filament_sequence.json     ← Plate count hint
└── Slic3r_PE_model.config         ← PrusaSlicer volume→extruder mapping
```

### Key 3MF XML Concepts

- **`<basematerials>`** / **`<colorgroup>`**: Define color palettes (by `id`)
- **`<object>`**: Either a geometry (has `<mesh>`) or a composite (has `<components>`)
- **`<triangle>`**: Each has `v1 v2 v3` vertex indices. May have:
  - `pid` + `p1`: Reference to a color resource
  - `paint_color="0C"`: BambuStudio hex-encoded per-triangle painting data
  - `mmu_segmentation`: PrusaSlicer equivalent
- **`<build>`**: Lists which objects are placed on the build plate
- **`<component>`**: References a child object in a composite

---

## 4. Parser — `src/core/parser.ts`

The parser (`parse3MF`) executes 8 sequential steps.

### Step 1: ZIP Extraction & Main Model

- Unzips with `JSZip`
- Finds the main model file (usually `3D/3dmodel.model`)
- Falls back to any `.model` file in `3D/`

### Step 2: Resource Parsing (Colors)

`parseResources()` extracts `<basematerials>` and `<colorgroup>` elements
into a `Map<id, PropertyResource>`. Each resource has an array of colors.

These are used to resolve `pid` + `pindex` references on objects and triangles.

**⚠ Scoping rule:** Each external `.model` file has its **own local resources**.
The parser merges main + local resources when parsing external files.

### Step 3: Build Section & Composites

- Parses `<build>` → `BuildItem[]` (which objects appear in the scene)
- Parses composite objects: objects with `<components>` instead of `<mesh>`
- Builds `compositeToGeometryMap`: composite ID → array of child geometry IDs
- Reads component-level `pid`/`pindex` color overrides → `componentColorOverrides`

### Step 4: Geometry Objects (Main + External)

`parseGeometryObjects()` extracts vertices, triangles, and per-triangle colors.

**Critical details:**

1. **Color resolution chain** (per triangle, in priority order):
   - Triangle `pid` + `p1` → resource lookup
   - Object-level `pid` + `pindex` → resource lookup
   - Component override color (passed as `defaultColor`)
   - `null` (no color assigned yet)

2. **Paint attribute extraction** — on each `<triangle>`, reads:
   - `paint_color` attribute (BambuStudio)
   - `slic3rpe:mmu_segmentation` attribute (PrusaSlicer)
   - Fallback: scans all attributes for names containing these keywords
     (DOM parsers may drop namespace prefixes)

3. **External object ID remapping** — when an external file like
   `object_4.model` contains a single object with internal `id="1"`, it's
   remapped to `id=4` (matching the file number). This is tracked in
   `externalIdRemap` and applied to `compositeToGeometryMap` after all
   external files are processed.

   **⚠ If you break this remapping, composite resolution will fail and plates
   will show wrong objects.**

### Step 5: Slicer-Specific Coloring

Applied in sub-steps:

#### 5a: Bambu Studio Extruder Assignments

- `parseModelSettings()` reads `Metadata/model_settings.config`
- Maps object/part IDs → extruder numbers (1-based)
- `extractFilamentColors()` reads filament colors from:
  1. `project_settings.config` (JSON with `filament_colour` key)
  2. `slice_info.config` (XML `<filament color="...">`)
  3. Any other `.config` file (INI or JSON)
- Applies: if an object has extruder N and no triangle-level colors,
  all its triangles get `filamentColors[N-1]`

#### 5b: PrusaSlicer Volume Mapping

- `parsePrusaSlicerMetadata()` reads `Slic3r_PE_model.config`
- Maps triangle ranges (`firstid`–`lastid`) → extruder numbers
- Applies extruder colors from `Slic3r_PE.config`

#### 5c: Paint Data Application (Per-Triangle)

This is the most complex and **most critical** step for multicolor.

- Iterates all objects; for each triangle with a `paintAttr`:
  1. Decodes the hex string via `decodePaintColorAttr()` → extruder state
  2. State > 0 → `filamentColors[state - 1]`
  3. State = 0 → object's default extruder color
- Triangles without `paintAttr` and no existing color get the default

See [Section 5: Paint Color Decoding](#5-paint-color-decoding-bambustudio)
for the encoding format.

#### 5d: Fallback Sequential Coloring

If no colors were resolved but multiple filaments/extruders are configured,
applies filament colors round-robin to objects.

### Step 6: BufferGeometry Creation

For each geometry object:
- Creates `THREE.BufferGeometry` with position + index attributes
- Builds `triangleMaterialMaps`: `Map<geomIndex, Map<triIndex, colorHex>>`
- Collects all unique colors into `allUniqueColors`
- Computes volume and bounding box

### Step 7: Material Slot Generation

Material slots are what the user sees in the color picker. Created by priority:

| Condition | Slot Source |
|---|---|
| `colorArray.length > 1` | One slot per unique triangle color |
| `filamentColors.length > 1` | One slot per filament from slicer config |
| `filamentCount > 1` (no colors) | Numbered slots with placeholder colors |
| PrusaSlicer extruder colors | One slot per extruder |
| None of the above | Single "Material 1" slot |

**Multicolor detection** is `true` if **any** of these signals fire:
- Multiple unique triangle colors
- Multiple distinct extruders in model_settings
- MMU segmentation data present
- Multiple filaments configured in project settings
- PrusaSlicer multi-extruder volumes

### Step 8: Plate Detection

- `parseBambuPlates()` reads `Metadata/plate_N.json` files
- Falls back to `filament_sequence.json` for plate count
- Empty plates get all build objects assigned
- If no plates found at all, creates a single "Plate 1" with all objects

---

## 5. Paint Color Decoding (BambuStudio)

BambuStudio stores per-triangle painting as a **hex-encoded bit-packed
quadtree** in the `paint_color` attribute on `<triangle>` elements.

### Encoding Format

```
paint_color="0C"
```

Each hex character = 4 bits. Characters are read **right to left** (last char
= lowest-offset bits).

### Bit Stream Structure (per tree node)

```
2 bits: split_sides (0 = leaf, 1-3 = number of sides split)

If split (split_sides > 0):
  2 bits: special_side index (skip for color determination)
  (split_sides + 1) children recursively (in reverse order)

If leaf (split_sides == 0):
  2 bits: state
    0-2: direct extruder state
    3: extended encoding marker
      → read 4-bit nibbles until nibble < 15
      → state = 3 + accumulated value
```

### State Meaning

| State | Meaning |
|---|---|
| 0 | Not painted (use object's default extruder) |
| 1 | Extruder 1 (1st filament color) |
| 2 | Extruder 2 (2nd filament color) |
| N | Extruder N |

### Dominant Color Resolution

For split nodes, the parser recursively decodes all children and picks the
**most frequent non-zero state** (majority vote). This gives a single dominant
extruder per triangle.

### Key Functions

| Function | Purpose |
|---|---|
| `paintHexToBits(hexStr)` | Hex string → flat bit array (right-to-left) |
| `decodePaintTreeNode(bits, pos, depth)` | Recursive tree decoder → dominant state |
| `decodePaintColorAttr(hexStr)` | Entry point: hex string → extruder number |

**⚠ Do NOT use regex-based XML extraction for paint data.** It was removed in
v2.7 because paint data lives in **triangle attributes**, not separate XML
elements.

---

## 6. State Management — `src/react/context.tsx`

React context provider with `useReducer`. Key fields for 3MF rendering:

| Field | Type | Description |
|---|---|---|
| `model` | `ParsedThreeMF \| null` | Full parser output |
| `originalFile` | `File \| null` | Kept for re-export |
| `materialSlots` | `MaterialSlot[]` | Color slots shown to user (mutable copy) |
| `selectedPlateId` | `number \| null` | Currently active plate |
| `exporting` | `boolean` | Whether an export is in progress |

Key actions:
- `PARSE_START` / `PARSE_SUCCESS` / `PARSE_ERROR` — file loading
- `SET_SLOT_COLOR` — user picks a new color for a slot
- `EXPORT_START` / `EXPORT_DONE` — export lifecycle

The `useThreeMF()` hook exposes all state plus derived convenience accessors
(`isMultiColor`, `plates`, `geometries`, etc.).

---

## 7. Renderer — `src/react/Viewer.tsx`

The component uses a **3-effect architecture** to separate concerns:

### Effect 1: Scene Bootstrap

**Runs:** Once on mount.
**Dependencies:** `[]` (empty).
**Does:**
- Creates `Scene`, `PerspectiveCamera`, `WebGLRenderer`, `OrbitControls`
- Adds ambient + directional lights
- Starts render loop (`requestAnimationFrame`)
- Sets up `ResizeObserver` for responsive canvas sizing

**Cleanup:** Cancels RAF, disconnects observer, disposes renderer/controls,
removes canvas from DOM.

**⚠ The container `<div>` is ALWAYS rendered.** Loading and error states
are absolutely-positioned overlays. If you conditionally render the container,
Effect 1 won't find `containerRef.current` and the scene won't initialize.

### Effect 2: Mesh Building

**Runs:** When geometry data or structural material data changes.
**Dependencies:**
```typescript
[
  filteredGeometries,  // Geometry buffers (filtered by plate)
  originalIndices,     // Maps filtered index → original geometry index
  isMultiColor,        // Multi-color flag
  materialSlots.length,// ★ Only slot COUNT, not slot contents
  triangleMaterialMaps,// Per-triangle color data
  selectedPlateId,     // Active plate
]
```

**Key optimization:** `materialSlots.length` instead of `materialSlots`.
This prevents a full mesh rebuild when the user only changes a slot's color
(which is handled by Effect 3). The actual slot data is read via
`slotsRef.current` (a mutable ref updated every render).

**For multicolor meshes:**
1. Checks `triangleMaterialMaps` for per-triangle colors
2. If multiple unique colors exist → calls `buildMultiMaterialGeometry()`
3. Creates a single `THREE.Mesh` with an array of `MeshPhongMaterial`s
4. Stores slot order in `slotOrderRef` for Effect 3

**Cleanup:** Removes meshes from scene, disposes owned geometries & materials.

### Effect 3: Color Updates

**Runs:** When `materialSlots` or `color` changes.
**Dependencies:** `[materialSlots, color, isMultiColor]`
**Does:**
- Iterates `meshesRef.current`
- For multi-material meshes: reads `slotOrderRef` to find which material
  index corresponds to which slot, updates `material.color`
- For single-color meshes: updates material color directly

**⚠ This effect does NOT rebuild meshes.** It only mutates existing
`THREE.MeshPhongMaterial` objects. This is what makes color picker
interactions fast.

### Multi-Material Groups (`buildMultiMaterialGeometry`)

This is the core rendering strategy for multicolor:

```
Input:
  - src: BufferGeometry (original, with interleaved triangle colors)
  - triColorMap: Map<triangleIndex, colorHex>
  - slots: MaterialSlot[]

Process:
  1. Map each color hex → slot index
  2. Bucket triangles by slot (triangle indices grouped by material)
  3. Build sorted index buffer (all slot-0 triangles first, then slot-1, etc.)
  4. Create geometry.addGroup(start, count, materialIndex) for each bucket
  5. Create MeshPhongMaterial[] (one per group)

Output:
  - geometry: New BufferGeometry with re-ordered indices + groups
  - materials: Material array (same length as groups)
  - slotOrder: Which slot index each group corresponds to
```

**Why this approach?**
- A single `THREE.Mesh` with a material array is the standard Three.js
  pattern for multi-material rendering
- Much more efficient than splitting into separate geometries
- `geometry.addGroup()` tells Three.js which index range uses which material
- No vertex duplication needed (position buffer is shared)

**⚠ The index buffer is cloned, not mutated.** The original geometry from
the parser is NOT modified.

---

## 8. Color Picker — `src/react/ColorPicker.tsx`

Renders one row per `MaterialSlot`:
- Shows original file color swatch (if slot ID is a hex color)
- Dropdown includes:
  - "Original ({hex})" option if the current color is from the file
  - All named colors from the `colorOptions` prop (or built-in defaults)
- Calls `setSlotColor(slotId, color)` on change

`colorToCss()` (in `styles/theme.ts`) resolves named colors → hex for CSS:
- Returns hex strings as-is if they start with `#`
- Maps named colors ("White", "Black", etc.) to hex values
- Falls back to `#94a3b8` for unknowns

---

## 9. Type Definitions — `src/core/types.ts`

```typescript
interface MaterialSlot {
  id: string          // Unique identifier (usually hex color or "filament_N")
  name: string        // Display name ("Color 1", "Filament 2")
  objectIds: number[] // Which geometry indices use this slot
  selectedColor: string // Current user selection (hex or named color)
}

interface Plate {
  id: number
  name: string
  objectIds: number[] // Object IDs on this plate
}

interface ParsedThreeMF {
  geometries: BufferGeometry[]
  materialSlots: MaterialSlot[]
  isMultiColor: boolean
  triangleMaterialMaps?: Map<number, Map<number, string>>
  plates?: Plate[]
  plateObjectMap?: Map<number, number[]>
  objectIdToGeometryIndex?: Map<number, number>
  compositeToGeometryMap?: Map<number, number[]>
  volume: number             // cm³
  boundingBox: BoundingBox   // { x, y, z } in mm
  metadata: ThreeMFMetadata
}
```

---

## 10. Critical Invariants (DO NOT BREAK)

These are the rules that, if violated, will cause multicolor or plate
rendering to fail silently:

### Parser Invariants

1. **External ID remapping must update `compositeToGeometryMap`.**
   When `object_4.model` has internal `id=1` → mapped to `id=4`,
   composites referencing `id=1` must be updated to `id=4`.

2. **`paint_color` is a triangle ATTRIBUTE, not a child element.**
   Do not attempt DOM element queries for paint data. Read it from
   `<triangle paint_color="0C" v1="..." v2="..." v3="...">`.

3. **Hex paint decoding reads right-to-left.**
   `paintHexToBits()` iterates from the LAST character to the first.
   Each character yields 4 bits in LSB order.

4. **Filament colors must include black (`#000000`).**
   The filter only removes `#808080` and `#FFFFFF` as truly uninformative
   defaults. Black is a valid and common filament color.

5. **`normalizeColor()` strips alpha channels.**
   9-character hex strings (`#RRGGBBAA`) are truncated to 7 (`#RRGGBB`).

6. **Each external `.model` file has LOCAL resource scope.**
   Color groups defined in `object_2.model` are NOT visible to
   `object_3.model`. The parser merges main + local resources per file.

### Renderer Invariants

7. **The container `<div>` must ALWAYS be rendered.**
   Loading/error states use absolutely-positioned overlays. If the div is
   conditionally rendered, the Three.js scene won't initialize.

8. **Effect 2 depends on `materialSlots.length`, not `materialSlots`.**
   This is intentional. Full mesh rebuilds happen only when the slot count
   changes (new file loaded). Color updates are handled by Effect 3.
   If you add `materialSlots` to Effect 2's deps, every color picker
   interaction will trigger an expensive full rebuild.

9. **`slotOrderRef` maps mesh index → slot indices (in material order).**
   Effect 3 uses this to know which `material[i]` in a multi-material
   mesh corresponds to which `materialSlots[j]`. If you break this
   mapping, color updates will apply to the wrong material groups.

10. **`slotsRef.current` is the live slot data for Effect 2.**
    Since `materialSlots` is not in Effect 2's deps (only `.length` is),
    Effect 2 reads current slot colors from this ref. Do not remove it.

### Exporter Invariants

11. **Surgical string replacement only.**
    The exporter does NOT use DOM parsing / re-serialization or JSON
    parse / stringify. Only exact color hex values inside known fields
    are replaced. Every other byte must be preserved exactly. See
    [EXPORTER.md](./EXPORTER.md) for full details.

12. **Cross-reference config and XML colors positionally.**
    Slot IDs may come from the config file (`filament_colour`) while the
    model XML `<basematerials>` may have different hex values for the same
    filament. The exporter cross-references by position to cover both
    representations. If you break this, color 1 may revert to its
    original XML value (commonly black).

---

## 11. Common Pitfalls & Past Bugs

| Bug | Root Cause | Fix |
|---|---|---|
| All plates show same objects | `compositeToGeometryMap` had stale IDs after external remapping | Apply `externalIdRemap` to composite map |
| Multicolor detected but single color shown | `extractPaintDataFromXml` searched for XML elements, but data was in triangle attributes | Read `paint_color` from `<triangle>` attributes |
| V8 regex backtracking crash on large files | Regex used for XML extraction | Replaced with `indexOf`-based parsing (then removed entirely) |
| Color picker causes lag | `materialSlots` in Effect 2 deps | Changed to `materialSlots.length` |
| Wrong colors after selection | Effect 3 used mesh index to find slot | Introduced `slotOrderRef` for correct mapping |
| Black filament missing | `extractFilamentColors` filtered `#000000` | Removed black from filter |
| Namespace-prefixed attributes missed | `getAttribute('paint_color')` fails for `Bambu:paint_color` | Fallback scan of all attributes |
| Colour 1 turns black on export | Slot IDs from config didn't match XML basematerials hex values | Cross-reference config + XML colors positionally in exporter |

---

## 12. Testing Checklist

When modifying any of these files, verify with:

- [ ] **Single-color 3MF** — single material slot, correct color
- [ ] **Multi-color 3MF (Bambu Studio, paint_color)** — multiple color
      swatches visible, correct colors on model
- [ ] **Multi-color 3MF (PrusaSlicer, mmu_segmentation)** — same as above
- [ ] **Multi-plate 3MF** — plate selector visible, switching plates changes
      visible objects
- [ ] **Color picker** — changing a slot color updates the model instantly
      without a full rebuild (no flicker/lag)
- [ ] **External objects** — models with `3D/Objects/object_N.model` files
      render correctly
- [ ] **Composite objects** — models where build items reference composite
      objects (with `<components>`) resolve to correct geometry
- [ ] **Large files (50MB+)** — no regex crashes, reasonable parse time
- [ ] **Export round-trip** — export modified 3MF, re-import in slicer,
      verify only changed colors differ
- [ ] **Export with mismatched hex** — file where basematerials hex differs
      from config `filament_colour` hex still exports correctly
- [ ] **Export unchanged file** — exporting with no color changes returns
      the original file byte-for-byte
