import React, { useId, useRef, useState } from 'react';
import {
  AlertCircle,
  ChevronDown,
  ChevronUp,
  FileSpreadsheet,
  Replace,
  Trash2,
  Upload,
} from 'lucide-react';
import type { ColumnMapping, LoadedExcelWorkbook } from '../types/bom';
import { FILE_INPUT_ACCEPT } from '../utils/excelReader';

interface FileDropZoneProps {
  label: string;
  roleDescription: string;
  workbook: LoadedExcelWorkbook | null;
  mapping: ColumnMapping;
  error: string | null;
  isLoading: boolean;
  onFileSelected: (file: File) => void;
  onSheetChange: (sheetName: string) => void;
  onMappingChange: (nextMapping: ColumnMapping) => void;
  onClear: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

const MAPPING_FIELDS: Array<{ key: keyof ColumnMapping; label: string; required?: boolean }> = [
  { key: 'level', label: 'Level', required: true },
  { key: 'itemCode', label: 'No. (Item Code)', required: true },
  { key: 'description', label: 'Description' },
  { key: 'itemType', label: 'Item Type' },
  { key: 'uom', label: 'UOM' },
  { key: 'bomQty', label: 'BOM Qty.' },
  { key: 'totalBomQty', label: 'Total BOM Qty' },
];

export const FileDropZone: React.FC<FileDropZoneProps> = ({
  label,
  roleDescription,
  workbook,
  mapping,
  error,
  isLoading,
  onFileSelected,
  onSheetChange,
  onMappingChange,
  onClear,
}) => {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [showMapping, setShowMapping] = useState(false);

  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    onFileSelected(files[0]);
    if (inputRef.current) {
      inputRef.current.value = '';
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isDragging) setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    handleFiles(e.dataTransfer.files);
  };

  const activeSheet = workbook ? workbook.sheets[workbook.selectedSheet] : null;
  const headers = activeSheet?.headers ?? [];

  return (
    <div className="bg-white border border-slate-200 rounded-lg flex flex-col">
      <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-900 truncate">{label}</h2>
          <p className="text-xs text-slate-500 truncate">{roleDescription}</p>
        </div>
        {workbook && (
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Replace className="w-3.5 h-3.5 text-slate-500" />
              Replace
            </button>
            <button
              type="button"
              onClick={onClear}
              aria-label={`Remove ${label}`}
              className="inline-flex items-center justify-center p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      <input
        id={inputId}
        ref={inputRef}
        type="file"
        accept={FILE_INPUT_ACCEPT}
        className="sr-only"
        onChange={(e) => handleFiles(e.target.files)}
      />

      {!workbook ? (
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              inputRef.current?.click();
            }
          }}
          className={`m-4 px-5 py-8 border border-dashed rounded-md flex flex-col items-center justify-center text-center transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-blue-600 ${
            isDragging
              ? 'border-blue-600 bg-blue-50/50'
              : 'border-slate-300 bg-slate-50/60 hover:border-slate-400 hover:bg-slate-50'
          }`}
        >
          <div className="w-9 h-9 rounded-md bg-white border border-slate-200 flex items-center justify-center mb-3 text-slate-700">
            <Upload className="w-4 h-4" />
          </div>
          <p className="text-sm font-medium text-slate-900">
            {isLoading ? 'Reading Excel workbook…' : 'Drop Excel BOM file here or click to browse'}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Accepts <span className="font-mono text-slate-700">.xls</span> and{' '}
            <span className="font-mono text-slate-700">.xlsx</span> · Processed locally in browser
          </p>
        </div>
      ) : (
        <div className="p-5 space-y-3.5">
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-9 h-9 rounded-md bg-slate-100 border border-slate-200 flex items-center justify-center text-blue-700 shrink-0 mt-0.5">
              <FileSpreadsheet className="w-4 h-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-900 truncate" title={workbook.fileName}>
                {workbook.fileName}
              </p>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
                <span className="font-medium text-slate-700">{workbook.formatLabel}</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">{formatBytes(workbook.fileSize)}</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">
                  {activeSheet?.rawRowCount ?? 0} components
                </span>
              </div>
              {workbook.formatNotes.length > 0 && (
                <p className="mt-1 text-[11px] text-slate-500">
                  {workbook.formatNotes.join(' · ')}
                </p>
              )}
            </div>
          </div>

          <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <label
                htmlFor={`${inputId}-sheet`}
                className="text-xs font-medium text-slate-600 whitespace-nowrap"
              >
                Worksheet
              </label>
              <select
                id={`${inputId}-sheet`}
                value={workbook.selectedSheet}
                onChange={(e) => onSheetChange(e.target.value)}
                className="h-8 px-2.5 text-xs font-medium text-slate-900 bg-white border border-slate-200 rounded-md focus-visible:outline-2 focus-visible:outline-blue-600 max-w-[200px] truncate"
              >
                {workbook.sheetNames.map((name) => (
                  <option key={name} value={name}>
                    {name} ({workbook.sheets[name]?.rawRowCount ?? 0})
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={() => setShowMapping((prev) => !prev)}
              className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              7-Column Mapping
              {showMapping ? (
                <ChevronUp className="w-3.5 h-3.5" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5" />
              )}
            </button>
          </div>

          {showMapping && (
            <div className="pt-3 border-t border-slate-100 grid grid-cols-2 sm:grid-cols-4 gap-3">
              {MAPPING_FIELDS.map((field) => (
                <div key={field.key} className="flex flex-col gap-1">
                  <label
                    htmlFor={`${inputId}-map-${field.key}`}
                    className="text-[11px] font-medium text-slate-600"
                  >
                    {field.label}
                    {field.required ? ' *' : ''}
                  </label>
                  <select
                    id={`${inputId}-map-${field.key}`}
                    value={mapping[field.key]}
                    onChange={(e) =>
                      onMappingChange({
                        ...mapping,
                        [field.key]: e.target.value,
                      })
                    }
                    className="h-8 px-2 text-xs text-slate-900 bg-white border border-slate-200 rounded-md focus-visible:outline-2 focus-visible:outline-blue-600 truncate"
                  >
                    <option value="">— Unmapped —</option>
                    {headers.map((header) => (
                      <option key={header} value={header}>
                        {header}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="mx-4 mb-4 px-3.5 py-2.5 bg-red-50 border border-red-200 rounded-md flex items-start gap-2.5 text-xs text-red-800"
        >
          <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
};
