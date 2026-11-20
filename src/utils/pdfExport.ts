import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { BomVerificationRecord, BomVerificationReport } from '../types/bom';

function buildDetailedRows(records: BomVerificationRecord[]): string[][] {
  return records.map((r) => {
    const origVal =
      r.status === 'missing'
        ? `Lvl ${r.rawLevel} · Qty ${r.originalBomQty ?? '—'} · Total ${r.originalTotalQty ?? '—'} · ${r.uom || '—'}`
        : r.status === 'additional'
          ? 'Not in Original'
          : r.status === 'missing_item_code'
            ? r.sourceSide === 'Original Navigation'
              ? `Row ${r.originalNode?.rowNumber ?? ''} · Blank No.`
              : '—'
            : r.changes.map((c) => `${c.field}: ${c.before}`).join(' | ');

    const bcVal =
      r.status === 'additional'
        ? `Lvl ${r.rawLevel} · Qty ${r.bcBomQty ?? '—'} · Total ${r.bcTotalQty ?? '—'} · ${r.uom || '—'}`
        : r.status === 'missing'
          ? 'Missing in BC'
          : r.status === 'missing_item_code'
            ? r.sourceSide === 'Business Central'
              ? `Row ${r.bcNode?.rowNumber ?? ''} · Blank No.`
              : '—'
            : r.changes.map((c) => `${c.field}: ${c.after}`).join(' | ');

    const descDisplay =
      r.status === 'description_review' || r.originalDescription !== r.bcDescription
        ? `Orig: ${r.originalDescription || '—'}\nBC: ${r.bcDescription || '—'}`
        : r.description || '—';

    return [
      r.errorCategory,
      r.rawLevel || String(r.level),
      r.parentAssemblyCode || 'Root',
      r.itemCode,
      descDisplay,
      origVal || '—',
      bcVal || '—',
      r.detailedExplanation,
    ];
  });
}

