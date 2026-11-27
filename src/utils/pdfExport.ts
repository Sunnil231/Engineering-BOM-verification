import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { BomVerificationRecord, BomVerificationReport } from '../types/bom';
import { buildVerificationObservations } from './bomObservations';

export interface PdfDiscrepancyRow {
  sr: number;
  statusTag: 'INCORRECT' | 'MISSING' | 'ADDITIONAL' | 'UNRESOLVED';
  level: string;
  parentAssembly: string;
  partNo: string;
  field: string;
  standardValue: string;
  uploadedValue: string;
  issue: string;
}

function formatQtySummary(
  bomQty: number | null,
  totalQty: number | null,
  uom: string,
  itemType: string
): string {
  const parts: string[] = [];
  if (bomQty !== null && Number.isFinite(bomQty)) {
    parts.push(`Qty ${bomQty}`);
  }
  if (totalQty !== null && Number.isFinite(totalQty)) {
    parts.push(`Total ${totalQty}`);
  }
  if (uom && uom !== '—') {
    parts.push(uom);
  }
  if (itemType && itemType !== '—') {
    parts.push(itemType);
  }
  return parts.length > 0 ? parts.join(' | ') : '—';
}

export function buildPdfDiscrepancyRows(report: BomVerificationReport): PdfDiscrepancyRow[] {
  const rows: PdfDiscrepancyRow[] = [];
  let sr = 1;

  const combinedIncorrect: BomVerificationRecord[] = [
    ...report.incorrectRecords,
    ...report.descriptionReviewRecords,
  ];

  for (const rec of combinedIncorrect) {
    const levelText =
      rec.originalLevel === rec.bcLevel
        ? rec.originalLevel
        : `Std: ${rec.originalLevel} / Upl: ${rec.bcLevel}`;
    const parentText =
      rec.originalParentAssembly === rec.bcParentAssembly
        ? rec.originalParentAssembly
        : `Std: ${rec.originalParentAssembly}\nUpl: ${rec.bcParentAssembly}`;
    const rowRef = `Std Row ${rec.originalRowNumber ?? '—'}, Upl Row ${rec.bcRowNumber ?? '—'}`;

    if (rec.changes.length === 0) {
      rows.push({
        sr: sr++,
        statusTag: 'INCORRECT',
        level: levelText,
        parentAssembly: parentText,
        partNo: rec.itemCode,
        field: 'General',
        standardValue: rec.originalValueSummary || '—',
        uploadedValue: rec.bcValueSummary || '—',
        issue: `INCORRECT — ${rec.reasonForClassification} (${rowRef})`,
      });
    } else {
      for (const change of rec.changes) {
        rows.push({
          sr: sr++,
          statusTag: 'INCORRECT',
          level: levelText,
          parentAssembly: parentText,
          partNo: rec.itemCode,
          field: change.field,
          standardValue: change.before || '—',
          uploadedValue: change.after || '—',
          issue: `INCORRECT — ${change.explanation} (${rowRef})`,
        });
      }
    }
  }

  for (const rec of report.missingRecords) {
    rows.push({
      sr: sr++,
      statusTag: 'MISSING',
      level: rec.originalLevel,
      parentAssembly: rec.originalParentAssembly,
      partNo: rec.itemCode,
      field: 'Component',
      standardValue: formatQtySummary(
        rec.originalBomQty,
        rec.originalTotalQty,
        rec.uom,
        rec.itemType
      ),
      uploadedValue: 'MISSING',
      issue: `MISSING — Present in Standard BOM (Row ${rec.originalRowNumber ?? '—'}) under ${rec.originalParentAssembly}, missing from Uploaded BOM.`,
    });
  }

  for (const rec of report.additionalRecords) {
    rows.push({
      sr: sr++,
      statusTag: 'ADDITIONAL',
      level: rec.bcLevel,
      parentAssembly: rec.bcParentAssembly,
      partNo: rec.itemCode,
      field: 'Component',
      standardValue: '—',
      uploadedValue: formatQtySummary(rec.bcBomQty, rec.bcTotalQty, rec.uom, rec.itemType),
      issue: `ADDITIONAL ITEM — Present in Uploaded BOM (Row ${rec.bcRowNumber ?? '—'}) under ${rec.bcParentAssembly}, not in Standard BOM.`,
    });
  }

  const combinedUnresolved: BomVerificationRecord[] = [
    ...report.missingItemCodeRecords,
    ...report.manualReviewRecords,
  ];

  for (const rec of combinedUnresolved) {
    const levelText =
      rec.originalLevel !== '—' && rec.originalLevel !== ''
        ? rec.originalLevel
        : rec.bcLevel || '—';
    const parentText =
      rec.originalParentAssembly !== '—' && rec.originalParentAssembly !== ''
        ? rec.originalParentAssembly
        : rec.bcParentAssembly || '—';

    rows.push({
      sr: sr++,
      statusTag: 'UNRESOLVED',
      level: levelText,
      parentAssembly: parentText,
      partNo: rec.itemCode || '(Blank)',
      field: rec.status === 'missing_item_code' ? 'No.' : 'Occurrence Match',
      standardValue: rec.originalValueSummary || '—',
      uploadedValue: rec.bcValueSummary || '—',
      issue: `UNRESOLVED — ${rec.reasonForClassification}`,
    });
  }

  return rows;
}

