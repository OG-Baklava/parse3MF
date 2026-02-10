import { useThreeMF } from './context'
import type { ColorOption, ViewerTheme } from '../core/types'
import { resolveTheme, colorToCss, DEFAULT_COLOR_OPTIONS } from '../styles/theme'

export interface ColorPickerProps {
  /** Available named colours. Falls back to built-in defaults. */
  colorOptions?: ColorOption[]
  /** Theme overrides. */
  theme?: ViewerTheme
  /** CSS class for the root element. */
  className?: string
  /** Inline styles for the root element. */
  style?: React.CSSProperties
}

/**
 * Colour picker for each material slot.
 *
 * Only renders when the model has multiple colours detected.
 * Must be used inside a `<ThreeMFProvider>`.
 */
export function ColorPicker({ colorOptions, theme: themeOverrides, className, style }: ColorPickerProps) {
  const { isMultiColor, materialSlots, setSlotColor } = useThreeMF()
  const theme = resolveTheme(themeOverrides)
  const colors = colorOptions ?? DEFAULT_COLOR_OPTIONS

  if (!isMultiColor || materialSlots.length === 0) return null

  const rootStyle: React.CSSProperties = {
    background: `${theme.surface}33`,
    borderRadius: 8,
    padding: 12,
    border: `1px solid ${theme.border}`,
    fontFamily: theme.fontFamily,
    ...style,
  }

  return (
    <div className={className} style={rootStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={theme.accent} strokeWidth={2}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01"
          />
        </svg>
        <span style={{ fontSize: 12, fontWeight: 500, color: theme.textMuted }}>Multi-color</span>
      </div>

      <p style={{ fontSize: 11, color: theme.textMuted, marginBottom: 12 }}>
        {materialSlots.length} filament{materialSlots.length !== 1 ? 's' : ''} — select colors:
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {materialSlots.map((slot, index) => {
          const isHexColor = slot.selectedColor.startsWith('#')
          const originalColorHex = slot.id.startsWith('#') ? slot.id : null

          return (
            <div
              key={slot.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 8px',
                borderRadius: 6,
                background: `${theme.surface}80`,
                border: `1px solid ${theme.surface}`,
              }}
            >
              {originalColorHex && (
                <div
                  style={{
                    width: 16,
                    height: 16,
                    borderRadius: 3,
                    border: `1px solid ${theme.textMuted}`,
                    backgroundColor: originalColorHex,
                    flexShrink: 0,
                  }}
                  title={`Original: ${originalColorHex}`}
                />
              )}
              <span
                style={{
                  fontSize: 11,
                  color: theme.textMuted,
                  flexShrink: 0,
                  width: 80,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={slot.name || `Slot ${index + 1}`}
              >
                {slot.name || `Filament ${index + 1}`}
              </span>
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <div
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: 4,
                    border: `1px solid ${theme.surface}`,
                    backgroundColor: colorToCss(slot.selectedColor),
                    flexShrink: 0,
                  }}
                  title={slot.selectedColor}
                />
                <select
                  value={slot.selectedColor}
                  onChange={(e) => setSlotColor(slot.id, e.target.value)}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    padding: '6px 8px',
                    fontSize: 11,
                    borderRadius: 4,
                    background: theme.background,
                    border: `1px solid ${theme.surface}`,
                    color: theme.text,
                    outline: 'none',
                    cursor: 'pointer',
                  }}
                >
                  {isHexColor && <option value={slot.selectedColor}>Original ({slot.selectedColor})</option>}
                  {colors.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
