# parse3MF

Drop-in **3MF file parser** and **multicolor 3D model viewer** for React.

Slicer-accurate colour detection for **Bambu Studio**, **PrusaSlicer**, **Cura**, and any slicer following the 3MF Core Specification. Built for print-on-demand services that need clients to preview, configure colours, and select plates before sending to print.

---

## Features

- 🎨 **Multicolor rendering** — per-triangle material groups, paint-color decoding, multi-material meshes
- 🖨️ **Slicer parity** — reads `paint_color`, `mmu_segmentation`, filament configs, extruder assignments, plates
- 🧩 **Plug & play** — one `<ThreeMFWorkbench>` component and you're done
- 🔧 **Composable** — use `<Viewer>`, `<ColorPicker>`, `<PlateSelector>` individually with full control
- 📦 **Headless mode** — `parse3MF()` works without React (Node.js / web workers)
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
        onParsed={(result) => {
          console.log('Volume:', result.volume, 'cm³')
          console.log('Multi-color:', result.isMultiColor)
          console.log('Material slots:', result.materialSlots)
        }}
        onSlotColorChange={(slotId, color, allSlots) => {
          console.log(`Slot ${slotId} → ${color}`)
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

---

## API Reference

### Components

| Component | Description |
|---|---|
| `<ThreeMFWorkbench>` | All-in-one: viewport + sidebar (wraps its own Provider) |
| `<ThreeMFProvider>` | Context provider — wrap your app to share state |
| `<Viewer>` | 3D viewport — renders the parsed model with Three.js |
| `<ColorPicker>` | Colour selection dropdown per material slot |
| `<PlateSelector>` | Plate dropdown (only visible for multi-plate files) |

### Hook

```ts
const {
  // State
  model,              // ParsedThreeMF | null
  loading,            // boolean
  error,              // Error | null
  materialSlots,      // MaterialSlot[]
  selectedPlateId,    // number | null
  isMultiColor,       // boolean

  // Actions
  loadFile,           // (file: File) => Promise<ParsedThreeMF | null>
  setSlotColor,       // (slotId: string, color: string) => void
  selectPlate,        // (plateId: number | null) => void
  setColor,           // (color: string) => void
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

### Core function

```ts
async function parse3MF(file: File): Promise<ParsedThreeMF>
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
```

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

1. **ZIP extraction** — JSZip opens the .3MF (which is a ZIP archive)
2. **XML parsing** — DOMParser reads `3D/3dmodel.model` + external objects
3. **Resource resolution** — `<basematerials>`, `<colorgroup>` → colour lookup table
4. **Composite resolution** — `<components>` link parent objects to geometry children
5. **Slicer metadata** — filament colours, extruder assignments, plate definitions
6. **Paint decoding** — `paint_color` hex attributes → per-triangle extruder states via bit-packed quadtree
7. **Geometry creation** — `BufferGeometry` with sorted index buffer for multi-material groups
8. **Three.js rendering** — 3-effect architecture: scene bootstrap → mesh build → colour update

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

---

## Supported Slicers

| Slicer | Multicolor | Plates | Paint Data |
|---|:---:|:---:|:---:|
| Bambu Studio | ✅ | ✅ | ✅ |
| PrusaSlicer | ✅ | — | ✅ |
| Cura | ✅ | — | — |
| Generic 3MF | ✅ | — | — |

---

## Use Cases

- **Print-on-demand services** — let clients preview their model, pick colours per filament, and select plates before ordering
- **3D print quoting tools** — extract volume, bounding box, and material slot count for automated pricing
- **Model preview widgets** — embed a lightweight 3MF viewer in any React app
- **Slicer pre-processing** — parse and inspect 3MF files before sending to a slicer API

---

## License

MIT — [OG-Baklava](https://github.com/OG-Baklava)
