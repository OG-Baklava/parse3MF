# 3MF Exporter — Color-Only Modification

> **Version:** 1.0 — Last updated: Feb 2026
>
> This document describes how the exporter re-packages a `.3MF` file with
> **only** color values changed. It is designed for production 3D printing
> workflows where file integrity is critical — geometry, print settings,
> slicer metadata, and all other data must remain byte-for-byte identical.

---

## Table of Contents

1. [Design Principle](#1-design-principle)
2. [Architecture Overview](#2-architecture-overview)
3. [API Reference](#3-api-reference)
4. [How It Works](#4-how-it-works)
   - [Step 1: Build Color Remap](#step-1-build-color-remap)
   - [Step 2: Cross-Reference Colors](#step-2-cross-reference-colors)
   - [Step 3: Patch Model XML](#step-3-patch-model-xml)
   - [Step 4: Patch Config Files](#step-4-patch-config-files)
   - [Step 5: Re-Package ZIP](#step-5-re-package-zip)
5. [Color Cross-Referencing](#5-color-cross-referencing)
6. [File Patching Details](#6-file-patching-details)
   - [Model XML (`3D/*.model`)](#model-xml-3dmodel)
   - [Project Settings (`project_settings.config`)](#project-settings-project_settingsconfig)
   - [Slice Info (`slice_info.config`)](#slice-info-slice_infoconfig)
   - [PrusaSlicer Configs](#prusaslicer-configs)
7. [Safety Guarantees](#7-safety-guarantees)
8. [React Integration](#8-react-integration)
9. [Critical Invariants](#9-critical-invariants)
10. [Common Issues & Solutions](#10-common-issues--solutions)

---

## 1. Design Principle

**Surgical, field-specific string replacements only.**

- No DOM parsing / re-serialization
- No JSON parse / stringify
- Only the exact color hex values inside known color fields are touched
- Every other byte of the original file is preserved exactly as-is
- Alpha suffixes on hex values are preserved (e.g. `#FF0000FF` → `#3B82F6FF`)
- If no colors changed, the original file is returned byte-for-byte

This is intentional. 3MF files for production 3D printing contain slicer
settings, G-code metadata, calibration data, and other critical information
that must not be altered.

---

## 2. Architecture Overview

```
┌──────────────┐     ┌──────────────────┐     ┌────────────────┐
│  Original     │     │  Material Slots   │     │  Color Options  │
│  .3MF File    │     │  (with user's     │     │  (optional      │
│  (ZIP)        │     │   color picks)    │     │   name→hex map) │
└──────┬───────┘     └────────┬─────────┘     └───────┬────────┘
       │                      │                        │
       ▼                      ▼                        ▼
┌──────────────────────────────────────────────────────────────┐
│                       export3MF()                            │
│                                                              │
│  1. Build color remap (slot.id → new hex)                    │
│  2. Extract config filament colors (for cross-referencing)   │
│  3. Cross-reference XML basematerials with config colors     │
│  4. Patch model XML (displaycolor, color attributes)         │
│  5. Patch project_settings.config (filament_colour array)    │
│  6. Patch slice_info.config (filament color attributes)      │
│  7. Patch PrusaSlicer configs (extruder_colour lines)        │
│  8. Re-package ZIP                                           │
│                                                              │
│  Only files with actual color changes are written back.      │
│  All other files remain untouched in the ZIP.                │
└──────────────────────────┬───────────────────────────────────┘
                           │
                           ▼
                    ┌──────────────┐
                    │  Modified     │
                    │  .3MF Blob    │
                    │  (only colors │
                    │   changed)    │
                    └──────────────┘
```

---

## 3. API Reference

### `export3MF(options): Promise<Blob>`

Export a modified `.3MF` file with updated color values.

```ts
import { export3MF } from 'parse3mf/core'

const blob = await export3MF({
  originalFile: myFile,        // File | Blob | ArrayBuffer
  materialSlots: updatedSlots, // MaterialSlot[] with user's color picks
  colorOptions: myColors,      // Optional: ColorOption[] for named→hex resolution
})
```

#### Options

| Property | Type | Required | Description |
|---|---|:---:|---|
| `originalFile` | `File \| Blob \| ArrayBuffer` | ✅ | The original .3MF file to modify |
| `materialSlots` | `MaterialSlot[]` | ✅ | Current slots with user's `selectedColor` values |
| `colorOptions` | `ColorOption[]` | — | Custom named color map (defaults to built-in) |
| `filename` | `string` | — | Output filename (used by `download3MF`) |

#### Returns

A `Blob` containing the modified .3MF file. If no colors were changed,
returns a Blob wrapping the original bytes (no re-packaging).

---

### `download3MF(options): Promise<void>`

Convenience wrapper that calls `export3MF` and triggers a browser download.

```ts
import { download3MF } from 'parse3mf/core'

await download3MF({
  originalFile: myFile,
  materialSlots: updatedSlots,
  filename: 'my-model-recolored', // → "my-model-recolored.3mf"
})
```

If `filename` is not provided, defaults to `{originalName}_modified.3mf`.

---

### `<SaveButton>` (React component)

Drop-in button that triggers the export via the `ThreeMFProvider` context.

```tsx
import { SaveButton } from 'parse3mf'

<SaveButton
  theme={{ accent: '#3b82f6' }}
  colorOptions={myColors}
  filename="recolored-model"
/>
```

| Prop | Type | Description |
|---|---|---|
| `theme` | `ViewerTheme` | Theme overrides |
| `colorOptions` | `ColorOption[]` | Named color map for export |
| `filename` | `string` | Download filename (without `.3mf`) |
| `className` | `string` | CSS class |
| `style` | `CSSProperties` | Inline styles |

Automatically disables when no colors have been changed. Shows
"No Color Changes" / "Save Modified .3MF" / "Saving..." states.

---

## 4. How It Works

### Step 1: Build Color Remap

For each material slot where `selectedColor` differs from the original `id`:

```
slot.id = "#FF0000"  (original, from parser)
slot.selectedColor = "Blue"  (user's pick)

→ resolveToHex("Blue") = "#3B82F6"
→ remap: "#FF0000" → "#3B82F6"
```

Named colors are resolved via the `colorOptions` array (if provided) or the
built-in default map:

| Name | Hex |
|---|---|
| White | `#F1F5F9` |
| Black | `#1E293B` |
| Red | `#EF4444` |
| Blue | `#3B82F6` |
| Green | `#22C55E` |
| Yellow | `#EAB308` |
| Orange | `#F97316` |
| Grey | `#64748B` |
| Clear | `#E0F2FE` |

If the remap is empty (no changes), the original file is returned immediately
without any re-packaging.

### Step 2: Cross-Reference Colors

**This is the critical step that prevents color mismatches.**

The parser may derive slot IDs from the **config file** (`filament_colour`),
but the model XML's `<basematerials>` may have **different hex values** for
the same filaments. For example:

```
Config:         filament_colour: ["#FF0000FF", "#00FF00FF"]
Basematerials:  displaycolor="#C8342AFF", displaycolor="#00FF00FF"
```

Filament 1 has `#FF0000` in config but `#C8342A` in XML. The remap (from
slot IDs) only has `#FF0000 → newColor`. Without cross-referencing, the
XML basematerial would NOT be updated.

The exporter fixes this by:

1. **Extracting filament colors from the config file** in filament order
2. **Extracting displaycolors from the model XML** in basematerial order
3. **Mapping by position** — basematerial[0] corresponds to filament 1
4. **Expanding the remap** — if config color is in the remap, the
   corresponding XML color is also added with the same replacement

This ensures ALL color representations in the file are updated, regardless
of whether they match the slot IDs.

### Step 3: Patch Model XML

For each `.model` file in `3D/`:
- Finds `<base>` elements → replaces `displaycolor` attribute values
- Finds `<color>` elements (in colorgroups) → replaces `color` attribute values
- Uses tag-scoped regex: only replaces values within the specific attribute
  of the specific element type

### Step 4: Patch Config Files

- **`project_settings.config`**: Patches `filament_colour` / `filament_color`
  array values (JSON) or line values (INI)
- **`slice_info.config`**: Patches `color` attributes on `<filament>` elements
- **PrusaSlicer configs**: Patches `extruder_colour` / `filament_colour` lines

### Step 5: Re-Package ZIP

JSZip re-packages the ZIP. Only files that were explicitly modified are
written back. Files that weren't touched retain their original compressed
bytes. The MIME type is set to the 3MF standard:
`application/vnd.ms-package.3dmanufacturing-3dmodel+xml`

---

## 5. Color Cross-Referencing

The cross-referencing system handles the mismatch between different color
sources in a 3MF file:

```
                    Config                         Model XML
                    ──────                         ─────────
Filament 1:    #FF0000FF  ←── same slot ──→   #C8342AFF (basematerials[0])
Filament 2:    #00FF00FF  ←── same slot ──→   #00FF00FF (basematerials[1])
Filament 3:    #0000FFFF  ←── same slot ──→   #1A1AEFFF (basematerials[2])

Primary remap (from slot IDs = config colors):
  #FF0000 → #EF4444   (user changed filament 1)
  #0000FF → #22C55E   (user changed filament 3)

Expanded remap (after cross-referencing):
  #FF0000 → #EF4444   ← config color
  #C8342A → #EF4444   ← XML basematerial color (same filament, different hex)
  #0000FF → #22C55E   ← config color
  #1A1AEF → #22C55E   ← XML basematerial color
```

The expanded remap is used for ALL patching (XML, config, slice_info),
ensuring consistent updates across every color source in the file.

---

## 6. File Patching Details

### Model XML (`3D/*.model`)

**Targets:**
- `<base ... displaycolor="VALUE" ...>` inside `<basematerials>`
- `<color ... color="VALUE" ...>` inside `<colorgroup>`

**Method:** Two-pass regex:
1. Match the entire `<base ...>` or `<color ...>` tag
2. Within the tag, match the specific attribute and replace only its value

**Alpha preservation:** If the original value has an alpha suffix
(e.g. `#FF0000FF`), the new value preserves it (e.g. `#3B82F6FF`).

**Word boundary safety:** The regex uses `\b` before tag and attribute names
to prevent matching `<basematerials>` when looking for `<base>`, or
`displaycolor` when looking for `color`.

### Project Settings (`project_settings.config`)

**JSON format:**
```json
"filament_colour": ["#FF0000FF", "#00FF00FF", "#0000FFFF"]
```

Regex finds the `filament_colour` array and replaces hex values within it.
Only the array content between `[` and `]` is searched. The rest of the
JSON (thousands of print settings) is untouched.

**INI format:**
```ini
filament_colour = #FF0000FF;#00FF00FF;#0000FFFF
```

Only the `filament_colour` line is matched and hex values replaced within it.

### Slice Info (`slice_info.config`)

```xml
<filament id="1" color="#FF0000FF" type="PLA" .../>
```

Same tag-scoped regex approach as model XML, targeting `color` attributes
on `<filament>` elements only.

### PrusaSlicer Configs

```ini
extruder_colour = #FF0000;#00FF00
filament_colour = #FF0000;#00FF00
```

Matches lines starting with `extruder_colour` or `filament_colour` and
replaces hex values on those lines only.

---

## 7. Safety Guarantees

| Guarantee | How |
|---|---|
| Geometry unchanged | Only color attribute values are modified, never vertex/triangle data |
| Print settings unchanged | JSON/INI configs: only `filament_colour` field is touched |
| Slicer metadata unchanged | Other config fields, G-code data, thumbnails are never read or written |
| No re-serialization | No DOM `XMLSerializer`, no `JSON.stringify` — raw string replacement |
| Alpha preserved | `#FF0000FF` → `#3B82F6FF` (alpha suffix kept from original) |
| Case preserved | Replacement hex is uppercase; alpha suffix preserves original case |
| No-change passthrough | If no colors were modified, original bytes are returned directly |
| Untouched files preserved | Files not needing color changes are never written back to the ZIP |

---

## 8. React Integration

The exporter integrates with the React layer through `ThreeMFProvider`:

```tsx
<ThreeMFProvider onExported={(blob) => console.log('Exported!', blob.size)}>
  {/* ... */}
  <SaveButton />
</ThreeMFProvider>
```

### Context methods

| Method | Description |
|---|---|
| `exportFile(colorOptions?)` | Returns a `Blob` of the modified 3MF |
| `downloadFile(filename?, colorOptions?)` | Triggers a browser download |
| `hasColorChanges` | `boolean` — whether any slot colors differ from original |
| `exporting` | `boolean` — whether an export is currently in progress |

### Using the Workbench

The `<ThreeMFWorkbench>` component includes a save button by default when
`showSaveButton` is enabled:

```tsx
<ThreeMFWorkbench
  file={file}
  showSaveButton
  onExported={(blob) => {
    // Upload blob to server, show confirmation, etc.
  }}
/>
```

### Headless usage (no React)

```ts
import { parse3MF, export3MF } from 'parse3mf/core'

// Parse
const result = await parse3MF(file)

// Modify colors
const updatedSlots = result.materialSlots.map((slot, i) =>
  i === 0 ? { ...slot, selectedColor: '#EF4444' } : slot
)

// Export
const blob = await export3MF({
  originalFile: file,
  materialSlots: updatedSlots,
})
```

---

## 9. Critical Invariants

1. **Never use DOM parsing for XML modification.**
   `DOMParser` + `XMLSerializer` subtly changes whitespace, attribute order,
   namespace declarations, and self-closing tag style. This breaks slicer
   compatibility. Always use regex-based surgical replacement.

2. **Never use `JSON.parse` / `JSON.stringify` for config modification.**
   `JSON.stringify` reorders keys, changes whitespace, and normalizes
   escape sequences. Always use regex-based replacement within the
   specific field.

3. **Cross-reference config and XML colors.**
   Slot IDs may come from the config (`filament_colour`) while basematerials
   in the model XML may have different hex values. The positional
   cross-referencing in `buildModelRemap()` is essential. Without it,
   the model XML won't be updated and the slicer will show stale colors.

4. **Preserve alpha suffixes.**
   Many slicers store colors as `#RRGGBBAA` (8-digit hex). The exporter
   must preserve the alpha suffix from the original value. Dropping it
   would change the color interpretation.

5. **Only write files that actually changed.**
   After patching, compare with the original string. Only call
   `zipContent.file(path, patched)` when `patched !== original`.
   This minimizes ZIP re-compression and preserves original file metadata.

6. **The remap must use normalized hex keys (#RRGGBB, uppercase).**
   `normalizeColor()` strips alpha and uppercases. Both the parser and
   exporter use the same function. If normalization differs between
   parser and exporter, hex matching will fail silently.

---

## 10. Common Issues & Solutions

| Issue | Cause | Solution |
|---|---|---|
| Colour 1 turns black in slicer | Config hex ≠ XML basematerials hex; only config was updated | Cross-referencing (already implemented) maps both representations |
| Export creates corrupt ZIP | Unlikely with JSZip, but possible with very large files | Check `generateAsync` returns valid blob; verify in hex editor |
| Named color resolves to wrong hex | Custom `colorOptions` not passed to export | Pass the same `colorOptions` used in the `ColorPicker` |
| Alpha channel stripped | `resolveToHex` strips alpha from slot IDs | `preserveAlpha()` re-adds the original alpha from the file |
| No changes detected | `hasColorChanges` compares `selectedColor` to original | Named colors ("Blue") are compared as strings, not hex |
| PrusaSlicer colors not updated | Config file doesn't match expected path pattern | Exporter matches any file containing `Slic3r` in path |
| File much larger after export | JSZip re-compresses with different settings | Files not modified retain original compression; modified files use JSZip defaults |
