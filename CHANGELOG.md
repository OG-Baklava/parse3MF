# Changelog

All notable changes to this project will be documented in this file.

This project follows [Semantic Versioning](https://semver.org/):
- **MAJOR** (x.0.0) — breaking API changes
- **MINOR** (0.x.0) — new features, backward compatible
- **PATCH** (0.0.x) — bug fixes, backward compatible

---

## [1.1.0] — 2026-02-10

### Added

- **3MF color exporter** (`export3MF`, `download3MF`) — re-packages .3MF files with only color values changed, preserving all geometry, print settings, and slicer metadata byte-for-byte
- **`<SaveButton>`** React component — drop-in export/download button with auto-disable when no colors changed
- **Color cross-referencing** — positionally maps config `filament_colour` values to XML basematerials `displaycolor` values, handling hex mismatches between sources
- `showSaveButton` prop on `<ThreeMFWorkbench>`
- `onExported` callback on `<ThreeMFWorkbench>` and `<ThreeMFProvider>`
- `exportFile()`, `downloadFile()`, `hasColorChanges`, `exporting` on `useThreeMF()` hook
- `Export3MFOptions` and `ColorOption` types exported from `parse3mf/core`
- Vite demo app (`demo/`) for local development and testing
- `docs/3MF_PIPELINE_ARCHITECTURE.md` — full parser & renderer architecture reference
- `docs/EXPORTER.md` — exporter design, safety guarantees, and API reference

### Fixed

- Colour 1 reverting to black on export when config `filament_colour` hex values differed from model XML `<basematerials>` hex values for the same filament

## [1.0.0] — 2026-02-10

### Added

- 3MF parser (`parse3MF`) with full multicolor support
- Bambu Studio compatibility: filament configs, extruder assignments, paint_color decoding, plate detection
- PrusaSlicer compatibility: volume triangle ranges, per-volume extruder assignments, mmu_segmentation
- Cura and generic 3MF Core Specification support
- React components: `<ThreeMFWorkbench>`, `<ThreeMFProvider>`, `<Viewer>`, `<ColorPicker>`, `<PlateSelector>`
- `useThreeMF()` hook for composable usage
- Headless `parse3MF()` for Node.js / web workers (via `parse3mf/core`)
- Per-triangle `paint_color` bit-packed quadtree decoding
- Multi-plate support with plate object mapping
- Themeable UI with zero CSS imports
- Volume and bounding box calculation

[1.1.0]: https://github.com/OG-Baklava/parse3MF/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/OG-Baklava/parse3MF/releases/tag/v1.0.0
