# parse3MF

[![npm version](https://img.shields.io/npm/v/parse3mf.svg)](https://www.npmjs.com/package/parse3mf)
[![license](https://img.shields.io/npm/l/parse3mf.svg)](https://github.com/OG-Baklava/parse3MF/blob/main/LICENSE)

Drop-in **3MF file parser**, **multicolor 3D model viewer**, and **color-safe exporter** for React.

Slicer-accurate colour detection for **Bambu Studio**, **PrusaSlicer**, **Cura**, and any slicer following the 3MF Core Specification. Built for print-on-demand services that need clients to preview, configure colours, export modified files, and select plates before sending to print.

---

## Features

- 🎨 **Multicolor rendering** — per-triangle material groups, paint-color decoding, multi-material meshes
- 🖨️ **Slicer parity** — reads `paint_color`, `mmu_segmentation`, filament configs, extruder assignments, plates
- 💾 **Production-safe export** — save modified .3MF files with only colour values changed, preserving all geometry and print settings
- 🧩 **Plug & play** — one `<ThreeMFWorkbench>` component and you're done
- 🔧 **Composable** — use `<Viewer>`, `<ColorPicker>`, `<PlateSelector>`, `<SaveButton>` individually with full control
- 📦 **Headless mode** — `parse3MF()` and `export3MF()` work without React (Node.js / web workers)
- 🎭 **Themeable** — full control over colours, fonts, borders via props
- 🪶 **Zero CSS imports** — all styles are inline, works in any project

---

## Install

```bash
npm install parse3mf three jszip
# or
pnpm add parse3mf three jszip
# or
yarn add parse3mf three jszip
```

`three` and `jszip` are **peer dependencies** — you likely already have them.

---

## Quick Start

### All-in-one (simplest)

```tsx
import { useState } from 'react'
import { ThreeMFWorkbench } from 'parse3mf'

export default function App() {
  const [file, setFile] = useState<File | null>(null)

  return (
    <div style={{ height: '100vh' }}>
      <input
        type="file"
        accept=".3mf"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />
      <ThreeMFWorkbench
        file={file}
        showSaveButton
        onParsed={(result) => {
          console.log('Volume:', result.volume, 'cm³')
          console.log('Multi-color:', result.isMultiColor)
          console.log('Material slots:', result.materialSlots)
        }}
        onSlotColorChange={(slotId, color, allSlots) => {
          console.log(`Slot ${slotId} → ${color}`)
        }}
        onExported={(blob) => {
          console.log('Exported .3MF:', blob.size, 'bytes')
        }}
      />
    </div>
  )
}
```

### Composable (full control)

```tsx
import {
  ThreeMFProvider,
  useThreeMF,
  Viewer,
  ColorPicker,
  PlateSelector,
  SaveButton,
} from 'parse3mf'

function UploadButton() {
  const { loadFile } = useThreeMF()
  return (
    <input
      type="file"
      accept=".3mf"
      onChange={(e) => {
        const f = e.target.files?.[0]
        if (f) loadFile(f)
      }}
    />
  )
}

function ModelInfo() {
  const { model, loading, error } = useThreeMF()
  if (loading) return <p>Parsing…</p>
  if (error) return <p>Error: {error.message}</p>
  if (!model) return <p>Drop a .3mf file</p>
  return (
    <ul>
      <li>Volume: {model.volume.toFixed(2)} cm³</li>
      <li>
        Size: {model.boundingBox.x.toFixed(1)} × {model.boundingBox.y.toFixed(1)} ×{' '}
        {model.boundingBox.z.toFixed(1)} mm
      </li>
      <li>Multi-color: {model.isMultiColor ? 'Yes' : 'No'}</li>
    </ul>
  )
}

export default function App() {
  return (
    <ThreeMFProvider onParsed={(r) => console.log(r)}>
      <UploadButton />
      <ModelInfo />
      <div style={{ display: 'flex', gap: 16, height: '80vh' }}>
        <div style={{ flex: 1 }}>
          <Viewer showDebugOverlay />
        </div>
        <div style={{ width: 260 }}>
          <PlateSelector />
          <ColorPicker />
          <SaveButton />
        </div>
      </div>
    </ThreeMFProvider>
  )
}
```

### Parser only (no React)

```ts
import { parse3MF } from 'parse3mf/core'

const file = getFileFromSomewhere() // File object
const result = await parse3MF(file)

console.log(result.isMultiColor)       // true
console.log(result.materialSlots)       // [{ id: '#FF0000', name: 'Color 1', ... }]
console.log(result.geometries.length)   // 3
console.log(result.plates)              // [{ id: 1, name: 'Plate 1', objectIds: [1,2,3] }]
```

### Export only (no React)

```ts
import { parse3MF, export3MF, download3MF } from 'parse3mf/core'

// Parse
const result = await parse3MF(file)

// Modify colours
const updatedSlots = result.materialSlots.map((slot, i) =>
  i === 0 ? { ...slot, selectedColor: '#EF4444' } : slot
)

// Export as Blob
const blob = await export3MF({
  originalFile: file,
  materialSlots: updatedSlots,
})

// Or trigger a browser download directly
await download3MF({
  originalFile: file,
  materialSlots: updatedSlots,
  filename: 'my-model-recolored',
})
```

---

## API Reference

### Components

| Component | Description |
|---|---|
| `<ThreeMFWorkbench>` | All-in-one: viewport + sidebar + save button (wraps its own Provider) |
| `<ThreeMFProvider>` | Context provider — wrap your app to share state |
| `<Viewer>` | 3D viewport — renders the parsed model with Three.js |
| `<ColorPicker>` | Colour selection dropdown per material slot |
| `<PlateSelector>` | Plate dropdown (only visible for multi-plate files) |
| `<SaveButton>` | Export/download button — auto-disables when no colours changed |

### Hook

```ts
const {
  // State
  model,              // ParsedThreeMF | null
  loading,            // boolean
  exporting,          // boolean
  error,              // Error | null
  materialSlots,      // MaterialSlot[]
  selectedPlateId,    // number | null
  isMultiColor,       // boolean
  hasColorChanges,    // boolean

  // Actions
  loadFile,           // (file: File) => Promise<ParsedThreeMF | null>
  setSlotColor,       // (slotId: string, color: string) => void
  selectPlate,        // (plateId: number | null) => void
  setColor,           // (color: string) => void
  exportFile,         // (colorOptions?) => Promise<Blob | null>
  downloadFile,       // (filename?, colorOptions?) => Promise<void>
  reset,              // () => void

  // Derived
  plates,             // Plate[]
  geometries,         // BufferGeometry[]
  triangleMaterialMaps,
  objectIdToGeometryIndex,
  compositeToGeometryMap,
  plateObjectMap,
} = useThreeMF()
```

### Core functions

```ts
// Parse a .3MF file
async function parse3MF(file: File): Promise<ParsedThreeMF>

// Export with modified colours (returns Blob)
async function export3MF(options: Export3MFOptions): Promise<Blob>

// Export and trigger browser download
async function download3MF(options: Export3MFOptions): Promise<void>
```

### Key types

```ts
interface ParsedThreeMF {
  volume: number                         // cm³
  boundingBox: BoundingBox               // { x, y, z } in mm
  materialSlots: MaterialSlot[]          // Color/filament slots
  isMultiColor: boolean
  metadata: ThreeMFMetadata
  geometries: BufferGeometry[]
  triangleMaterialMaps?: Map<number, Map<number, string>>
  plates?: Plate[]
  plateObjectMap?: Map<number, number[]>
  objectIdToGeometryIndex?: Map<number, number>
  compositeToGeometryMap?: Map<number, number[]>
}

interface MaterialSlot {
  id: string              // e.g. '#FF0000' or 'filament_1'
  name: string            // e.g. 'Color 1'
  objectIds: number[]     // Geometry indices
  selectedColor: string   // Current colour pick
}

interface Export3MFOptions {
  originalFile: File | Blob | ArrayBuffer
  materialSlots: MaterialSlot[]
  colorOptions?: ColorOption[]
  filename?: string
}

interface ColorOption {
  name: string            // e.g. 'PLA Red'
  hex: string             // e.g. '#cc0000'
}
```

---

## Exporting Modified .3MF Files

The exporter is designed for **production 3D printing workflows** where file integrity is critical. It uses **surgical string replacement** — only the exact colour hex values inside known fields are changed. Everything else (geometry, print settings, G-code metadata, calibration data) is preserved byte-for-byte.

### What gets patched

| Source | Fields |
|---|---|
| Model XML (`3D/*.model`) | `displaycolor` on `<base>`, `color` on `<color>` |
| `project_settings.config` | `filament_colour` / `filament_color` (JSON array or INI line) |
| `slice_info.config` | `color` on `<filament>` elements |
| PrusaSlicer configs | `extruder_colour` / `filament_colour` lines |

### Safety guarantees

- No DOM re-serialization — no `XMLSerializer`, no `JSON.stringify`
- Alpha suffixes preserved — `#FF0000FF` → `#3B82F6FF`
- No-change passthrough — returns original bytes if nothing was modified
- Untouched files stay untouched — only files with actual changes are re-written in the ZIP
- Cross-references config and XML colours positionally to handle hex mismatches between sources

> For full exporter internals, see [`docs/EXPORTER.md`](docs/EXPORTER.md).

---

## Theming

Pass a `theme` prop to any component:

```tsx
<ThreeMFWorkbench
  file={file}
  theme={{
    background: '#1a1a2e',
    accent: '#e94560',
    surface: '#16213e',
    text: '#eee',
    textMuted: '#888',
    border: 'rgba(233,69,96,0.3)',
    fontFamily: '"Inter", sans-serif',
  }}
/>
```

Or provide custom colour options:

```tsx
<ColorPicker
  colorOptions={[
    { name: 'PLA White', hex: '#f5f5f5' },
    { name: 'PLA Black', hex: '#222222' },
    { name: 'PETG Red', hex: '#cc0000' },
  ]}
/>
```

---

## How It Works

### Parsing

1. **ZIP extraction** — JSZip opens the .3MF (which is a ZIP archive)
2. **XML parsing** — DOMParser reads `3D/3dmodel.model` + external objects
3. **Resource resolution** — `<basematerials>`, `<colorgroup>` → colour lookup table
4. **Composite resolution** — `<components>` link parent objects to geometry children
5. **Slicer metadata** — filament colours, extruder assignments, plate definitions
6. **Paint decoding** — `paint_color` hex attributes → per-triangle extruder states via bit-packed quadtree
7. **Geometry creation** — `BufferGeometry` with sorted index buffer for multi-material groups
8. **Three.js rendering** — 3-effect architecture: scene bootstrap → mesh build → colour update

### Exporting

1. **Remap construction** — compares each slot's current colour to its original
2. **Cross-referencing** — maps config filament colours to XML basematerials by position
3. **Surgical patching** — regex-based replacement of hex values in specific fields only
4. **ZIP re-packaging** — only modified files are written back; everything else is preserved

### Multicolor Detection Chain

The parser checks for multicolor in this order:

1. XML `<colorgroup>` / `<basematerials>` with triangle-level `pid`/`p1` (standard 3MF)
2. Bambu Studio: filament colors from JSON `project_settings.config`
3. Bambu Studio: per-object/part extruder assignments from `model_settings.config`
4. Bambu Studio: `paint_color` hex attributes on `<triangle>` elements
5. Bambu Studio: filament count from JSON array lengths
6. PrusaSlicer: volume triangle ranges + per-volume extruder assignments
7. Component-level `pid`/`pindex` applied to external objects
8. External object ID remapping with composite map fixup

> For full parser internals, see [`docs/3MF_PIPELINE_ARCHITECTURE.md`](docs/3MF_PIPELINE_ARCHITECTURE.md).

---

## Supported Slicers

| Slicer | Multicolor | Plates | Paint Data | Export |
|---|:---:|:---:|:---:|:---:|
| Bambu Studio | ✅ | ✅ | ✅ | ✅ |
| PrusaSlicer | ✅ | — | ✅ | ✅ |
| Cura | ✅ | — | — | ✅ |
| Generic 3MF | ✅ | — | — | ✅ |

---

## Use Cases

- **Print-on-demand services** — let clients preview their model, pick colours per filament, export modified files, and select plates before ordering
- **3D print colour configurators** — embed a colour picker that produces production-ready .3MF files with only the chosen colours changed
- **3D print quoting tools** — extract volume, bounding box, and material slot count for automated pricing
- **Model preview widgets** — embed a lightweight 3MF viewer in any React app
- **Slicer pre-processing** — parse, inspect, and modify 3MF files before sending to a slicer API

---

## Documentation

| Document | Description |
|---|---|
| [`docs/3MF_PIPELINE_ARCHITECTURE.md`](docs/3MF_PIPELINE_ARCHITECTURE.md) | Full parser & renderer architecture, critical invariants, testing checklist |
| [`docs/EXPORTER.md`](docs/EXPORTER.md) | Exporter design, API reference, cross-referencing, safety guarantees |

---

## Why parse3mf?

Most 3D file viewers on npm focus on STL files and give you a basic geometry preview. **parse3mf** is the first library purpose-built for 3MF files — the modern standard for 3D printing — with full multi-color support, slicer parity, and a production-safe exporter that doesn't corrupt your files.

If you're building a **3D printing web app**, a **print-on-demand color configurator**, a **quoting tool**, or any workflow that touches `.3mf` files, this library gives you:

- **Parsing that matches your slicer** — Bambu Studio, PrusaSlicer, and Cura all embed multicolor data differently. parse3mf handles all of them.
- **A React viewer out of the box** — `<ThreeMFWorkbench>` gives you a full 3D viewport with color picker, plate selector, and save button in one line.
- **Safe file export** — change colors without breaking print settings, geometry, G-code metadata, or calibration data. Production-ready.
- **Headless mode** — use `parse3MF()` and `export3MF()` in Node.js, web workers, or any non-React environment.

No other npm package does all of this for 3MF files.

---

## FAQ

### Does parse3mf support STL files?

No — parse3mf is specifically built for the **3MF file format**. STL files don't support multicolor data, materials, or plates. If your workflow uses `.3mf` files (which is the default for modern slicers like Bambu Studio and PrusaSlicer), this is the right tool.

### Can I use parse3mf without React?

Yes. Import from `parse3mf/core` to get `parse3MF()` and `export3MF()` — pure async functions with no React dependency. Works in Node.js, Deno, web workers, or any JavaScript runtime.

### Does the exporter change anything other than colors?

No. The exporter uses **surgical string replacement** — it only modifies the exact hex color values in known config and XML fields. All geometry, print settings, G-code metadata, plate definitions, and calibration data are preserved byte-for-byte.

### Which slicers are supported?

**Bambu Studio**, **PrusaSlicer**, **Cura**, and any slicer that follows the **3MF Core Specification**. The parser reads slicer-specific metadata (filament configs, paint data, plate assignments) in addition to standard 3MF resources.

### Can I customize the UI?

Yes. Every component accepts a `theme` prop for full control over colors, fonts, and borders. You can also use individual components (`<Viewer>`, `<ColorPicker>`, `<PlateSelector>`, `<SaveButton>`) separately for complete layout control.

### Is parse3mf free to use?

Yes — MIT licensed, free for personal and commercial use.

---

## License

MIT — [OG-Baklava](https://github.com/OG-Baklava)
