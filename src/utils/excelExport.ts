import * as XLSX from 'xlsx';
import type {
  BomVerificationRecord,
  BomVerificationReport,
  ExcelContainerFormat,
} from '../types/bom';
import { buildVerificationObservations } from './bomObservations';

function formatDiffCell(diff: number | null): string | number {
  if (diff === null || !Number.isFinite(diff)) return '';
  return diff > 0 ? `+${diff}` : diff;
}

function buildIncorrectSheetRows(report: BomVerificationReport): Record<string, unknown>[] {
  const combinedIncorrect: BomVerificationRecord[] = [
    ...report.incorrectRecords,
    ...report.descriptionReviewRecords,
  ];

  if (combinedIncorrect.length === 0) {
    return [{ Status: 'CORRECT — No incorrect field or hierarchy discrepancies found.' }];
  }

  const rows: Record<string, unknown>[] = [];
  let sr = 1;

  for (const r of combinedIncorrect) {
    const levelDisplay =
      r.originalLevel === r.bcLevel
        ? r.originalLevel
        : `Std: ${r.originalLevel} / Upl: ${r.bcLevel}`;
    const parentAssembly =
      r.originalParentAssembly === r.bcParentAssembly
        ? r.originalParentAssembly
        : `Std: ${r.originalParentAssembly} | Upl: ${r.bcParentAssembly}`;
    const stdPath = r.originalNode?.hierarchyPath || r.hierarchyPath || '—';
    const uplPath = r.bcNode?.hierarchyPath || r.hierarchyPath || '—';

    if (r.changes.length === 0) {
      rows.push({
        'Sr.': sr++,
        Status: 'INCORRECT',
        Level: levelDisplay,
        'Parent Assembly': parentAssembly,
        'Standard Hierarchy Path': stdPath,
        'Uploaded Hierarchy Path': uplPath,
        'Part No.': r.itemCode,
        Description: r.description || r.originalDescription || '—',
        Field: 'General',
        'Standard Value': r.originalValueSummary || '—',
        'Uploaded Value': r.bcValueSummary || '—',
        'Numeric Diff': '',
        'Standard Row': r.originalRowNumber ?? '',
        'Uploaded Row': r.bcRowNumber ?? '',
        Issue: r.reasonForClassification,
      });
    } else {
      for (const change of r.changes) {
        rows.push({
          'Sr.': sr++,
          Status: 'INCORRECT',
          Level: levelDisplay,
          'Parent Assembly': parentAssembly,
          'Standard Hierarchy Path': stdPath,
          'Uploaded Hierarchy Path': uplPath,
          'Part No.': r.itemCode,
          Description:
            change.field === 'Description'
              ? `Std: ${r.originalDescription || '—'} | Upl: ${r.bcDescription || '—'}`
              : r.description || r.originalDescription || '—',
          Field: change.field,
          'Standard Value': change.before || '—',
          'Uploaded Value': change.after || '—',
          'Numeric Diff':
            change.numericDiff !== undefined ? formatDiffCell(change.numericDiff) : '',
          'Standard Row': r.originalRowNumber ?? '',
          'Uploaded Row': r.bcRowNumber ?? '',
          Issue: change.explanation,
        });
      }
    }
  }

  return rows;
}

function buildMissingSheetRows(report: BomVerificationReport): Record<string, unknown>[] {
  if (report.missingRecords.length === 0) {
    return [{ Status: 'CORRECT — No missing items found.' }];
  }

  return report.missingRecords.map((r, idx) => ({
    'Sr.': idx + 1,
    Status: 'MISSING',
    Level: r.originalLevel,
    'Parent Assembly': r.originalParentAssembly,
    'Hierarchical Path': r.originalNode?.hierarchyPath || r.hierarchyPath,
    'Part No.': r.itemCode,
    Description: r.originalDescription || '—',
    'Item Type': r.itemType || '—',
    UOM: r.uom || '—',
    'Standard BOM Qty.': r.originalBomQty ?? '',
    'Standard Total BOM Qty': r.originalTotalQty ?? '',
    'Standard Value': r.originalValueSummary,
    'Uploaded Value': 'MISSING',
    'Standard Row': r.originalRowNumber ?? '',
    Issue: r.reasonForClassification,
  }));
}

