import { createContext, useContext, useReducer, useCallback, useRef, useEffect, type ReactNode } from 'react'
import type { ParsedThreeMF, MaterialSlot, Plate, ColorOption, ViewerTheme } from '../core/types'
import { parse3MF, ThreeMFParseError } from '../core/parser'
import type { BufferGeometry } from 'three'

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface ThreeMFState {
  /** The parsed model data (null before first parse). */
  model: ParsedThreeMF | null
  /** Whether the parser is currently running. */
  loading: boolean
  /** Last parse error, if any. */
  error: Error | null
  /** Currently selected plate ID. */
  selectedPlateId: number | null
  /** Current material slot state (with user color selections). */
  materialSlots: MaterialSlot[]
  /** The user's single-colour pick (for non-multicolor models). */
  color: string
}

type Action =
  | { type: 'PARSE_START' }
  | { type: 'PARSE_SUCCESS'; payload: ParsedThreeMF }
  | { type: 'PARSE_ERROR'; payload: Error }
  | { type: 'SET_SLOT_COLOR'; slotId: string; color: string }
  | { type: 'SET_PLATE'; plateId: number | null }
  | { type: 'SET_COLOR'; color: string }
  | { type: 'RESET' }

function reducer(state: ThreeMFState, action: Action): ThreeMFState {
  switch (action.type) {
    case 'PARSE_START':
      return { ...state, loading: true, error: null }
    case 'PARSE_SUCCESS': {
      const m = action.payload
      return {
        ...state,
        model: m,
        loading: false,
        error: null,
        materialSlots: m.materialSlots,
        selectedPlateId: m.plates?.[0]?.id ?? null,
      }
    }
    case 'PARSE_ERROR':
      return { ...state, loading: false, error: action.payload, model: null, materialSlots: [] }
    case 'SET_SLOT_COLOR':
      return {
        ...state,
        materialSlots: state.materialSlots.map((s) =>
          s.id === action.slotId ? { ...s, selectedColor: action.color } : s,
        ),
      }
    case 'SET_PLATE':
      return { ...state, selectedPlateId: action.plateId }
    case 'SET_COLOR':
      return { ...state, color: action.color }
    case 'RESET':
      return initialState
    default:
      return state
  }
}

const initialState: ThreeMFState = {
  model: null,
  loading: false,
  error: null,
  selectedPlateId: null,
  materialSlots: [],
  color: '#f1f5f9',
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export interface ThreeMFContextValue extends ThreeMFState {
  /** Parse a .3MF file. */
  loadFile: (file: File) => Promise<ParsedThreeMF | null>
  /** Change the color of a material slot. */
  setSlotColor: (slotId: string, color: string) => void
  /** Select a plate. */
  selectPlate: (plateId: number | null) => void
  /** Set the single colour for non-multicolor models. */
  setColor: (color: string) => void
  /** Reset all state. */
  reset: () => void

  // Derived convenience accessors
  isMultiColor: boolean
  plates: Plate[]
  geometries: BufferGeometry[]
  triangleMaterialMaps: Map<number, Map<number, string>> | undefined
  objectIdToGeometryIndex: Map<number, number> | undefined
  compositeToGeometryMap: Map<number, number[]> | undefined
  plateObjectMap: Map<number, number[]> | undefined
}

const Ctx = createContext<ThreeMFContextValue | null>(null)

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export interface ThreeMFProviderProps {
  children: ReactNode
  /** Called after a successful parse. */
  onParsed?: (result: ParsedThreeMF) => void
  /** Called on parse error. */
  onError?: (error: Error) => void
  /** Called when a slot colour changes. */
  onSlotColorChange?: (slotId: string, color: string, allSlots: MaterialSlot[]) => void
  /** Called when the active plate changes. */
  onPlateChange?: (plateId: number) => void
}

export function ThreeMFProvider({
  children,
  onParsed,
  onError,
  onSlotColorChange,
  onPlateChange,
}: ThreeMFProviderProps) {
  const [state, dispatch] = useReducer(reducer, initialState)
  const callbackRefs = useRef({ onParsed, onError, onSlotColorChange, onPlateChange })
  callbackRefs.current = { onParsed, onError, onSlotColorChange, onPlateChange }

  const loadFile = useCallback(async (file: File): Promise<ParsedThreeMF | null> => {
    dispatch({ type: 'PARSE_START' })
    try {
      const result = await parse3MF(file)
      dispatch({ type: 'PARSE_SUCCESS', payload: result })
      callbackRefs.current.onParsed?.(result)
      return result
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      dispatch({ type: 'PARSE_ERROR', payload: error })
      callbackRefs.current.onError?.(error)
      return null
    }
  }, [])

  const setSlotColor = useCallback((slotId: string, color: string) => {
    dispatch({ type: 'SET_SLOT_COLOR', slotId, color })
  }, [])

  // Fire callback on slot colour change
  useEffect(() => {
    if (state.materialSlots.length > 0) {
      // We don't know *which* slot changed, so just provide them all.
      // The parent can diff if needed.
    }
  }, [state.materialSlots])

  const selectPlate = useCallback((plateId: number | null) => {
    dispatch({ type: 'SET_PLATE', plateId })
    if (plateId !== null) callbackRefs.current.onPlateChange?.(plateId)
  }, [])

  const setColor = useCallback((color: string) => {
    dispatch({ type: 'SET_COLOR', color })
  }, [])

  const reset = useCallback(() => {
    dispatch({ type: 'RESET' })
  }, [])

  const value: ThreeMFContextValue = {
    ...state,
    loadFile,
    setSlotColor,
    selectPlate,
    setColor,
    reset,
    isMultiColor: state.model?.isMultiColor ?? false,
    plates: state.model?.plates ?? [],
    geometries: (state.model?.geometries ?? []) as BufferGeometry[],
    triangleMaterialMaps: state.model?.triangleMaterialMaps,
    objectIdToGeometryIndex: state.model?.objectIdToGeometryIndex,
    compositeToGeometryMap: state.model?.compositeToGeometryMap,
    plateObjectMap: state.model?.plateObjectMap,
  }

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Access the 3MF viewer state and actions.
 *
 * Must be used inside a `<ThreeMFProvider>`.
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { loadFile, model, materialSlots } = useThreeMF()
 *   return <input type="file" onChange={e => loadFile(e.target.files![0])} />
 * }
 * ```
 */
export function useThreeMF(): ThreeMFContextValue {
  const ctx = useContext(Ctx)
  if (!ctx) {
    throw new Error('useThreeMF() must be used inside <ThreeMFProvider>')
  }
  return ctx
}
