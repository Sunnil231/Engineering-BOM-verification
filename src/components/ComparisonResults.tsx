import React, { useMemo, useState } from 'react';
import {
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Eye,
  MinusCircle,
  Pencil,
  PlusCircle,
  Search,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import type { BomVerificationRecord, BomVerificationReport, DiffStatus } from '../types/bom';
import { buildVerificationObservations } from '../utils/bomObservations';

export type ActiveResultTab =
  | 'incorrect'
  | 'missing'
  | 'additional'
  | 'unresolved'
  | 'matched'
  | 'warnings'
  | 'audit'
  | 'all';

interface ComparisonResultsProps {
  report: BomVerificationReport;
  activeTab: ActiveResultTab;
  onTabChange: (tab: ActiveResultTab) => void;
}

function formatNumericDiff(diff: number | null): string | null {
  if (diff === null || !Number.isFinite(diff) || diff === 0) return null;
  return diff > 0 ? `+${diff}` : String(diff);
}

function renderStatusLabel(status: DiffStatus): React.ReactNode {
  switch (status) {
    case 'matched':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 whitespace-nowrap">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
          CORRECT
        </span>
      );
    case 'incorrect':
    case 'description_review':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-800 whitespace-nowrap">
          <Pencil className="w-3.5 h-3.5 shrink-0" />
          INCORRECT
        </span>
      );
    case 'manual_review':
    case 'missing_item_code':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-violet-700 whitespace-nowrap">
          <Eye className="w-3.5 h-3.5 shrink-0" />
          UNRESOLVED
        </span>
      );
    case 'missing':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-700 whitespace-nowrap">
          <MinusCircle className="w-3.5 h-3.5 shrink-0" />
          MISSING
        </span>
      );
    case 'additional':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-700 whitespace-nowrap">
          <PlusCircle className="w-3.5 h-3.5 shrink-0" />
          ADDITIONAL
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
  const { summary, audit } = report;

  const combinedIncorrectRecords = useMemo(
    () => [...report.incorrectRecords, ...report.descriptionReviewRecords],
    [report.incorrectRecords, report.descriptionReviewRecords]
  );

  const combinedUnresolvedRecords = useMemo(
    () => [...report.missingItemCodeRecords, ...report.manualReviewRecords],
    [report.missingItemCodeRecords, report.manualReviewRecords]
  );

  const activeRecordList: BomVerificationRecord[] = useMemo(() => {
    switch (activeTab) {
      case 'incorrect':
        return combinedIncorrectRecords;
      case 'missing':
        return report.missingRecords;
      case 'additional':
        return report.additionalRecords;
      case 'unresolved':
        return combinedUnresolvedRecords;
      case 'matched':
        return report.matchedRecords;
      case 'all':
        return report.allRecords;
      case 'warnings':
      case 'audit':
        return [];
    }
  }, [
    activeTab,
    combinedIncorrectRecords,
    combinedUnresolvedRecords,
    report.additionalRecords,
    report.allRecords,
    report.matchedRecords,
    report.missingRecords,
  ]);

  const filteredRecords = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return activeRecordList;
    return activeRecordList.filter(
      (rec) =>
        rec.itemCode.toLowerCase().includes(q) ||
        rec.originalDescription.toLowerCase().includes(q) ||
        rec.bcDescription.toLowerCase().includes(q) ||
        rec.originalParentAssembly.toLowerCase().includes(q) ||
        rec.bcParentAssembly.toLowerCase().includes(q) ||
        rec.discrepancyCategory.toLowerCase().includes(q) ||
        rec.reasonForClassification.toLowerCase().includes(q)
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

  const isApproved = audit.validationStatus === 'APPROVED';
  const isCleanPass =
    isApproved && summary.verificationResult === 'VERIFIED – No discrepancies.';
  const isUnresolvedBanner =
    isApproved &&
    summary.verificationResult === 'UNRESOLVED – Some records require manual investigation.';

  return (
    <section className="space-y-5">
      {/* Verification Result Banner */}
      <div
        role="status"
        className={`rounded-lg border px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
          !isApproved
            ? 'bg-rose-50 border-rose-300 text-rose-950'
            : isCleanPass
              ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
              : isUnresolvedBanner
                ? 'bg-violet-50 border-violet-200 text-violet-950'
                : 'bg-red-50 border-red-200 text-red-950'
        }`}
      >
        <div className="flex items-start sm:items-center gap-3">
          {!isApproved ? (
            <AlertOctagon className="w-6 h-6 text-rose-700 shrink-0 mt-0.5 sm:mt-0" />
          ) : isCleanPass ? (
            <ShieldCheck className="w-6 h-6 text-emerald-700 shrink-0" />
          ) : (
            <ShieldAlert
              className={`w-6 h-6 shrink-0 ${
                isUnresolvedBanner ? 'text-violet-700' : 'text-red-700'
              }`}
            />
          )}
          <div>
            <p className="font-display text-base font-bold tracking-tight">
              {summary.verificationResult}
            </p>
            <p className="text-xs opacity-90 mt-0.5 font-mono tabular-nums">
              {!isApproved
                ? `3-Stage Audit failed: ${audit.failureReasons.join(' | ')}`
                : `Verified ${summary.verifiedAt} · Accuracy: ${summary.verificationFormulaText} · Std ${audit.originalOccurrencesAccounted}/${summary.originalCount} · Upl ${audit.bcOccurrencesAccounted}/${summary.bcCount}`}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => onTabChange('audit')}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white/90 border border-slate-300 text-slate-800 rounded-md hover:bg-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <ClipboardCheck className="w-3.5 h-3.5 text-slate-700" />
          3-Stage Verification ({audit.checks.filter((c) => c.passed).length}/{audit.checks.length})
        </button>
      </div>

      {/* Primary Summary Strip (Reconciles 1:1 with PDF Page 1 Summary) */}
      <div className="bg-white border border-slate-200 rounded-lg grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
        <div className="px-3.5 py-3.5">
          <p className="text-xs text-slate-500">Standard BOM</p>
          <p className="mt-1 text-lg font-semibold font-mono tabular-nums text-slate-900">
            {summary.originalCount}
          </p>
        </div>
        <div className="px-3.5 py-3.5">
          <p className="text-xs text-slate-500">Uploaded BOM</p>
          <p className="mt-1 text-lg font-semibold font-mono tabular-nums text-slate-900">
            {summary.bcCount}
          </p>
        </div>
        <div className="px-3.5 py-3.5">
          <p className="text-xs text-slate-500">Correctly Matched</p>
          <p className="mt-1 text-lg font-semibold font-mono tabular-nums text-emerald-700">
            {summary.matchedCount}
          </p>
        </div>
        <div className="px-3.5 py-3.5">
          <p className="text-xs text-slate-500">Incorrect</p>
          <p className="mt-1 text-lg font-semibold font-mono tabular-nums text-amber-700">
            {summary.incorrectOccurrenceCount}
          </p>
        </div>
        <div className="px-3.5 py-3.5">
          <p className="text-xs text-slate-500">Missing</p>
          <p className="mt-1 text-lg font-semibold font-mono tabular-nums text-red-700">
            {summary.missingCount}
          </p>
        </div>
        <div className="px-3.5 py-3.5">
          <p className="text-xs text-slate-500">Additional</p>
          <p className="mt-1 text-lg font-semibold font-mono tabular-nums text-indigo-700">
            {summary.additionalCount}
          </p>
        </div>
        <div className="px-3.5 py-3.5">
          <p className="text-xs text-slate-500">Unresolved</p>
          <p className="mt-1 text-lg font-semibold font-mono tabular-nums text-violet-700">
            {summary.unresolvedCount}
          </p>
        </div>
        <div className="px-3.5 py-3.5">
          <p className="text-xs text-slate-500">Total Field Errors</p>
          <p className="mt-1 text-lg font-semibold font-mono tabular-nums text-slate-900">
            {summary.totalFieldErrorsCount}
          </p>
        </div>
        <div className="px-3.5 py-3.5">
          <p className="text-xs text-slate-500">Verification %</p>
          <p
            className={`mt-1 text-lg font-semibold font-mono tabular-nums ${
              summary.verificationPercentage === 100 ? 'text-emerald-700' : 'text-slate-900'
            }`}
          >
            {summary.verificationPercentage.toFixed(1)}%
          </p>
        </div>
      </div>

      {/* 7-Field Breakdown */}
      <div className="bg-white border border-slate-200 rounded-lg grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
        <div className="px-3.5 py-3">
          <p className="text-[11px] text-slate-500">Incorrect Level</p>
          <p className="mt-0.5 text-base font-semibold font-mono tabular-nums text-slate-900">
            {summary.incorrectLevelCount}
          </p>
        </div>
        <div className="px-3.5 py-3">
          <p className="text-[11px] text-slate-500">Parent / Hierarchy</p>
          <p className="mt-0.5 text-base font-semibold font-mono tabular-nums text-slate-900">
            {summary.incorrectHierarchyCount}
          </p>
        </div>
        <div className="px-3.5 py-3">
          <p className="text-[11px] text-slate-500">Blank Part No.</p>
          <p className="mt-0.5 text-base font-semibold font-mono tabular-nums text-violet-700">
            {summary.missingItemCodeCount}
          </p>
        </div>
        <div className="px-3.5 py-3">
          <p className="text-[11px] text-slate-500">Description Errors</p>
          <p className="mt-0.5 text-base font-semibold font-mono tabular-nums text-amber-700">
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

      {/* Separate Verification Observations (Incorrect, Missing, Additional, Unresolved & Other) */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-4 py-2.5 border-b border-slate-200 bg-slate-50/70 flex items-center justify-between gap-3">
          <h2 className="text-xs font-semibold text-slate-800 uppercase tracking-wide">
            Verification Observations (By Category)
          </h2>
          <span className="text-[11px] text-slate-500">
            Click a category to inspect details
          </span>
        </div>
        <div className="divide-y divide-slate-100">
          {buildVerificationObservations(report).map((obs) => {
            const targetTab: ActiveResultTab =
              obs.category === 'Incorrect'
                ? 'incorrect'
                : obs.category === 'Missing'
                  ? 'missing'
                  : obs.category === 'Additional'
                    ? 'additional'
                    : obs.category === 'Unresolved'
                      ? 'unresolved'
                      : report.issues.length > 0
                        ? 'warnings'
                        : 'audit';

            const catColor =
              obs.category === 'Incorrect'
                ? 'text-amber-800'
                : obs.category === 'Missing'
                  ? 'text-red-700'
                  : obs.category === 'Additional'
                    ? 'text-indigo-700'
                    : obs.category === 'Unresolved'
                      ? 'text-violet-700'
                      : 'text-slate-700';

            return (
              <button
                key={obs.category}
                type="button"
                onClick={() => onTabChange(targetTab)}
                className="w-full text-left px-4 py-2.5 hover:bg-slate-50 transition-colors flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-4 cursor-pointer"
              >
                <span className={`text-xs font-semibold whitespace-nowrap w-44 shrink-0 ${catColor}`}>
                  {obs.title}
                </span>
                <span className="text-xs text-slate-700 leading-relaxed flex-1">
                  {obs.observation}
                </span>
              </button>
            );
          })}
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
              Incorrect Items ({summary.incorrectOccurrenceCount})
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
              Missing Items ({summary.missingCount})
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
              Additional Items ({summary.additionalCount})
            </button>
            <button
              type="button"
              onClick={() => onTabChange('unresolved')}
              className={`px-2.5 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'unresolved'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Unresolved Items ({summary.unresolvedCount})
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
              Correctly Matched ({summary.matchedCount})
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
              Warnings ({report.issues.length})
            </button>
            <button
              type="button"
              onClick={() => onTabChange('audit')}
              className={`px-2.5 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'audit'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              3-Stage Verification
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

          {activeTab !== 'audit' && (
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search Part No., parent, description…"
                className="h-8 pl-8 pr-3 w-64 text-xs text-slate-900 placeholder:text-slate-400 bg-white border border-slate-200 rounded-md focus-visible:outline-2 focus-visible:outline-blue-600"
              />
            </div>
          )}
        </div>

        {activeTab === 'audit' ? (
          <div className="p-5 space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="border border-slate-200 rounded-md p-4 bg-slate-50/60">
                <p className="text-xs font-semibold text-slate-700">
                  Standard BOM Occurrence Reconciliation
                </p>
                <p className="mt-1 text-lg font-mono font-bold tabular-nums text-slate-900">
                  {audit.originalOccurrencesAccounted} / {summary.originalCount}
                </p>
                <p className="mt-1 text-[11px] text-slate-600 font-mono tabular-nums">
                  {summary.matchedCount} matched + {summary.incorrectOccurrenceCount} incorrect +{' '}
                  {summary.missingCount} missing + {summary.unresolvedOriginalCount} unresolved
                </p>
              </div>
              <div className="border border-slate-200 rounded-md p-4 bg-slate-50/60">
                <p className="text-xs font-semibold text-slate-700">
                  Uploaded BOM Occurrence Reconciliation
                </p>
                <p className="mt-1 text-lg font-mono font-bold tabular-nums text-slate-900">
                  {audit.bcOccurrencesAccounted} / {summary.bcCount}
                </p>
                <p className="mt-1 text-[11px] text-slate-600 font-mono tabular-nums">
                  {summary.matchedCount} matched + {summary.incorrectOccurrenceCount} incorrect +{' '}
                  {summary.additionalCount} additional + {summary.unresolvedBcCount} unresolved
                </p>
              </div>
              <div className="border border-slate-200 rounded-md p-4 bg-slate-50/60">
                <p className="text-xs font-semibold text-slate-700">Accuracy &amp; Report Gate</p>
                <p
                  className={`mt-1 text-lg font-mono font-bold ${
                    isApproved ? 'text-emerald-700' : 'text-rose-700'
                  }`}
                >
                  {summary.verificationPercentage.toFixed(1)}% · {audit.validationStatus}
                </p>
                <p className="mt-1 text-[11px] text-slate-600 font-mono">
                  {summary.verificationFormulaText} · Pass 2 adj: {audit.stage2AdjustmentsCount}
                </p>
              </div>
            </div>

            <div className="overflow-x-auto border border-slate-200 rounded-md">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600">
                    <th className="py-2.5 px-4 whitespace-nowrap">Verification Pass</th>
                    <th className="py-2.5 px-4 whitespace-nowrap">Audit Check</th>
                    <th className="py-2.5 px-3 whitespace-nowrap">Status</th>
                    <th className="py-2.5 px-4 whitespace-nowrap">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {audit.checks.map((check, idx) => (
                    <tr key={`${check.stage}-${idx}`} className="hover:bg-slate-50/70">
                      <td className="py-2.5 px-4 font-medium text-slate-800 whitespace-nowrap">
                        {check.stage}
                      </td>
                      <td className="py-2.5 px-4 font-medium text-slate-900">
                        {check.checkName}
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        {check.passed ? (
                          <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            PASSED
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-rose-700 font-semibold">
                            <AlertOctagon className="w-3.5 h-3.5" />
                            FAILED
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-slate-700">{check.details}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {audit.stage2AdjustmentNotes.length > 0 && (
              <div className="border border-amber-200 bg-amber-50/50 rounded-md p-4 space-y-1.5">
                <p className="text-xs font-semibold text-amber-900">
                  Pass 2 Independent Structure &amp; Occurrence Adjustments
                </p>
                <ul className="list-disc pl-5 text-xs text-amber-900 space-y-1">
                  {audit.stage2AdjustmentNotes.map((note, idx) => (
                    <li key={idx}>{note}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : activeTab !== 'warnings' ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/50 text-[11px] font-semibold text-slate-600">
                  <th className="py-2.5 px-4 whitespace-nowrap">Status / Category</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">Level (Std / Upl)</th>
                  <th className="py-2.5 px-4 whitespace-nowrap">Parent Assembly &amp; Part No.</th>
                  <th className="py-2.5 px-4 whitespace-nowrap">Description (Std / Upl)</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">Item Type</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">UOM</th>
                  <th className="py-2.5 px-3 text-right whitespace-nowrap">BOM Qty. (Std / Upl)</th>
                  <th className="py-2.5 px-3 text-right whitespace-nowrap">Total Qty (Std / Upl)</th>
                  <th className="py-2.5 px-4 whitespace-nowrap">Rows &amp; Issue Details</th>
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
                          : rec.status === 'manual_review' || rec.status === 'missing_item_code'
                            ? 'bg-violet-50/35 hover:bg-violet-50/60'
                            : rec.status === 'incorrect' || rec.status === 'description_review'
                              ? 'bg-amber-50/35 hover:bg-amber-50/60'
                              : 'hover:bg-slate-50/80';

                    const hasBomQtyDiff = rec.changes.some((c) => c.field === 'BOM Qty.');
                    const hasTotalQtyDiff = rec.changes.some((c) => c.field === 'Total BOM Qty');
                    const hasItemTypeDiff = rec.changes.some((c) => c.field === 'Item Type');
                    const hasDescDiff =
                      rec.status === 'description_review' ||
                      rec.changes.some((c) => c.field === 'Description');
                    const bomDiffStr = formatNumericDiff(rec.bomQtyDiff);
                    const totalDiffStr = formatNumericDiff(rec.totalQtyDiff);

                    return (
                      <tr key={rec.key} className={`${rowTint} transition-colors`}>
                        <td className="py-2.5 px-4 align-top">
                          <div>{renderStatusLabel(rec.status)}</div>
                          <p className="mt-0.5 text-[11px] text-slate-600">
                            {rec.discrepancyCategory}
                          </p>
                        </td>
                        <td className="py-2.5 px-3 align-top font-mono tabular-nums text-slate-700 whitespace-nowrap">
                          {rec.originalLevel === rec.bcLevel
                            ? rec.originalLevel
                            : `${rec.originalLevel} / ${rec.bcLevel}`}
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
                          {rec.originalParentAssembly !== rec.bcParentAssembly &&
                          rec.originalParentAssembly !== '—' &&
                          rec.bcParentAssembly !== '—' ? (
                            <div
                              className="mt-0.5 text-[11px] text-slate-600 space-y-0.5"
                              style={{ paddingLeft: `${Math.min(rec.level, 6) * 12}px` }}
                            >
                              <p className="truncate max-w-xs" title={rec.originalParentAssembly}>
                                Std Parent: {rec.originalParentAssembly}
                              </p>
                              <p
                                className="truncate max-w-xs text-amber-800 font-medium"
                                title={rec.bcParentAssembly}
                              >
                                Upl Parent: {rec.bcParentAssembly}
                              </p>
                            </div>
                          ) : (
                            <p
                              className="mt-0.5 text-[11px] text-slate-500 truncate max-w-xs"
                              style={{ paddingLeft: `${Math.min(rec.level, 6) * 12}px` }}
                              title={rec.parentPath}
                            >
                              Parent: {rec.parentAssemblyCode} ({rec.componentRole})
                            </p>
                          )}
                        </td>
                        <td className="py-2.5 px-4 align-top text-slate-700 max-w-sm">
                          {hasDescDiff ? (
                            <div className="space-y-1 text-[11px]">
                              <div>
                                <span className="font-semibold text-slate-600">Std:</span>{' '}
                                <span className="text-slate-900">
                                  {rec.originalDescription || '—'}
                                </span>
                              </div>
                              <div>
                                <span className="font-semibold text-amber-800">Upl:</span>{' '}
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
                          <div>
                            {rec.originalBomQty ?? '—'} / {rec.bcBomQty ?? '—'}
                          </div>
                          {bomDiffStr && (
                            <div className="text-[10px] font-semibold text-amber-900">
                              Diff: {bomDiffStr}
                            </div>
                          )}
                        </td>
                        <td
                          className={`py-2.5 px-3 align-top text-right font-mono tabular-nums whitespace-nowrap ${
                            hasTotalQtyDiff
                              ? 'font-bold text-amber-800 bg-amber-100/60'
                              : 'text-slate-900 font-medium'
                          }`}
                        >
                          <div>
                            {rec.originalTotalQty ?? '—'} / {rec.bcTotalQty ?? '—'}
                          </div>
                          {totalDiffStr && (
                            <div className="text-[10px] font-semibold text-amber-900">
                              Diff: {totalDiffStr}
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-4 align-top text-slate-700 min-w-[270px]">
                          <p className="text-[11px] font-mono text-slate-500 mb-0.5 tabular-nums">
                            Std Row: {rec.originalRowNumber ?? '—'} · Upl Row:{' '}
                            {rec.bcRowNumber ?? '—'}
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
                              {rec.reasonForClassification}
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
                    <th className="py-2.5 px-3 whitespace-nowrap">Source BOM</th>
                    <th className="py-2.5 px-3 whitespace-nowrap">Row</th>
                    <th className="py-2.5 px-3 whitespace-nowrap">Level</th>
                    <th className="py-2.5 px-4 whitespace-nowrap">Parent Assembly</th>
                    <th className="py-2.5 px-4 whitespace-nowrap">Part No.</th>
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
