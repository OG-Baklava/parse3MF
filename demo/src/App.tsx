import { useState, useCallback } from 'react'
import { ThreeMFWorkbench } from 'parse3mf'
import type { ParsedThreeMF } from 'parse3mf'

export default function App() {
  const [file, setFile] = useState<File | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [parsedInfo, setParsedInfo] = useState<ParsedThreeMF | null>(null)

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const f = e.dataTransfer.files[0]
    if (f) setFile(f)
  }, [])

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) setFile(f)
  }, [])

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <header
        style={{
          padding: '16px 24px',
          borderBottom: '1px solid rgba(59,130,246,0.2)',
          background: 'rgba(15,23,42,0.8)',
          backdropFilter: 'blur(8px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 8,
              background: '#3b82f6',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 18,
            }}
          >
            📦
          </div>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 700, color: '#f1f5f9' }}>parse3mf</h1>
            <p style={{ fontSize: 11, color: '#94a3b8' }}>Demo Playground</p>
          </div>
        </div>

        {parsedInfo && (
          <div style={{ display: 'flex', gap: 16, fontSize: 12, color: '#94a3b8' }}>
            <span>
              Volume: <strong style={{ color: '#3b82f6' }}>{parsedInfo.volume.toFixed(2)} cm³</strong>
            </span>
            <span>
              Colors: <strong style={{ color: '#3b82f6' }}>{parsedInfo.materialSlots.length}</strong>
            </span>
            {parsedInfo.plates && parsedInfo.plates.length > 0 && (
              <span>
                Plates: <strong style={{ color: '#3b82f6' }}>{parsedInfo.plates.length}</strong>
              </span>
            )}
          </div>
        )}
      </header>

      {/* Drop Zone */}
      <div style={{ padding: '16px 24px' }}>
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          style={{
            border: `2px dashed ${isDragging ? '#3b82f6' : 'rgba(59,130,246,0.3)'}`,
            borderRadius: 12,
            padding: file ? '12px 24px' : '48px 24px',
            textAlign: 'center',
            background: isDragging ? 'rgba(59,130,246,0.1)' : 'rgba(15,23,42,0.5)',
            transition: 'all 0.2s',
            cursor: 'pointer',
          }}
        >
          <label style={{ cursor: 'pointer', display: 'block' }}>
            <input
              type="file"
              accept=".3mf"
              onChange={handleFileInput}
              style={{ display: 'none' }}
            />
            {file ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <span style={{ color: '#4ade80', fontWeight: 500 }}>✓ {file.name}</span>
                <span style={{ fontSize: 12, color: '#64748b' }}>
                  ({(file.size / 1024 / 1024).toFixed(2)} MB)
                </span>
                <span style={{ fontSize: 11, color: '#475569' }}>– drop a new file to replace</span>
              </div>
            ) : (
              <>
                <p style={{ fontSize: 16, color: '#cbd5e1', marginBottom: 4 }}>
                  Drop a <strong>.3MF</strong> file here
                </p>
                <p style={{ fontSize: 13, color: '#64748b' }}>or click to browse</p>
              </>
            )}
          </label>
        </div>
      </div>

      {/* Workbench */}
      {file && (
        <div style={{ flex: 1, padding: '0 24px 24px', minHeight: 500 }}>
          <ThreeMFWorkbench
            file={file}
            onParsed={(result) => {
              console.log('Parsed:', result)
              setParsedInfo(result)
            }}
            onError={(err) => console.error('Parse error:', err)}
            onExported={(blob) => console.log('Exported:', blob.size, 'bytes')}
            style={{ height: '100%', minHeight: 500 }}
          />
        </div>
      )}
    </div>
  )
}
