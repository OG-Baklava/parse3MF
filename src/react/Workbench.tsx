import { useEffect, useRef } from 'react'
import { ThreeMFProvider, useThreeMF } from './context'
import { Viewer } from './Viewer'
import { ColorPicker } from './ColorPicker'
import { PlateSelector } from './PlateSelector'
import type { ThreeMFViewerProps } from '../core/types'
import { resolveTheme } from '../styles/theme'

// ---------------------------------------------------------------------------
// Inner component (needs context)
// ---------------------------------------------------------------------------

function WorkbenchInner({
  file,
  colorOptions,
  theme: themeOverrides,
  className,
  style,
}: ThreeMFViewerProps) {
  const { loadFile, model } = useThreeMF()
  const theme = resolveTheme(themeOverrides)
  const prevFileRef = useRef<File | null>(null)

  useEffect(() => {
    if (file && file !== prevFileRef.current) {
      prevFileRef.current = file
      loadFile(file)
    }
  }, [file, loadFile])

  const rootStyle: React.CSSProperties = {
    display: 'flex',
    gap: 16,
    width: '100%',
    height: '100%',
    fontFamily: theme.fontFamily,
    ...style,
  }

  return (
    <div className={className} style={rootStyle}>
      {/* 3D Viewport */}
      <div style={{ flex: 1, minHeight: 300 }}>
        <Viewer theme={themeOverrides} showDebugOverlay />
      </div>

      {/* Sidebar */}
      {model && (
        <div
          style={{
            width: 260,
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            flexShrink: 0,
          }}
        >
          <PlateSelector theme={themeOverrides} />
          <ColorPicker theme={themeOverrides} colorOptions={colorOptions} />
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Public all-in-one component
// ---------------------------------------------------------------------------

/**
 * All-in-one 3MF viewer: viewport + plate selector + colour picker.
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
export function ThreeMFWorkbench(props: ThreeMFViewerProps) {
  return (
    <ThreeMFProvider
      onParsed={props.onParsed}
      onError={props.onError}
      onSlotColorChange={props.onSlotColorChange}
      onPlateChange={props.onPlateChange}
    >
      <WorkbenchInner {...props} />
    </ThreeMFProvider>
  )
}
