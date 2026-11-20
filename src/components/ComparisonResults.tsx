import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  FileWarning,
  HelpCircle,
  MinusCircle,
  Pencil,
  PlusCircle,
  Search,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import type { BomVerificationRecord, BomVerificationReport, DiffStatus } from '../types/bom';

export type ActiveResultTab =
  | 'incorrect'
  | 'description_review'
  | 'missing_item_code'
  | 'missing'
  | 'additional'
  | 'matched'
  | 'warnings'
  | 'all';

interface ComparisonResultsProps {
  report: BomVerificationReport;
  activeTab: ActiveResultTab;
  onTabChange: (tab: ActiveResultTab) => void;
}

function renderStatusLabel(status: DiffStatus): React.ReactNode {
  switch (status) {
    case 'matched':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 whitespace-nowrap">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
          Matched
        </span>
      );
    case 'incorrect':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 whitespace-nowrap">
          <Pencil className="w-3.5 h-3.5 shrink-0" />
          Field Error
        </span>
      );
    case 'description_review':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-sky-700 whitespace-nowrap">
          <FileWarning className="w-3.5 h-3.5 shrink-0" />
          Description Review
        </span>
      );
    case 'missing_item_code':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-rose-700 whitespace-nowrap">
          <HelpCircle className="w-3.5 h-3.5 shrink-0" />
          Missing Item Code
        </span>
      );
    case 'missing':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-700 whitespace-nowrap">
          <MinusCircle className="w-3.5 h-3.5 shrink-0" />
          Missing
        </span>
      );
    case 'additional':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-indigo-700 whitespace-nowrap">
          <PlusCircle className="w-3.5 h-3.5 shrink-0" />
          Additional
        </span>
      );
  }
}

