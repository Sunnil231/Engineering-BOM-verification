import * as XLSX from 'xlsx';
import type { BomVerificationReport, ExcelContainerFormat } from '../types/bom';

export function buildExcelErrorReportBinary(
  report: BomVerificationReport,
  originalFileName: string,
  bcFileName: string,
  format: ExcelContainerFormat
): Uint8Array {
  const { summary } = report;
  const wb = XLSX.utils.book_new();

  const origReconciledTotal =
    summary.matchedCount +
    summary.matchedWithFieldErrorsTotal +
    summary.missingCount +
    summary.missingItemCodeOriginalCount;
  const bcReconciledTotal =
    summary.matchedCount +
    summary.matchedWithFieldErrorsTotal +
    summary.additionalCount +
    summary.missingItemCodeBcCount;

  // Sheet 1: Summary
  const summaryRows = [
    {
      Section: 'Report Info',
      Parameter: 'Verification System',
      Value: 'Engineering BOM Verification System (NAV to Business Central)',
    },
    { Section: 'Report Info', Parameter: 'Original Navigation BOM Filename', Value: originalFileName },
    { Section: 'Report Info', Parameter: 'Business Central BOM Filename', Value: bcFileName },
    { Section: 'Report Info', Parameter: 'Verification Date & Time', Value: summary.verifiedAt },
    {
      Section: 'Report Info',
      Parameter: 'Overall Status',
      Value:
        summary.overallStatus === 'PASS'
          ? 'PASS – No discrepancies found.'
          : 'FAIL – Discrepancies found.',
    },
    { Section: 'Occurrence Totals', Parameter: 'Original BOM Component Count', Value: summary.originalCount },
    { Section: 'Occurrence Totals', Parameter: 'Business Central BOM Component Count', Value: summary.bcCount },
    {
      Section: 'Verification Breakdown',
      Parameter: 'Correctly Matched Records',
      Value: summary.matchedCount,
    },
    {
      Section: 'Verification Breakdown',
      Parameter: 'Matched Records with Field Errors (Total)',
      Value: summary.matchedWithFieldErrorsTotal,
    },
    {
      Section: 'Verification Breakdown',
      Parameter: '  - Field & Hierarchy Errors',
      Value: summary.recordsWithErrorsCount,
    },
    {
      Section: 'Verification Breakdown',
      Parameter: '  - Description Differences – Review Required',
      Value: summary.descriptionReviewCount,
    },
    {
      Section: 'Verification Breakdown',
      Parameter: 'Missing Components',
      Value: summary.missingCount,
    },
    {
      Section: 'Verification Breakdown',
      Parameter: '  - Missing Parent Assemblies',
      Value: summary.missingParentCount,
    },
    {
      Section: 'Verification Breakdown',
      Parameter: '  - Missing Child Components',
      Value: summary.missingChildCount,
    },
    {
      Section: 'Verification Breakdown',
      Parameter: 'Additional Components',
      Value: summary.additionalCount,
    },
    {
      Section: 'Verification Breakdown',
      Parameter: '  - Additional Parent Assemblies',
      Value: summary.additionalParentCount,
    },
    {
      Section: 'Verification Breakdown',
      Parameter: '  - Additional Child Components',
      Value: summary.additionalChildCount,
    },
    {
      Section: 'Verification Breakdown',
      Parameter: 'Missing Item Code Records (Unmatched Blank No.)',
      Value: summary.missingItemCodeCount,
    },
    {
      Section: 'Verification Breakdown',
      Parameter: '  - Original Navigation Missing Item Code',
      Value: summary.missingItemCodeOriginalCount,
    },
    {
      Section: 'Verification Breakdown',
      Parameter: '  - Business Central Missing Item Code',
      Value: summary.missingItemCodeBcCount,
    },
    {
      Section: 'Reconciliation Check',
      Parameter:
        'Original Occurrence Reconciliation (Matched + Matched w/ Errors + Missing + Orig Missing Item Code)',
      Value: `${origReconciledTotal} / ${summary.originalCount}`,
    },
    {
      Section: 'Reconciliation Check',
      Parameter:
        'Business Central Occurrence Reconciliation (Matched + Matched w/ Errors + Additional + BC Missing Item Code)',
      Value: `${bcReconciledTotal} / ${summary.bcCount}`,
    },
    { Section: 'Field Error Breakdown', Parameter: 'Incorrect Level', Value: summary.incorrectLevelCount },
    {
      Section: 'Field Error Breakdown',
      Parameter: 'Incorrect Item Code / Parent-Child Relationship',
      Value: summary.incorrectHierarchyCount,
    },
    {
      Section: 'Field Error Breakdown',
      Parameter: 'Incorrect Description (Review Required + Combined)',
      Value: summary.incorrectDescriptionCount,
    },
    {
      Section: 'Field Error Breakdown',
      Parameter: 'Incorrect Item Type (Total)',
      Value: summary.incorrectItemTypeCount,
    },
    {
      Section: 'Field Error Breakdown',
      Parameter: '  - Purchase vs Prod. Order Mismatches',
      Value: summary.purchaseVsProdOrderCount,
    },
    { Section: 'Field Error Breakdown', Parameter: 'Incorrect UOM', Value: summary.incorrectUomCount },
    { Section: 'Field Error Breakdown', Parameter: 'Incorrect BOM Qty.', Value: summary.incorrectBomQtyCount },
    {
      Section: 'Field Error Breakdown',
      Parameter: 'Incorrect Total BOM Qty',
      Value: summary.incorrectTotalBomQtyCount,
    },
    {
      Section: 'Supplementary Warnings',
      Parameter: 'Structural Warnings Count (Reconciles with Structural Warnings sheet)',
      Value: summary.supplementaryWarningCount,
    },
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows), 'Summary');

  // Sheet 2: Missing Components
  const missingRows =
    report.missingRecords.length > 0
      ? report.missingRecords.map((r) => ({
          'Error Category': r.errorCategory,
          'Component Role': r.componentRole,
          'BOM Level': r.rawLevel || r.level,
          'Parent Assembly Code': r.parentAssemblyCode,
          'Parent Hierarchy Path': r.parentPath,
          'Item Code (No.)': r.itemCode,
          Description: r.description,
          'Item Type': r.itemType,
          UOM: r.uom,
          'Original BOM Qty.': r.originalBomQty ?? '',
          'Original Total BOM Qty': r.originalTotalQty ?? '',
          'Original Row': r.originalNode?.rowNumber ?? '',
          'Detailed Explanation': r.detailedExplanation,
        }))
      : [{ Status: 'No missing components found.' }];
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(missingRows),
    'Missing Components'
  );

  // Sheet 3: Additional Components
  const additionalRows =
    report.additionalRecords.length > 0
      ? report.additionalRecords.map((r) => ({
          'Error Category': r.errorCategory,
          'Component Role': r.componentRole,
          'BOM Level': r.rawLevel || r.level,
          'Parent Assembly Code': r.parentAssemblyCode,
          'Parent Hierarchy Path': r.parentPath,
          'Item Code (No.)': r.itemCode,
          Description: r.description,
          'Item Type': r.itemType,
          UOM: r.uom,
          'BC BOM Qty.': r.bcBomQty ?? '',
          'BC Total BOM Qty': r.bcTotalQty ?? '',
          'BC Row': r.bcNode?.rowNumber ?? '',
          'Detailed Explanation': r.detailedExplanation,
        }))
      : [{ Status: 'No additional components found.' }];
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(additionalRows),
    'Additional Components'
  );

  // Sheet 4: Incorrect Entries (includes Field/Hierarchy Errors, Description Differences – Review Required, and Missing Item Code)
  const combinedIncorrect = [
    ...report.incorrectRecords,
    ...report.descriptionReviewRecords,
    ...report.missingItemCodeRecords,
  ];

  const incorrectRows =
    combinedIncorrect.length > 0
      ? combinedIncorrect.map((r) => ({
          Classification:
            r.status === 'description_review'
              ? 'Description Differences – Review Required'
              : r.status === 'missing_item_code'
                ? 'Missing Item Code'
                : 'Field / Hierarchy Error',
          'Error Category': r.errorCategory,
          'Source Report': r.sourceSide ?? 'Both',
          'Original Row': r.originalNode?.rowNumber ?? '',
          'BC Row': r.bcNode?.rowNumber ?? '',
          'BOM Level (Orig / BC)':
            r.status === 'missing_item_code'
              ? r.rawLevel || String(r.level)
              : `${r.originalNode?.rawLevel ?? ''} / ${r.bcNode?.rawLevel ?? ''}`,
          'Parent Assembly Code': r.parentAssemblyCode,
          'Original Parent Path': r.originalNode?.parentPath ?? '',
          'BC Parent Path': r.bcNode?.parentPath ?? '',
          'Item Code (No.)': r.itemCode,
          'Original Description': r.originalDescription,
          'BC Description': r.bcDescription,
          'Original Item Type': r.originalNode?.itemType ?? '',
          'BC Item Type': r.bcNode?.itemType ?? '',
          'Original UOM': r.originalNode?.uom ?? '',
          'BC UOM': r.bcNode?.uom ?? '',
          'Original BOM Qty.': r.originalBomQty ?? '',
          'BC BOM Qty.': r.bcBomQty ?? '',
          'Original Total BOM Qty': r.originalTotalQty ?? '',
          'BC Total BOM Qty': r.bcTotalQty ?? '',
          'Original Value':
            r.status === 'missing_item_code'
              ? r.sourceSide === 'Original Navigation'
                ? '(Blank Item Code)'
                : '—'
              : r.changes.map((c) => `${c.field}: ${c.before}`).join(' | '),
          'Business Central Value':
            r.status === 'missing_item_code'
              ? r.sourceSide === 'Business Central'
                ? '(Blank Item Code)'
                : '—'
              : r.changes.map((c) => `${c.field}: ${c.after}`).join(' | '),
          'Detailed Explanation': r.detailedExplanation,
        }))
      : [{ Status: 'No incorrect entries, description review items, or missing item codes found.' }];
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(incorrectRows),
    'Incorrect Entries'
  );

  // Sheet 5: Correctly Matched Records
  const matchedRows =
    report.matchedRecords.length > 0
      ? report.matchedRecords.map((r) => ({
          Status: 'MATCHED',
          'Component Role': r.componentRole,
          'BOM Level': r.rawLevel || r.level,
          'Parent Assembly Code': r.parentAssemblyCode,
          'Parent Hierarchy Path': r.parentPath,
          'Item Code (No.)': r.itemCode,
          Description: r.description,
          'Item Type': r.itemType,
          UOM: r.uom,
          'BOM Qty.': r.bcBomQty ?? r.originalBomQty ?? '',
          'Total BOM Qty': r.bcTotalQty ?? r.originalTotalQty ?? '',
          'Original Row': r.originalNode?.rowNumber ?? '',
          'BC Row': r.bcNode?.rowNumber ?? '',
        }))
      : [{ Status: 'No matched records.' }];
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(matchedRows),
    'Correctly Matched Records'
  );

  // Sheet 6: Structural Warnings (reconciles 1:1 with Summary warning count)
  const warningRows =
    report.issues.length > 0
      ? report.issues.map((issue) => ({
          'Warning Category': issue.warningCategory,
          'Warning Code': issue.code,
          'Source Report': issue.source,
          'Source Row': issue.rowNumber,
          'BOM Level': issue.level,
          'Parent Assembly': issue.parentAssembly,
          'Parent Hierarchy Path': issue.hierarchyPath,
          'Item Code (No.)': issue.itemCode,
          Description: issue.description || '—',
          Explanation: issue.message,
        }))
      : [{ Status: 'No structural warnings found.' }];
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(warningRows),
    'Structural Warnings'
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
  anchor.download = `BOM_Error_Report.${ext}`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
