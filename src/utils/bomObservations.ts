import type { BomVerificationReport } from '../types/bom';

export interface CategoryObservation {
  category: 'Incorrect' | 'Missing' | 'Additional' | 'Unresolved' | 'Other';
  title: string;
  countLabel: string;
  observation: string;
}

function formatPartSample(codes: string[], limit = 4): string {
  const unique = Array.from(new Set(codes.filter(Boolean)));
  if (unique.length === 0) return '';
  const shown = unique.slice(0, limit).join(', ');
  return unique.length > limit ? `${shown} (+${unique.length - limit} more)` : shown;
}

export function buildVerificationObservations(
  report: BomVerificationReport
): CategoryObservation[] {
  const { summary, audit } = report;

  // 1. Incorrect Observation
  let incorrectObs =
    'No incorrect field values or parent-child hierarchy mismatches observed; all matched items agree across all 7 verified fields.';
  if (summary.incorrectOccurrenceCount > 0) {
    const fieldBreakdown: string[] = [];
    if (summary.incorrectLevelCount > 0) fieldBreakdown.push(`Level (${summary.incorrectLevelCount})`);
    if (summary.incorrectHierarchyCount > 0) {
      fieldBreakdown.push(`Parent/Hierarchy (${summary.incorrectHierarchyCount})`);
    }
    if (summary.incorrectDescriptionCount > 0) {
      fieldBreakdown.push(`Description (${summary.incorrectDescriptionCount})`);
    }
    if (summary.incorrectItemTypeCount > 0) {
      fieldBreakdown.push(
        summary.purchaseVsProdOrderCount > 0
          ? `Item Type (${summary.incorrectItemTypeCount}, incl. ${summary.purchaseVsProdOrderCount} Purchase vs Prod. Order)`
          : `Item Type (${summary.incorrectItemTypeCount})`
      );
    }
    if (summary.incorrectUomCount > 0) fieldBreakdown.push(`UOM (${summary.incorrectUomCount})`);
    if (summary.incorrectBomQtyCount > 0) {
      fieldBreakdown.push(`BOM Qty. (${summary.incorrectBomQtyCount})`);
    }
    if (summary.incorrectTotalBomQtyCount > 0) {
      fieldBreakdown.push(`Total BOM Qty (${summary.incorrectTotalBomQtyCount})`);
    }

    const combinedIncorrect = [...report.incorrectRecords, ...report.descriptionReviewRecords];
    const sample = formatPartSample(combinedIncorrect.map((r) => r.itemCode));
    const breakdownText =
      fieldBreakdown.length > 0 ? ` Affected fields: ${fieldBreakdown.join(', ')}.` : '';
    const sampleText = sample ? ` Sample Part No.: ${sample}.` : '';

    incorrectObs = `${summary.incorrectOccurrenceCount} paired component occurrence(s) contain ${summary.totalFieldErrorsCount} field/hierarchy error(s).${breakdownText}${sampleText}`;
  }

  // 2. Missing Observation
  let missingObs =
    'No missing components observed; every valid Standard BOM occurrence was accounted for in the Uploaded BOM.';
  if (summary.missingCount > 0) {
    const sample = formatPartSample(report.missingRecords.map((r) => r.itemCode));
    missingObs = `${summary.missingCount} occurrence(s) present in the Standard BOM (${summary.missingParentCount} Parent Assembly, ${summary.missingChildCount} Child Component) were not found in the Uploaded BOM.${sample ? ` Missing Part No.: ${sample}.` : ''}`;
  }

  // 3. Additional Observation
  let additionalObs =
    'No additional components observed; the Uploaded BOM does not contain extra unmapped items.';
  if (summary.additionalCount > 0) {
    const sample = formatPartSample(report.additionalRecords.map((r) => r.itemCode));
    additionalObs = `${summary.additionalCount} extra occurrence(s) present in the Uploaded BOM (${summary.additionalParentCount} Parent Assembly, ${summary.additionalChildCount} Child Component) do not exist in the Standard BOM.${sample ? ` Additional Part No.: ${sample}.` : ''}`;
  }

  // 4. Unresolved Observation
  let unresolvedObs =
    'No unresolved records observed; zero blank Part No. rows and zero ambiguous occurrence ties require manual investigation.';
  if (summary.unresolvedCount > 0) {
    const parts: string[] = [];
    if (summary.missingItemCodeCount > 0) {
      parts.push(`${summary.missingItemCodeCount} blank Part No. row(s)`);
    }
    if (summary.manualReviewCount > 0) {
      parts.push(`${summary.manualReviewCount} ambiguous competing match(es)`);
    }
    unresolvedObs = `${summary.unresolvedCount} record(s) require manual engineering investigation (${parts.join(', ')} — Std: ${summary.unresolvedOriginalCount}, Upl: ${summary.unresolvedBcCount}).`;
  }

  // 5. Other Observation (Structural Warnings, Pass 2 Adjustments, Audit Reconciliation)
  const otherParts: string[] = [];
  if (report.issues.length > 0) {
    const countsByCategory = new Map<string, number>();
    for (const issue of report.issues) {
      countsByCategory.set(
        issue.warningCategory,
        (countsByCategory.get(issue.warningCategory) ?? 0) + 1
      );
    }
    const warningSummary = Array.from(countsByCategory.entries())
      .map(([cat, count]) => `${cat} (${count})`)
      .join(', ');
    otherParts.push(`${report.issues.length} structural warning(s): ${warningSummary}.`);
  } else {
    otherParts.push('Zero structural warnings (no circular references, invalid quantities, or level jumps).');
  }

  if (audit.stage2AdjustmentsCount > 0) {
    otherParts.push(
      `Pass 2 independent verification applied ${audit.stage2AdjustmentsCount} occurrence/structure correction(s).`
    );
  }

  otherParts.push(
    `Pass 3 reconciliation: ${audit.validationStatus} (Std ${audit.originalOccurrencesAccounted}/${summary.originalCount}, Upl ${audit.bcOccurrencesAccounted}/${summary.bcCount}); cost columns and Sr. No. ignored.`
  );

  return [
    {
      category: 'Incorrect',
      title: '1. Incorrect Items',
      countLabel: `${summary.incorrectOccurrenceCount} items (${summary.totalFieldErrorsCount} errors)`,
      observation: incorrectObs,
    },
    {
      category: 'Missing',
      title: '2. Missing Items',
      countLabel: `${summary.missingCount} items`,
      observation: missingObs,
    },
    {
      category: 'Additional',
      title: '3. Additional Items',
      countLabel: `${summary.additionalCount} items`,
      observation: additionalObs,
    },
    {
      category: 'Unresolved',
      title: '4. Unresolved Items',
      countLabel: `${summary.unresolvedCount} items`,
      observation: unresolvedObs,
    },
    {
      category: 'Other',
      title: '5. Other Observations (Structural & Audit)',
      countLabel: `${report.issues.length} warnings`,
      observation: otherParts.join(' '),
    },
  ];
}