export const ComparisonResults: React.FC<ComparisonResultsProps> = ({
  report,
  activeTab,
  onTabChange,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const { summary } = report;

  const activeRecordList: BomVerificationRecord[] = useMemo(() => {
    switch (activeTab) {
      case 'incorrect':
        return report.incorrectRecords;
      case 'description_review':
        return report.descriptionReviewRecords;
      case 'missing_item_code':
        return report.missingItemCodeRecords;
      case 'missing':
        return report.missingRecords;
      case 'additional':
        return report.additionalRecords;
      case 'matched':
        return report.matchedRecords;
      case 'all':
        return report.allRecords;
      case 'warnings':
        return [];
    }
  }, [activeTab, report]);

  const filteredRecords = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return activeRecordList;
    return activeRecordList.filter(
      (rec) =>
        rec.itemCode.toLowerCase().includes(q) ||
        rec.originalDescription.toLowerCase().includes(q) ||
        rec.bcDescription.toLowerCase().includes(q) ||
        rec.parentPath.toLowerCase().includes(q) ||
        rec.errorCategory.toLowerCase().includes(q) ||
        rec.detailedExplanation.toLowerCase().includes(q)
    );
  }, [activeRecordList, searchQuery]);

  const filteredIssues = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return report.issues;
    return report.issues.filter(
      (issue) =>
        issue.itemCode.toLowerCase().includes(q) ||
        issue.description.toLowerCase().includes(q) ||
        issue.parentAssembly.toLowerCase().includes(q) ||
        issue.warningCategory.toLowerCase().includes(q) ||
        issue.message.toLowerCase().includes(q)
    );
  }, [report.issues, searchQuery]);

  const isPass = summary.overallStatus === 'PASS';
  const origReconciled =
    summary.matchedCount +
    summary.matchedWithFieldErrorsTotal +
    summary.missingCount +
    summary.missingItemCodeOriginalCount;
  const bcReconciled =
    summary.matchedCount +
    summary.matchedWithFieldErrorsTotal +
    summary.additionalCount +
    summary.missingItemCodeBcCount;

  return (
    <section className="space-y-5">
      {/* Overall PASS / FAIL Banner */}
      <div
        role="status"
        className={`rounded-lg border px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
          isPass
            ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
            : 'bg-red-50 border-red-200 text-red-950'
        }`}
      >
        <div className="flex items-center gap-3">
          {isPass ? (
            <ShieldCheck className="w-6 h-6 text-emerald-700 shrink-0" />
          ) : (
            <ShieldAlert className="w-6 h-6 text-red-700 shrink-0" />
          )}
          <div>
            <p className="font-display text-base font-bold tracking-tight">
              {isPass
                ? 'PASS – No discrepancies found.'
                : 'FAIL – Discrepancies found.'}
            </p>
            <p className="text-xs opacity-85 mt-0.5 font-mono tabular-nums">
              Verified {summary.verifiedAt} · Orig reconciled: {origReconciled}/{summary.originalCount} · BC reconciled: {bcReconciled}/{summary.bcCount}
            </p>
          </div>
        </div>
      </div>

      {/* Primary Occurrence Reconciliation Strip */}
      <div className="bg-white border border-slate-200 rounded-lg grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
        <div className="px-4 py-3.5">
          <p className="text-xs text-slate-500">Original Count</p>
          <p className="mt-1 text-lg font-semibold font-mono tabular-nums text-slate-900">
            {summary.originalCount}
          </p>
        </div>
        <div className="px-4 py-3.5">
          <p className="text-xs text-slate-500">BC Count</p>
          <p className="mt-1 text-lg font-semibold font-mono tabular-nums text-slate-900">
            {summary.bcCount}
          </p>
        </div>
        <div className="px-4 py-3.5">
          <p className="text-xs text-slate-500">Correctly Matched</p>
          <p className="mt-1 text-lg font-semibold font-mono tabular-nums text-emerald-700">
            {summary.matchedCount}
          </p>
        </div>
        <div className="px-4 py-3.5">
          <p className="text-xs text-slate-500">Field Errors</p>
          <p className="mt-1 text-lg font-semibold font-mono tabular-nums text-amber-700">
            {summary.recordsWithErrorsCount}
          </p>
        </div>
        <div className="px-4 py-3.5">
          <p className="text-xs text-slate-500">Description Review</p>
          <p className="mt-1 text-lg font-semibold font-mono tabular-nums text-sky-700">
            {summary.descriptionReviewCount}
          </p>
        </div>
        <div className="px-4 py-3.5">
          <p className="text-xs text-slate-500">Missing</p>
          <p className="mt-1 text-lg font-semibold font-mono tabular-nums text-red-700">
            {summary.missingCount}
          </p>
        </div>
        <div className="px-4 py-3.5">
          <p className="text-xs text-slate-500">Additional</p>
          <p className="mt-1 text-lg font-semibold font-mono tabular-nums text-indigo-700">
            {summary.additionalCount}
          </p>
        </div>
        <div className="px-4 py-3.5">
          <p className="text-xs text-slate-500">Structural Warnings</p>
          <p className="mt-1 text-lg font-semibold font-mono tabular-nums text-amber-800">
            {summary.supplementaryWarningCount}
          </p>
        </div>
      </div>

      {/* 7-Column Discrepancy Breakdown */}
      <div className="bg-white border border-slate-200 rounded-lg grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
        <div className="px-3.5 py-3">
          <p className="text-[11px] text-slate-500">Incorrect Level</p>
          <p className="mt-0.5 text-base font-semibold font-mono tabular-nums text-slate-900">
            {summary.incorrectLevelCount}
          </p>
        </div>
        <div className="px-3.5 py-3">
          <p className="text-[11px] text-slate-500">Incorrect Parent / Item</p>
          <p className="mt-0.5 text-base font-semibold font-mono tabular-nums text-slate-900">
            {summary.incorrectHierarchyCount}
          </p>
        </div>
        <div className="px-3.5 py-3">
          <p className="text-[11px] text-slate-500">Missing Item Code</p>
          <p className="mt-0.5 text-base font-semibold font-mono tabular-nums text-rose-700">
            {summary.missingItemCodeCount}
          </p>
        </div>
        <div className="px-3.5 py-3">
          <p className="text-[11px] text-slate-500">Description Diffs</p>
          <p className="mt-0.5 text-base font-semibold font-mono tabular-nums text-sky-700">
            {summary.incorrectDescriptionCount}
          </p>
        </div>
        <div className="px-3.5 py-3">
          <p className="text-[11px] text-slate-500">Item Type (Purch/Prod)</p>
          <p className="mt-0.5 text-base font-semibold font-mono tabular-nums text-slate-900">
            {summary.incorrectItemTypeCount}{' '}
            {summary.purchaseVsProdOrderCount > 0 && (
              <span className="text-xs font-normal text-amber-700">
                ({summary.purchaseVsProdOrderCount} P/PO)
              </span>
            )}
          </p>
        </div>
        <div className="px-3.5 py-3">
          <p className="text-[11px] text-slate-500">Incorrect UOM</p>
          <p className="mt-0.5 text-base font-semibold font-mono tabular-nums text-slate-900">
            {summary.incorrectUomCount}
          </p>
        </div>
        <div className="px-3.5 py-3">
          <p className="text-[11px] text-slate-500">Incorrect BOM Qty.</p>
          <p className="mt-0.5 text-base font-semibold font-mono tabular-nums text-amber-700">
            {summary.incorrectBomQtyCount}
          </p>
        </div>
        <div className="px-3.5 py-3">
          <p className="text-[11px] text-slate-500">Incorrect Total Qty</p>
          <p className="mt-0.5 text-base font-semibold font-mono tabular-nums text-amber-700">
            {summary.incorrectTotalBomQtyCount}
          </p>
        </div>
      </div>

      {/* Detailed Verification Tables */}
      <div className="bg-white border border-slate-200 rounded-lg">
        <div className="px-5 py-3.5 border-b border-slate-200 flex flex-col xl:flex-row xl:items-center xl:justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-md w-fit">
            <button
              type="button"
              onClick={() => onTabChange('incorrect')}
              className={`px-2.5 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'incorrect'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Field Errors ({report.incorrectRecords.length})
            </button>
            <button
              type="button"
              onClick={() => onTabChange('description_review')}
              className={`px-2.5 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'description_review'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Description Review ({report.descriptionReviewRecords.length})
            </button>
            <button
              type="button"
              onClick={() => onTabChange('missing_item_code')}
              className={`px-2.5 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'missing_item_code'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Missing Item Code ({report.missingItemCodeRecords.length})
            </button>
            <button
              type="button"
              onClick={() => onTabChange('missing')}
              className={`px-2.5 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'missing'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Missing ({report.missingRecords.length})
            </button>
            <button
              type="button"
              onClick={() => onTabChange('additional')}
              className={`px-2.5 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'additional'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Additional ({report.additionalRecords.length})
            </button>
            <button
              type="button"
              onClick={() => onTabChange('matched')}
              className={`px-2.5 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'matched'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Matched ({report.matchedRecords.length})
            </button>
            <button
              type="button"
              onClick={() => onTabChange('warnings')}
              className={`px-2.5 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'warnings'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Structural Warnings ({report.issues.length})
            </button>
            <button
              type="button"
              onClick={() => onTabChange('all')}
              className={`px-2.5 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'all'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              All ({report.allRecords.length})
            </button>
          </div>

          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search No., parent, description…"
              className="h-8 pl-8 pr-3 w-64 text-xs text-slate-900 placeholder:text-slate-400 bg-white border border-slate-200 rounded-md focus-visible:outline-2 focus-visible:outline-blue-600"
            />
          </div>
        </div>

        {activeTab !== 'warnings' ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/50 text-[11px] font-semibold text-slate-600">
                  <th className="py-2.5 px-4 whitespace-nowrap">Classification / Category</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">Level</th>
                  <th className="py-2.5 px-4 whitespace-nowrap">Parent Assembly &amp; No.</th>
                  <th className="py-2.5 px-4 whitespace-nowrap">Description (Orig / BC)</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">Item Type</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">UOM</th>
                  <th className="py-2.5 px-3 text-right whitespace-nowrap">BOM Qty. (Orig / BC)</th>
                  <th className="py-2.5 px-3 text-right whitespace-nowrap">Total Qty (Orig / BC)</th>
                  <th className="py-2.5 px-4 whitespace-nowrap">Rows &amp; Explanation</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {filteredRecords.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-10 text-center text-slate-500">
                      No records in this view.
                    </td>
                  </tr>
                ) : (
                  filteredRecords.map((rec) => {
                    const rowTint =
                      rec.status === 'missing'
                        ? 'bg-red-50/35 hover:bg-red-50/60'
                        : rec.status === 'additional'
                          ? 'bg-indigo-50/35 hover:bg-indigo-50/60'
                          : rec.status === 'description_review'
                            ? 'bg-sky-50/35 hover:bg-sky-50/60'
                            : rec.status === 'missing_item_code'
                              ? 'bg-rose-50/35 hover:bg-rose-50/60'
                              : rec.status === 'incorrect'
                                ? 'bg-amber-50/35 hover:bg-amber-50/60'
                                : 'hover:bg-slate-50/80';

                    const hasBomQtyDiff = rec.changes.some((c) => c.field === 'BOM Qty.');
                    const hasTotalQtyDiff = rec.changes.some((c) => c.field === 'Total BOM Qty');
                    const hasItemTypeDiff = rec.changes.some((c) => c.field === 'Item Type');
                    const hasDescDiff =
                      rec.status === 'description_review' ||
                      rec.changes.some((c) => c.field === 'Description');

                    return (
                      <tr key={rec.key} className={`${rowTint} transition-colors`}>
                        <td className="py-2.5 px-4 align-top">
                          <div>{renderStatusLabel(rec.status)}</div>
                          <p className="mt-0.5 text-[11px] text-slate-600">
                            {rec.errorCategory}
                          </p>
                        </td>
                        <td className="py-2.5 px-3 align-top font-mono tabular-nums text-slate-700 whitespace-nowrap">
                          {rec.rawLevel || rec.level}
                        </td>
                        <td className="py-2.5 px-4 align-top">
                          <div
                            className="flex items-center gap-1.5"
                            style={{ paddingLeft: `${Math.min(rec.level, 6) * 12}px` }}
                          >
                            {rec.level > 0 && (
                              <span
                                className="text-slate-300 font-mono select-none"
                                aria-hidden="true"
                              >
                                └─
                              </span>
                            )}
                            <span className="font-mono font-semibold text-slate-900 whitespace-nowrap">
                              {rec.itemCode}
                            </span>
                          </div>
                          <p
                            className="mt-0.5 text-[11px] text-slate-500 truncate max-w-xs"
                            style={{ paddingLeft: `${Math.min(rec.level, 6) * 12}px` }}
                            title={rec.parentPath}
                          >
                            Parent: {rec.parentAssemblyCode} ({rec.componentRole})
                          </p>
                        </td>
                        <td className="py-2.5 px-4 align-top text-slate-700 max-w-sm">
                          {hasDescDiff ? (
                            <div className="space-y-1 text-[11px]">
                              <div>
                                <span className="font-semibold text-slate-600">Orig:</span>{' '}
                                <span className="text-slate-900">{rec.originalDescription || '—'}</span>
                              </div>
                              <div>
                                <span className="font-semibold text-sky-700">BC:</span>{' '}
                                <span className="text-slate-900">{rec.bcDescription || '—'}</span>
                              </div>
                            </div>
                          ) : (
                            <span className="line-clamp-2">{rec.description || '—'}</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 align-top whitespace-nowrap">
                          {hasItemTypeDiff ? (
                            <div className="text-[11px]">
                              <span className="line-through text-slate-400">
                                {rec.originalNode?.itemType || '—'}
                              </span>{' '}
                              <span aria-hidden="true">→</span>{' '}
                              <span className="font-semibold text-amber-800">
                                {rec.bcNode?.itemType || '—'}
                              </span>
                            </div>
                          ) : (
                            <span className="text-slate-700">{rec.itemType || '—'}</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 align-top font-mono text-slate-600 whitespace-nowrap">
                          {rec.uom || '—'}
                        </td>
                        <td
                          className={`py-2.5 px-3 align-top text-right font-mono tabular-nums whitespace-nowrap ${
                            hasBomQtyDiff
                              ? 'font-bold text-amber-800 bg-amber-100/60'
                              : 'text-slate-800'
                          }`}
                        >
                          {rec.originalBomQty ?? '—'} / {rec.bcBomQty ?? '—'}
                        </td>
                        <td
                          className={`py-2.5 px-3 align-top text-right font-mono tabular-nums whitespace-nowrap ${
                            hasTotalQtyDiff
                              ? 'font-bold text-amber-800 bg-amber-100/60'
                              : 'text-slate-900 font-medium'
                          }`}
                        >
                          {rec.originalTotalQty ?? '—'} / {rec.bcTotalQty ?? '—'}
                        </td>
                        <td className="py-2.5 px-4 align-top text-slate-700 min-w-[260px]">
                          <p className="text-[11px] font-mono text-slate-500 mb-0.5">
                            Orig Row: {rec.originalNode?.rowNumber ?? '—'} · BC Row:{' '}
                            {rec.bcNode?.rowNumber ?? '—'}
                          </p>
                          {rec.changes.length > 0 ? (
                            <div className="space-y-1">
                              {rec.changes.map((c, idx) => (
                                <div key={`${c.field}-${idx}`} className="text-[11px]">
                                  <span className="font-semibold text-slate-800">{c.field}:</span>{' '}
                                  <span className="line-through text-slate-400">{c.before}</span>{' '}
                                  <span aria-hidden="true">→</span>{' '}
                                  <span className="font-medium text-slate-900">{c.after}</span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <span className="text-[11px] text-slate-600">
                              {rec.detailedExplanation}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto">
            {filteredIssues.length === 0 ? (
              <div className="py-12 px-6 text-center">
                <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto mb-2" />
                <p className="text-sm font-medium text-slate-900">
                  No structural warnings detected
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  No circular references, invalid quantities, hierarchy level jumps, or missing item codes were detected.
                </p>
              </div>
            ) : (
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/50 text-[11px] font-semibold text-slate-600">
                    <th className="py-2.5 px-4 whitespace-nowrap">Warning Category</th>
                    <th className="py-2.5 px-3 whitespace-nowrap">Source Report</th>
                    <th className="py-2.5 px-3 whitespace-nowrap">Row</th>
                    <th className="py-2.5 px-3 whitespace-nowrap">Level</th>
                    <th className="py-2.5 px-4 whitespace-nowrap">Parent Assembly</th>
                    <th className="py-2.5 px-4 whitespace-nowrap">Item Code</th>
                    <th className="py-2.5 px-4 whitespace-nowrap">Description</th>
                    <th className="py-2.5 px-4 whitespace-nowrap">Explanation</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {filteredIssues.map((issue) => (
                    <tr key={issue.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-2.5 px-4 align-top">
                        <span className="inline-flex items-center gap-1.5 font-medium text-amber-800 whitespace-nowrap">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                          {issue.warningCategory}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 align-top text-slate-700 font-medium whitespace-nowrap">
                        {issue.source}
                      </td>
                      <td className="py-2.5 px-3 align-top font-mono tabular-nums text-slate-600">
                        {issue.rowNumber}
                      </td>
                      <td className="py-2.5 px-3 align-top font-mono tabular-nums text-slate-600">
                        {issue.level}
                      </td>
                      <td className="py-2.5 px-4 align-top font-mono text-slate-700">
                        {issue.parentAssembly}
                      </td>
                      <td className="py-2.5 px-4 align-top font-mono font-medium text-slate-900">
                        {issue.itemCode}
                      </td>
                      <td className="py-2.5 px-4 align-top text-slate-700 max-w-xs">
                        {issue.description || '—'}
                      </td>
                      <td className="py-2.5 px-4 align-top text-slate-700">
                        <p>{issue.message}</p>
                        <p className="mt-0.5 text-[11px] text-slate-400 font-mono">
                          Path: {issue.hierarchyPath}
                        </p>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </section>
  );
};
