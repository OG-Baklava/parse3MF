import { useThreeMF } from './context'
import type { ViewerTheme } from '../core/types'
import { resolveTheme } from '../styles/theme'

export interface PlateSelectorProps {
  /** Theme overrides. */
  theme?: ViewerTheme
  /** CSS class for the root element. */
  className?: string
  /** Inline styles for the root element. */
  style?: React.CSSProperties
}

/**
 * Plate selector dropdown.
 *
 * Only renders when the model has multiple plates.
 * Must be used inside a `<ThreeMFProvider>`.
 */
export function PlateSelector({ theme: themeOverrides, className, style }: PlateSelectorProps) {
  const { plates, selectedPlateId, selectPlate } = useThreeMF()
  const theme = resolveTheme(themeOverrides)

  if (!plates || plates.length <= 1) return null

  return (
    <div className={className} style={{ fontFamily: theme.fontFamily, ...style }}>
      <label
        style={{
          display: 'block',
          fontSize: 12,
          fontWeight: 500,
          color: theme.textMuted,
          marginBottom: 8,
        }}
      >
        Plate
      </label>
      <select
        value={selectedPlateId ?? ''}
        onChange={(e) => selectPlate(e.target.value ? parseInt(e.target.value) : null)}
        style={{
          width: '100%',
          padding: '10px 12px',
          borderRadius: 8,
          background: theme.background,
          border: `1px solid ${theme.border}`,
          color: theme.text,
          fontSize: 13,
          outline: 'none',
          cursor: 'pointer',
        }}
      >
        {plates.map((plate) => (
          <option key={plate.id} value={plate.id}>
            {plate.name} ({plate.objectIds.length} object{plate.objectIds.length !== 1 ? 's' : ''})
          </option>
        ))}
      </select>
      {selectedPlateId && (
        <p style={{ fontSize: 11, color: theme.textMuted, marginTop: 8 }}>
          Showing objects from {plates.find((p) => p.id === selectedPlateId)?.name}
        </p>
      )}
    </div>
  )
}
