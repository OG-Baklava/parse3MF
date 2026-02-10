import type { ViewerTheme, ColorOption } from '../core/types'

export const DEFAULT_THEME: Required<ViewerTheme> = {
  background: '#0f172a',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  accent: '#3b82f6',
  surface: '#1e293b',
  text: '#e2e8f0',
  textMuted: '#94a3b8',
  border: 'rgba(59,130,246,0.3)',
}

export const DEFAULT_COLOR_OPTIONS: ColorOption[] = [
  { name: 'White', hex: '#f1f5f9' },
  { name: 'Black', hex: '#1e293b' },
  { name: 'Red', hex: '#ef4444' },
  { name: 'Blue', hex: '#3b82f6' },
  { name: 'Green', hex: '#22c55e' },
  { name: 'Yellow', hex: '#eab308' },
  { name: 'Orange', hex: '#f97316' },
  { name: 'Grey', hex: '#64748b' },
]

export function resolveTheme(overrides?: ViewerTheme): Required<ViewerTheme> {
  return { ...DEFAULT_THEME, ...overrides }
}

/** Convert a named color or #hex string → Three.js int. */
export function colorToHex(v: string): number {
  if (v.startsWith('#')) return parseInt(v.slice(1), 16)
  const opt = DEFAULT_COLOR_OPTIONS.find((o) => o.name === v)
  return opt ? parseInt(opt.hex.slice(1), 16) : 0x3b82f6
}

/** CSS-safe hex for a named or hex colour. */
export function colorToCss(v: string): string {
  if (v.startsWith('#')) return v
  const opt = DEFAULT_COLOR_OPTIONS.find((o) => o.name === v)
  return opt ? opt.hex : '#94a3b8'
}
