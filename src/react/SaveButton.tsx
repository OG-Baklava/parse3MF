import { useState } from 'react'
import { useThreeMF } from './context'
import type { ColorOption, ViewerTheme } from '../core/types'
import { resolveTheme } from '../styles/theme'

export interface SaveButtonProps {
  /** Theme overrides. */
  theme?: ViewerTheme
  /** Color options to resolve named colors. */
  colorOptions?: ColorOption[]
  /** Custom filename (without extension). */
  filename?: string
  /** CSS class for the root element. */
  className?: string
  /** Inline styles for the root element. */
  style?: React.CSSProperties
}

/**
 * Save/download button for the modified 3MF file.
 *
 * Shows a download button that exports the current color selections
 * back into the .3MF file.
 *
 * Must be used inside a `<ThreeMFProvider>`.
 */
export function SaveButton({
  theme: themeOverrides,
  colorOptions,
  filename,
  className,
  style,
}: SaveButtonProps) {
  const { model, originalFile, exporting, downloadFile, hasColorChanges } = useThreeMF()
  const theme = resolveTheme(themeOverrides)
  const [saved, setSaved] = useState(false)

  if (!model || !originalFile) return null

  const handleClick = async () => {
    setSaved(false)
    await downloadFile(filename, colorOptions)
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  const buttonStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px 16px',
    borderRadius: 8,
    border: 'none',
    cursor: exporting ? 'wait' : 'pointer',
    fontFamily: theme.fontFamily,
    fontSize: 13,
    fontWeight: 600,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    transition: 'all 0.2s',
    background: saved
      ? '#22c55e'
      : hasColorChanges
        ? theme.accent
        : `${theme.surface}`,
    color: saved || hasColorChanges ? '#ffffff' : theme.text,
    opacity: exporting ? 0.7 : 1,
    ...style,
  }

  return (
    <div className={className}>
      <button
        onClick={handleClick}
        disabled={exporting}
        style={buttonStyle}
        title={hasColorChanges ? 'Download .3MF with your color changes' : 'Download .3MF file'}
      >
        {exporting ? (
          <>
            <Spinner color={hasColorChanges ? '#ffffff' : theme.textMuted} />
            Exporting…
          </>
        ) : saved ? (
          <>
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            Saved!
          </>
        ) : (
          <>
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
            {hasColorChanges ? 'Save Modified .3MF' : 'Download .3MF'}
          </>
        )}
      </button>
      {hasColorChanges && !saved && !exporting && (
        <p
          style={{
            fontSize: 10,
            color: theme.textMuted,
            marginTop: 6,
            textAlign: 'center',
          }}
        >
          Colors changed — save to apply
        </p>
      )}
    </div>
  )
}

// Small inline spinner
function Spinner({ color }: { color: string }) {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      style={{ animation: 'spin 1s linear infinite' }}
    >
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <circle cx={12} cy={12} r={10} stroke={color} strokeWidth={3} opacity={0.25} />
      <path
        d="M12 2a10 10 0 019.95 9"
        stroke={color}
        strokeWidth={3}
        strokeLinecap="round"
      />
    </svg>
  )
}