function buildAdditionalSheetRows(report: BomVerificationReport): Record<string, unknown>[] {
  if (report.additionalRecords.length === 0) {
    return [{ Status: 'CORRECT — No additional items found.' }];
  }

  return report.additionalRecords.map((r, idx) => ({
    'Sr.': idx + 1,
    Status: 'ADDITIONAL',
    Level: r.bcLevel,
    'Parent Assembly': r.bcParentAssembly,
    'Hierarchical Path': r.bcNode?.hierarchyPath || r.hierarchyPath,
    'Part No.': r.itemCode,
    Description: r.bcDescription || '—',
    'Item Type': r.itemType || '—',
    UOM: r.uom || '—',
    'Uploaded BOM Qty.': r.bcBomQty ?? '',
    'Uploaded Total BOM Qty': r.bcTotalQty ?? '',
    'Standard Value': '—',
    'Uploaded Value': r.bcValueSummary,
    'Uploaded Row': r.bcRowNumber ?? '',
    Issue: r.reasonForClassification,
  }));
}

function buildUnresolvedSheetRows(report: BomVerificationReport): Record<string, unknown>[] {
  const combinedUnresolved: BomVerificationRecord[] = [
    ...report.missingItemCodeRecords,
    ...report.manualReviewRecords,
  ];

  if (combinedUnresolved.length === 0) {
    return [{ Status: 'CORRECT — No unresolved items requiring manual investigation.' }];
  }

  return combinedUnresolved.map((r, idx) => {
    const levelDisplay =
      r.originalLevel !== '—' && r.originalLevel !== '' ? r.originalLevel : r.bcLevel || '—';
    const parentAssembly =
      r.originalParentAssembly !== '—' && r.originalParentAssembly !== ''
        ? r.originalParentAssembly
        : r.bcParentAssembly || '—';

    return {
      'Sr.': idx + 1,
      Status: 'UNRESOLVED',
      'Source BOM': r.sourceSide ?? 'Both',
      Level: levelDisplay,
      'Parent Assembly': parentAssembly,
      'Hierarchical Path': r.hierarchyPath || '—',
      'Part No.': r.itemCode || '(Blank)',
      Description: r.description || r.originalDescription || r.bcDescription || '—',
      'Item Type': r.itemType || '—',
      UOM: r.uom || '—',
      'Standard Value': r.originalValueSummary || '—',
      'Uploaded Value': r.bcValueSummary || '—',
      'Standard Row': r.originalRowNumber ?? '',
      'Uploaded Row': r.bcRowNumber ?? '',
      Issue: r.reasonForClassification,
    };
  });
}

export function buildExcelErrorReportBinary(
  report: BomVerificationReport,
  _originalFileName: string,
  _bcFileName: string,
  format: ExcelContainerFormat
): Uint8Array {
  if (report.audit.validationStatus !== 'APPROVED') {
    throw new Error(
      'VALIDATION INCOMPLETE – REPORT NOT APPROVED: Excel discrepancy report generation is blocked until all three verification stages and count reconciliation pass.'
    );
  }

  const wb = XLSX.utils.book_new();

  // Exact 4 Discrepancy Worksheets Only
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(buildIncorrectSheetRows(report)),
    'Incorrect Items'
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(buildMissingSheetRows(report)),
    'Missing Items'
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(buildAdditionalSheetRows(report)),
    'Additional Items'
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(buildUnresolvedSheetRows(report)),
    'Unresolved Items'
  );

  const observations = buildVerificationObservations(report);
  const observationRows: Record<string, unknown>[] = [
    ...observations.map((obs) => ({
      Section: 'Category Observation',
      Category: obs.category,
      Count: obs.countLabel,
      Observation: obs.observation,
    })),
    ...report.issues.map((issue) => ({
      Section: 'Other – Structural Warning',
      Category: issue.warningCategory,
      Count: `${issue.source} Row ${issue.rowNumber}`,
      Observation: `[${issue.itemCode} | Parent: ${issue.parentAssembly} | Level ${issue.level}] ${issue.message}`,
    })),
  ];

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(observationRows),
    'Observations & Other'
  );

  const bookType: XLSX.BookType = format === 'xls' ? 'biff8' : 'xlsx';
  const out = XLSX.write(wb, { bookType, type: 'array' }) as ArrayBuffer | Uint8Array;
  return out instanceof Uint8Array ? out : new Uint8Array(out);
}

export function exportBomVerificationExcel(
  report: BomVerificationReport,
  originalFileName: string,
  bcFileName: string,
  format: ExcelContainerFormat
): void {
  const bytes = buildExcelErrorReportBinary(report, originalFileName, bcFileName, format);
  const ext = format === 'xls' ? 'xls' : 'xlsx';
  const mime =
    format === 'xls'
      ? 'application/vnd.ms-excel'
      : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `BOM_Discrepancy_Report.${ext}`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