export function buildBomVerificationPdfBytes(
  report: BomVerificationReport,
  originalFileName: string,
  bcFileName: string
): ArrayBuffer {
  if (report.audit.validationStatus !== 'APPROVED') {
    throw new Error(
      'VALIDATION INCOMPLETE – REPORT NOT APPROVED: PDF report generation is blocked until all three verification stages and count reconciliation pass.'
    );
  }

  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'pt',
    format: 'a4',
  });

  const { summary, audit } = report;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 36;
  const usableWidth = pageWidth - marginX * 2;
  const observations = buildVerificationObservations(report);

  // Page 1: BOM Verification Summary + Separate Category Observations
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(15, 23, 42);
  doc.text('ENGINEERING BOM VERIFICATION REPORT', marginX, 34);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  doc.text(
    '7-Field Hierarchical Occurrence Verification (Standard BOM vs. Uploaded ERP BOM)',
    marginX,
    48
  );

  // Result Banner
  const isClean = summary.verificationResult === 'VERIFIED – No discrepancies.';
  const isUnresolved =
    summary.verificationResult === 'UNRESOLVED – Some records require manual investigation.';

  const bannerFill: [number, number, number] = isClean
    ? [240, 253, 244]
    : isUnresolved
      ? [245, 243, 255]
      : [254, 242, 242];
  const bannerStroke: [number, number, number] = isClean
    ? [22, 163, 74]
    : isUnresolved
      ? [109, 40, 217]
      : [185, 28, 28];
  const bannerText: [number, number, number] = isClean
    ? [21, 128, 61]
    : isUnresolved
      ? [91, 33, 182]
      : [153, 27, 27];

  doc.setFillColor(...bannerFill);
  doc.setDrawColor(...bannerStroke);
  doc.setLineWidth(0.75);
  doc.roundedRect(marginX, 58, usableWidth, 32, 3, 3, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...bannerText);
  doc.text(`Verification Result: ${summary.verificationResult}`, marginX + 10, 72);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.2);
  doc.setTextColor(51, 65, 85);
  doc.text(
    `Final Verification Status: ${summary.overallStatus} (${audit.validationStatus})   |   Verification Percentage: ${summary.verificationPercentage.toFixed(1)}%   (${summary.verificationFormulaText})`,
    marginX + 10,
    84
  );

  // Document Metadata Table
  autoTable(doc, {
    startY: 98,
    head: [['Verification Metadata', 'Details']],
    body: [
      ['Standard BOM Name', originalFileName],
      ['Uploaded BOM Name', bcFileName],
      ['Verification Date & Time', summary.verifiedAt],
      ['Final Verification Status', `${summary.overallStatus} (3-Stage Audit: ${audit.validationStatus})`],
      [
        'Verification Percentage',
        `${summary.verificationPercentage.toFixed(1)}%  [${summary.verificationFormulaText}]`,
      ],
    ],
    theme: 'grid',
    styles: {
      fontSize: 8,
      cellPadding: 3.5,
      textColor: [30, 41, 59],
      lineColor: [226, 232, 240],
      lineWidth: 0.5,
    },
    headStyles: {
      fillColor: [30, 41, 59],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
    },
    columnStyles: {
      0: { cellWidth: 190, fontStyle: 'bold', fillColor: [248, 250, 252] },
    },
    margin: { left: marginX, right: marginX },
  });

  const metaEndY =
    (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? 215;

  const sideStartY = metaEndY + 10;
  const leftTableWidth = 225;
  const colGap = 14;
  const rightTableLeft = marginX + leftTableWidth + colGap;
  const rightTableWidth = usableWidth - leftTableWidth - colGap;

  // Left: Compact Summary Table (Particulars | Count)
  autoTable(doc, {
    startY: sideStartY,
    head: [['Particulars', 'Count']],
    body: [
      ['Standard BOM Occurrences', String(summary.originalCount)],
      ['Uploaded BOM Occurrences', String(summary.bcCount)],
      ['Correctly Matched', String(summary.matchedCount)],
      ['Incorrect', String(summary.incorrectOccurrenceCount)],
      ['Missing', String(summary.missingCount)],
      ['Additional', String(summary.additionalCount)],
      ['Unresolved', String(summary.unresolvedCount)],
      ['Total Field Errors', String(summary.totalFieldErrorsCount)],
    ],
    theme: 'grid',
    styles: {
      fontSize: 8,
      cellPadding: 3.8,
      textColor: [15, 23, 42],
      lineColor: [226, 232, 240],
      lineWidth: 0.5,
    },
    headStyles: {
      fillColor: [51, 65, 85],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
    },
    columnStyles: {
      0: { cellWidth: 165, fontStyle: 'bold' },
      1: { cellWidth: 60, halign: 'right', fontStyle: 'bold' },
    },
    tableWidth: leftTableWidth,
    margin: { left: marginX, right: pageWidth - marginX - leftTableWidth },
  });

  const leftEndY =
    (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? 410;

  // Right: Separate Observations Table (Incorrect, Missing, Additional, Unresolved, Other)
  autoTable(doc, {
    startY: sideStartY,
    head: [['Category', 'Report Observation (Separate Findings)']],
    body: observations.map((obs) => [obs.category, obs.observation]),
    theme: 'grid',
    styles: {
      fontSize: 7.8,
      cellPadding: 4,
      overflow: 'linebreak',
      textColor: [30, 41, 59],
      lineColor: [226, 232, 240],
      lineWidth: 0.5,
      valign: 'top',
    },
    headStyles: {
      fillColor: [30, 41, 59],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
    },
    columnStyles: {
      0: { cellWidth: 78, fontStyle: 'bold', fillColor: [248, 250, 252] },
      1: { cellWidth: rightTableWidth - 78 },
    },
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 0) {
        const cat = observations[data.row.index]?.category;
        if (cat === 'Incorrect') data.cell.styles.textColor = [146, 64, 14];
        else if (cat === 'Missing') data.cell.styles.textColor = [153, 27, 27];
        else if (cat === 'Additional') data.cell.styles.textColor = [55, 48, 163];
        else if (cat === 'Unresolved') data.cell.styles.textColor = [109, 40, 217];
        else data.cell.styles.textColor = [51, 65, 85];
      }
    },
    tableWidth: rightTableWidth,
    margin: { left: rightTableLeft, right: marginX },
  });

  const rightEndY =
    (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? 410;
  const page1TablesEnd = Math.max(leftEndY, rightEndY);

  if (page1TablesEnd < pageHeight - 54) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.8);
    doc.setTextColor(71, 85, 105);
    doc.text(
      'Accuracy Formula: Verification % = Correctly Matched / (Correctly Matched + Incorrect + Missing + Additional + Unresolved) x 100.',
      marginX,
      page1TablesEnd + 14
    );
  }

  // Page 2+: Separate Discrepancy Sections (ONLY categories requiring attention — matched items omitted)
  const allRows = buildPdfDiscrepancyRows(report);
  const incorrectRows = allRows.filter((r) => r.statusTag === 'INCORRECT');
  const missingRows = allRows.filter((r) => r.statusTag === 'MISSING');
  const additionalRows = allRows.filter((r) => r.statusTag === 'ADDITIONAL');
  const unresolvedRows = allRows.filter((r) => r.statusTag === 'UNRESOLVED');

  const rawDiscrepancyGroups: Array<{
    title: string;
    subtitle: string;
    headColor: [number, number, number];
    rows: PdfDiscrepancyRow[];
  }> = [
    {
      title: `Incorrect Items (${summary.incorrectOccurrenceCount} occurrence${summary.incorrectOccurrenceCount === 1 ? '' : 's'} / ${incorrectRows.length} field error${incorrectRows.length === 1 ? '' : 's'})`,
      subtitle: observations.find((o) => o.category === 'Incorrect')?.observation ?? '',
      headColor: [146, 64, 14],
      rows: incorrectRows,
    },
    {
      title: `Missing Items (${missingRows.length})`,
      subtitle: observations.find((o) => o.category === 'Missing')?.observation ?? '',
      headColor: [153, 27, 27],
      rows: missingRows,
    },
    {
      title: `Additional Items (${additionalRows.length})`,
      subtitle: observations.find((o) => o.category === 'Additional')?.observation ?? '',
      headColor: [55, 48, 163],
      rows: additionalRows,
    },
    {
      title: `Unresolved Items (${unresolvedRows.length})`,
      subtitle: observations.find((o) => o.category === 'Unresolved')?.observation ?? '',
      headColor: [109, 40, 217],
      rows: unresolvedRows,
    },
  ];
  const discrepancyGroups = rawDiscrepancyGroups.filter((g) => g.rows.length > 0);

  if (discrepancyGroups.length === 0 && report.issues.length === 0) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(21, 128, 61);
    doc.text(
      'All occurrences match across all 7 verified fields and parent-child hierarchy. No discrepancies to report.',
      marginX,
      Math.min(page1TablesEnd + 32, pageHeight - 40)
    );
  } else {
    doc.addPage();
    let cursorY = 36;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(15, 23, 42);
    doc.text(
      `DISCREPANCY & OBSERVATION DETAILS (${allRows.length} Discrepancy Row${allRows.length === 1 ? '' : 's'})`,
      marginX,
      cursorY
    );
    cursorY += 14;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.2);
    doc.setTextColor(71, 85, 105);
    doc.text(
      `Items requiring engineering attention listed separately by category — correctly matched occurrences (${summary.matchedCount}) are omitted.`,
      marginX,
      cursorY
    );
    cursorY += 16;

    for (const group of discrepancyGroups) {
      if (cursorY > pageHeight - 110) {
        doc.addPage();
        cursorY = 36;
      }

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(...group.headColor);
      doc.text(group.title, marginX, cursorY);
      cursorY += 12;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.8);
      doc.setTextColor(71, 85, 105);
      const wrappedSub = doc.splitTextToSize(group.subtitle, usableWidth) as string[];
      doc.text(wrappedSub, marginX, cursorY);
      cursorY += wrappedSub.length * 10 + 4;

      autoTable(doc, {
        startY: cursorY,
        showHead: 'everyPage',
        head: [
          [
            'Sr.',
            'Level',
            'Parent Assembly',
            'Part No.',
            'Field',
            'Standard Value',
            'Uploaded Value',
            'Observation / Issue',
          ],
        ],
        body: group.rows.map((row, idx) => [
          String(idx + 1),
          row.level,
          row.parentAssembly,
          row.partNo,
          row.field,
          row.standardValue,
          row.uploadedValue,
          row.issue,
        ]),
        theme: 'grid',
        styles: {
          fontSize: 7.3,
          cellPadding: 3.3,
          overflow: 'linebreak',
          textColor: [30, 41, 59],
          lineColor: [226, 232, 240],
          lineWidth: 0.4,
          valign: 'top',
        },
        alternateRowStyles: {
          fillColor: [248, 250, 252],
        },
        headStyles: {
          fillColor: group.headColor,
          textColor: [255, 255, 255],
          fontStyle: 'bold',
          fontSize: 7.5,
        },
        columnStyles: {
          0: { cellWidth: 25, halign: 'right' },
          1: { cellWidth: 36, halign: 'center' },
          2: { cellWidth: 118 },
          3: { cellWidth: 74, fontStyle: 'bold' },
          4: { cellWidth: 64 },
          5: { cellWidth: 108 },
          6: { cellWidth: 108 },
          7: { cellWidth: 'auto' },
        },
        margin: { top: 36, bottom: 36, left: marginX, right: marginX },
      });

      const endY =
        (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ??
        cursorY + 60;
      cursorY = endY + 18;
    }

    // Other Findings – Structural Warnings (only if structural warnings exist)
    if (report.issues.length > 0) {
      if (cursorY > pageHeight - 110) {
        doc.addPage();
        cursorY = 36;
      }

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(51, 65, 85);
      doc.text(`Other Observations – Structural Warnings (${report.issues.length})`, marginX, cursorY);
      cursorY += 12;

      const otherSub = observations.find((o) => o.category === 'Other')?.observation ?? '';
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.8);
      doc.setTextColor(71, 85, 105);
      const wrappedOther = doc.splitTextToSize(otherSub, usableWidth) as string[];
      doc.text(wrappedOther, marginX, cursorY);
      cursorY += wrappedOther.length * 10 + 4;

      autoTable(doc, {
        startY: cursorY,
        showHead: 'everyPage',
        head: [['Sr.', 'Warning Category', 'Source BOM', 'Row', 'Level', 'Parent Assembly', 'Part No.', 'Observation']],
        body: report.issues.map((issue, idx) => [
          String(idx + 1),
          issue.warningCategory,
          issue.source,
          String(issue.rowNumber),
          issue.level,
          issue.parentAssembly,
          issue.itemCode,
          issue.message,
        ]),
        theme: 'grid',
        styles: {
          fontSize: 7.3,
          cellPadding: 3.3,
          overflow: 'linebreak',
          textColor: [30, 41, 59],
          lineColor: [226, 232, 240],
          lineWidth: 0.4,
          valign: 'top',
        },
        alternateRowStyles: {
          fillColor: [248, 250, 252],
        },
        headStyles: {
          fillColor: [51, 65, 85],
          textColor: [255, 255, 255],
          fontStyle: 'bold',
          fontSize: 7.5,
        },
        margin: { top: 36, bottom: 36, left: marginX, right: marginX },
      });
    }
  }

  // Page numbers & generation timestamp footer on every page
  const totalPages = doc.getNumberOfPages();
  for (let pageNum = 1; pageNum <= totalPages; pageNum += 1) {
    doc.setPage(pageNum);
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.5);
    doc.line(marginX, pageHeight - 28, pageWidth - marginX, pageHeight - 28);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text(
      `Engineering BOM Verification System   |   Generated: ${summary.verifiedAt}`,
      marginX,
      pageHeight - 16
    );
    doc.text(`Page ${pageNum} of ${totalPages}`, pageWidth - marginX, pageHeight - 16, {
      align: 'right',
    });
  }

  return doc.output('arraybuffer');
}

export function exportBomVerificationPdf(
  report: BomVerificationReport,
  originalFileName: string,
  bcFileName: string
): void {
  const bytes = buildBomVerificationPdfBytes(report, originalFileName, bcFileName);
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'BOM_Verification_Report.pdf';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