export function exportBomVerificationPdf(
  report: BomVerificationReport,
  originalFileName: string,
  bcFileName: string
): void {
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'pt',
    format: 'a4',
  });

  const { summary } = report;
  const pageWidth = doc.internal.pageSize.getWidth();

  // Page 1: BOM Verification Summary
  doc.setFontSize(16);
  doc.setTextColor(15, 23, 42);
  doc.text('ENGINEERING BOM VERIFICATION SYSTEM', 40, 40);

  doc.setFontSize(10);
  doc.setTextColor(71, 85, 105);
  doc.text('Navigation to Microsoft Dynamics 365 Business Central – Verification Summary', 40, 58);

  const isPass = summary.overallStatus === 'PASS';
  doc.setFillColor(isPass ? 236 : 254, isPass ? 253 : 242, isPass ? 245 : 242);
  doc.setDrawColor(isPass ? 16 : 220, isPass ? 185 : 38, isPass ? 129 : 38);
  doc.roundedRect(40, 72, pageWidth - 80, 30, 4, 4, 'FD');

  doc.setFontSize(11);
  doc.setTextColor(isPass ? 4 : 185, isPass ? 120 : 28, isPass ? 87 : 28);
  doc.text(
    isPass
      ? 'OVERALL RESULT: PASS – No discrepancies found.'
      : 'OVERALL RESULT: FAIL – Discrepancies found.',
    54,
    91
  );

  autoTable(doc, {
    startY: 114,
    head: [['Verification Parameter', 'Value']],
    body: [
      ['Original Navigation BOM Filename', originalFileName],
      ['Business Central BOM Filename', bcFileName],
      ['Verification Date & Time', summary.verifiedAt],
      ['Total Original Records', String(summary.originalCount)],
      ['Total Uploaded (Business Central) Records', String(summary.bcCount)],
      ['Correctly Matched Records', String(summary.matchedCount)],
      [
        'Matched Records with Field Errors',
        `${summary.matchedWithFieldErrorsTotal} (${summary.recordsWithErrorsCount} Field/Hierarchy Errors, ${summary.descriptionReviewCount} Description Differences – Review Required)`,
      ],
      [
        'Missing Records',
        `${summary.missingCount} (${summary.missingParentCount} Parent Assemblies, ${summary.missingChildCount} Child Components)`,
      ],
      [
        'Additional Records',
        `${summary.additionalCount} (${summary.additionalParentCount} Parent Assemblies, ${summary.additionalChildCount} Child Components)`,
      ],
      [
        'Missing Item Code Records (Blank No.)',
        `${summary.missingItemCodeCount} (Original: ${summary.missingItemCodeOriginalCount}, BC: ${summary.missingItemCodeBcCount})`,
      ],
      ['Supplementary Structural Warnings', String(summary.supplementaryWarningCount)],
      ['Overall Status', summary.overallStatus],
    ],
    styles: {
      fontSize: 8.5,
      cellPadding: 4.5,
      textColor: [15, 23, 42],
    },
    headStyles: {
      fillColor: [30, 41, 59],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
    },
    columnStyles: {
      0: { cellWidth: 270, fontStyle: 'bold' },
    },
    margin: { left: 40, right: 40 },
  });

  const summaryTableEnd =
    (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? 370;

  autoTable(doc, {
    startY: summaryTableEnd + 12,
    head: [['Discrepancy Field / Category', 'Count']],
    body: [
      ['Incorrect Level', String(summary.incorrectLevelCount)],
      ['Incorrect Item Code / Parent-Child Relationship', String(summary.incorrectHierarchyCount)],
      ['Description Differences (Review Required + Combined)', String(summary.incorrectDescriptionCount)],
      [
        'Incorrect Item Type (Purchase vs Prod. Order)',
        `${summary.incorrectItemTypeCount} (${summary.purchaseVsProdOrderCount} Purchase vs Prod. Order)`,
      ],
      ['Incorrect UOM', String(summary.incorrectUomCount)],
      ['Incorrect BOM Qty.', String(summary.incorrectBomQtyCount)],
      ['Incorrect Total BOM Qty', String(summary.incorrectTotalBomQtyCount)],
    ],
    styles: {
      fontSize: 8,
      cellPadding: 4,
      textColor: [15, 23, 42],
    },
    headStyles: {
      fillColor: [51, 65, 85],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
    },
    columnStyles: {
      0: { cellWidth: 270 },
    },
    margin: { left: 40, right: 40 },
  });

  const detailHeaders = [
    [
      'Error Category',
      'BOM Level',
      'Parent Assembly Code',
      'Item Code',
      'Description',
      'Original Value',
      'Business Central Value',
      'Detailed Explanation',
    ],
  ];

  const combinedIncorrect = [
    ...report.incorrectRecords,
    ...report.descriptionReviewRecords,
    ...report.missingItemCodeRecords,
  ];

  const sections: Array<{
    title: string;
    records: BomVerificationRecord[];
    headColor: [number, number, number];
  }> = [
    {
      title: `Section 1: Missing Components (${report.missingRecords.length})`,
      records: report.missingRecords,
      headColor: [185, 28, 28],
    },
    {
      title: `Section 2: Additional Components (${report.additionalRecords.length})`,
      records: report.additionalRecords,
      headColor: [67, 56, 202],
    },
    {
      title: `Section 3: Incorrect Entries, Description Review & Missing Item Codes (${combinedIncorrect.length})`,
      records: combinedIncorrect,
      headColor: [180, 83, 9],
    },
  ];

  for (const section of sections) {
    doc.addPage();
    doc.setFontSize(12);
    doc.setTextColor(15, 23, 42);
    doc.text(section.title, 40, 40);

    if (section.records.length === 0) {
      doc.setFontSize(9.5);
      doc.setTextColor(71, 85, 105);
      doc.text('No discrepancies recorded in this category.', 40, 64);
    } else {
      autoTable(doc, {
        startY: 54,
        head: detailHeaders,
        body: buildDetailedRows(section.records),
        styles: {
          fontSize: 7.5,
          cellPadding: 4,
          overflow: 'linebreak',
          textColor: [15, 23, 42],
        },
        headStyles: {
          fillColor: section.headColor,
          textColor: [255, 255, 255],
          fontStyle: 'bold',
        },
        margin: { left: 40, right: 40 },
      });
    }
  }

  // Section 4: Structural Warnings
  if (report.issues.length > 0) {
    doc.addPage();
    doc.setFontSize(12);
    doc.setTextColor(15, 23, 42);
    doc.text(`Section 4: Structural Warnings (${report.issues.length})`, 40, 40);

    autoTable(doc, {
      startY: 54,
      head: [
        [
          'Warning Category',
          'Source Report',
          'Source Row',
          'Level',
          'Parent Assembly',
          'Item Code',
          'Description',
          'Explanation',
        ],
      ],
      body: report.issues.map((i) => [
        i.warningCategory,
        i.source,
        String(i.rowNumber),
        i.level,
        i.parentAssembly,
        i.itemCode,
        i.description || '—',
        i.message,
      ]),
      styles: {
        fontSize: 7.5,
        cellPadding: 4,
        overflow: 'linebreak',
        textColor: [15, 23, 42],
      },
      headStyles: {
        fillColor: [146, 64, 14],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
      },
      margin: { left: 40, right: 40 },
    });
  }

  doc.save('BOM_Verification_Report.pdf');
}
