import React, { useState } from 'react'
import type { SheetInfo } from '../../../shared/api'

interface SheetSelectorModalProps {
  fileName: string
  sheets: SheetInfo[]
  isOpen: boolean
  onClose: () => void
  onConfirm: (selectedSheets: SheetInfo[]) => void
}

export const SheetSelectorModal: React.FC<SheetSelectorModalProps> = ({
  fileName,
  sheets,
  isOpen,
  onClose,
  onConfirm
}) => {
  const [selectedSheetNames, setSelectedSheetNames] = useState<Set<string>>(() =>
    new Set(sheets.map((s) => s.name))
  )
  const [expandedSheet, setExpandedSheet] = useState<string | null>(
    sheets.length > 0 ? sheets[0].name : null
  )

  if (!isOpen) return null

  const toggleSheet = (name: string) => {
    setSelectedSheetNames((prev) => {
      const next = new Set(prev)
      if (next.has(name)) {
        if (next.size > 1) next.delete(name)
      } else {
        next.add(name)
      }
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selectedSheetNames.size === sheets.length) {
      setSelectedSheetNames(new Set([sheets[0]?.name]))
    } else {
      setSelectedSheetNames(new Set(sheets.map((s) => s.name)))
    }
  }

  const handleConfirm = () => {
    const selected = sheets.filter((s) => selectedSheetNames.has(s.name))
    onConfirm(selected)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
      <div className="bg-slate-900 border border-slate-700/80 rounded-xl shadow-2xl w-full max-w-3xl overflow-hidden flex flex-col max-h-[85vh] animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/90">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 font-bold text-lg">
              📊
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2">
                Excel Workbook Sheet Selector
              </h2>
              <p className="text-xs text-slate-400 font-mono truncate max-w-md">{fileName}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-800 transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-4 flex-1">
          <div className="flex items-center justify-between text-xs text-slate-400 pb-2 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <span className="text-cyan-400 font-semibold">📚</span>
              <span>{sheets.length} Sheets Detected</span>
            </div>
            <button
              onClick={toggleSelectAll}
              className="text-cyan-400 hover:text-cyan-300 font-medium transition-colors"
            >
              {selectedSheetNames.size === sheets.length ? 'Deselect All' : 'Select All'}
            </button>
          </div>

          <div className="space-y-3">
            {sheets.map((sheet) => {
              const isSelected = selectedSheetNames.has(sheet.name)
              const isExpanded = expandedSheet === sheet.name
              return (
                <div
                  key={sheet.name}
                  className={`border rounded-lg transition-all ${
                    isSelected
                      ? 'border-cyan-500/40 bg-cyan-950/20'
                      : 'border-slate-800 bg-slate-950/40 opacity-70'
                  }`}
                >
                  <div className="p-3.5 flex items-center justify-between">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <button
                        onClick={() => toggleSheet(sheet.name)}
                        className={`w-5 h-5 rounded flex items-center justify-center border transition-colors font-bold text-xs ${
                          isSelected
                            ? 'bg-cyan-500 border-cyan-400 text-slate-950'
                            : 'border-slate-700 bg-slate-800 text-slate-400'
                        }`}
                      >
                        {isSelected ? '✓' : ''}
                      </button>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm text-slate-200 truncate">
                            {sheet.name}
                          </span>
                          <span
                            className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                              sheet.detectedTech === '4G'
                                ? 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20'
                                : sheet.detectedTech === '3G'
                                ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20'
                                : sheet.detectedTech === '2G'
                                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                : 'bg-slate-800 text-slate-400 border border-slate-700'
                            }`}
                          >
                            {sheet.detectedTech}
                          </span>
                        </div>
                        <p className="text-xs text-slate-400 mt-0.5">
                          {sheet.rowCount.toLocaleString()} rows • {sheet.headers.length} columns
                        </p>
                      </div>
                    </div>

                    <button
                      onClick={() => setExpandedSheet(isExpanded ? null : sheet.name)}
                      className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200 px-2.5 py-1 rounded-md hover:bg-slate-800 transition-colors"
                    >
                      <span>Preview</span>
                      <span>{isExpanded ? '▲' : '▼'}</span>
                    </button>
                  </div>

                  {/* Sample Preview Table */}
                  {isExpanded && (
                    <div className="border-t border-slate-800/80 p-3 bg-slate-950/60 overflow-x-auto">
                      <p className="text-[11px] font-medium text-slate-400 mb-2 flex items-center gap-1">
                        <span>⚡</span> First 5 Sample Rows
                      </p>
                      <table className="w-full text-left text-xs border-collapse font-mono">
                        <thead>
                          <tr className="border-b border-slate-800 text-slate-400 bg-slate-900/50">
                            {sheet.headers.slice(0, 6).map((h, i) => (
                              <th key={i} className="py-1.5 px-2 font-medium">
                                {h}
                              </th>
                            ))}
                            {sheet.headers.length > 6 && (
                              <th className="py-1.5 px-2 font-medium text-slate-500">
                                +{sheet.headers.length - 6} more
                              </th>
                            )}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/50 text-slate-300">
                          {sheet.sampleRows.map((row, rIdx) => (
                            <tr key={rIdx} className="hover:bg-slate-900/40">
                              {row.slice(0, 6).map((cell, cIdx) => (
                                <td key={cIdx} className="py-1 px-2 truncate max-w-[140px]">
                                  {cell || '-'}
                                </td>
                              ))}
                              {sheet.headers.length > 6 && (
                                <td className="py-1 px-2 text-slate-600">...</td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-800 bg-slate-900/90 flex items-center justify-between">
          <span className="text-xs text-slate-400">
            {selectedSheetNames.size} of {sheets.length} sheets selected for ingestion
          </span>
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={selectedSheetNames.size === 0}
              className="px-5 py-2 text-xs font-semibold text-slate-950 bg-cyan-400 hover:bg-cyan-300 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors shadow-lg shadow-cyan-500/20"
            >
              Import Selected ({selectedSheetNames.size})
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
