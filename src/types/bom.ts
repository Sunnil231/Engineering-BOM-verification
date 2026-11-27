export type ExcelContainerFormat = 'xls' | 'xlsx';

export type BomReportFormat = 'navigation' | 'business_central';

export interface ColumnMapping {
  level: string;
  itemCode: string;
  description: string;
  itemType: string;
  uom: string;
  bomQty: string;
  totalBomQty: string;
}

export interface ParsedSheetData {
  name: string;
  headers: string[];
  headerRowIndex: number;
  rows: Record<string, unknown>[];
  rawRowCount: number;
  blankRowsSkipped: number;
  continuationRowsMerged: number;
  ignoredCostColumns: string[];
  detectedMapping: ColumnMapping;
}

export interface LoadedExcelWorkbook {
  reportFormat: BomReportFormat;
  fileName: string;
  fileSize: number;
  detectedFormat: ExcelContainerFormat;
  formatLabel: string;
  sheetNames: string[];
  sheets: Record<string, ParsedSheetData>;
  selectedSheet: string;
  loadedAt: string;
  formatNotes: string[];
}

export type ValidationSeverity = 'warning';

export type ValidationCode =
  | 'MISSING_ITEM_CODE'
  | 'INVALID_QUANTITY'
  | 'HIERARCHY_JUMP'
  | 'CIRCULAR_REFERENCE';

export interface BomValidationIssue {
  id: string;
  source: 'Original Navigation' | 'Business Central';
  severity: ValidationSeverity;
  code: ValidationCode;
  warningCategory: string;
  rowNumber: number;
  level: string;
  parentAssembly: string;
  itemCode: string;
  description: string;
  hierarchyPath: string;
  message: string;
}

export interface BomNode {
  id: string;
  rowNumber: number;
  continuationRows: number[];
  level: number;
  rawLevel: string;
  itemCode: string;
  description: string;
  rawDescription: string;
  itemType: string;
  uom: string;
  bomQty: number | null;
  rawBomQty: string;
  totalBomQty: number | null;
  rawTotalBomQty: string;
  bomQtyValid: boolean;
  totalBomQtyValid: boolean;
  hasHierarchyUncertainty: boolean;
  isParentAssembly: boolean;
  parentId: string | null;
  parentItemCode: string | null;
  ancestorChain: string[];
  parentPath: string;
  hierarchyPath: string;
  children: BomNode[];
}

export interface ParsedBomTree {
  roots: BomNode[];
  flatNodes: BomNode[];
  issues: BomValidationIssue[];
  maxDepth: number;
}

export type DiffStatus =
  | 'matched'
  | 'incorrect'
  | 'description_review'
  | 'missing_item_code'
  | 'manual_review'
  | 'missing'
  | 'additional';

export type ErrorFieldName =
  | 'Level'
  | 'No.'
  | 'Parent Assembly'
  | 'Description'
  | 'Item Type'
  | 'UOM'
  | 'BOM Qty.'
  | 'Total BOM Qty';

export interface FieldChange {
  field: ErrorFieldName;
  category: string;
  before: string;
  after: string;
  numericDiff?: number | null;
  explanation: string;
}

export interface BomVerificationRecord {
  key: string;
  status: DiffStatus;
  discrepancyCategory: string;
  errorCategory: string;
  componentRole: 'Parent Assembly' | 'Child Component';
  sourceSide?: 'Original Navigation' | 'Business Central';
  originalRowNumber: number | null;
  bcRowNumber: number | null;
  level: number;
  rawLevel: string;
  originalLevel: string;
  bcLevel: string;
  itemCode: string;
  description: string;
  originalDescription: string;
  bcDescription: string;
  itemType: string;
  uom: string;
  parentAssemblyCode: string;
  originalParentAssembly: string;
  bcParentAssembly: string;
  parentPath: string;
  hierarchyPath: string;
  originalNode: BomNode | null;
  bcNode: BomNode | null;
  originalBomQty: number | null;
  bcBomQty: number | null;
  bomQtyDiff: number | null;
  originalTotalQty: number | null;
  bcTotalQty: number | null;
  totalQtyDiff: number | null;
  originalValueSummary: string;
  bcValueSummary: string;
  changes: FieldChange[];
  reasonForClassification: string;
  detailedExplanation: string;
}

export interface StageAuditCheck {
  stage: 'Stage 1: Initial Comparison' | 'Stage 2: Cross-Verification' | 'Stage 3: Final Audit';
  checkName: string;
  passed: boolean;
  details: string;
}

export interface ValidationAuditReport {
  validationStatus: 'APPROVED' | 'NOT_APPROVED';
  statusBannerText: string;
  stage1DurationMs: number;
  stage2AdjustmentsCount: number;
  stage2AdjustmentNotes: string[];
  originalOccurrencesAccounted: number;
  bcOccurrencesAccounted: number;
  reconciliationPassed: boolean;
  checks: StageAuditCheck[];
  failureReasons: string[];
}

export type VerificationResultLabel =
  | 'VERIFIED – No discrepancies.'
  | 'VERIFIED WITH ERRORS – Discrepancies identified.'
  | 'UNRESOLVED – Some records require manual investigation.'
  | 'VERIFICATION FAILED – Reliable comparison could not be completed.';

export interface VerificationSummary {
  verifiedAt: string;
  validationStatus: 'APPROVED' | 'NOT_APPROVED';
  overallStatus: 'PASS' | 'FAIL' | 'VALIDATION INCOMPLETE – REPORT NOT APPROVED';
  verificationResult: VerificationResultLabel;
  verificationPercentage: number;
  verificationFormulaText: string;
  originalCount: number;
  bcCount: number;
  matchedCount: number;
  incorrectOccurrenceCount: number;
  matchedWithFieldErrorsTotal: number;
  descriptionReviewCount: number;
  recordsWithErrorsCount: number;
  missingCount: number;
  missingParentCount: number;
  missingChildCount: number;
  additionalCount: number;
  additionalParentCount: number;
  additionalChildCount: number;
  unresolvedCount: number;
  unresolvedOriginalCount: number;
  unresolvedBcCount: number;
  manualReviewCount: number;
  manualReviewOriginalCount: number;
  manualReviewBcCount: number;
  missingItemCodeCount: number;
  missingItemCodeOriginalCount: number;
  missingItemCodeBcCount: number;
  totalFieldErrorsCount: number;
  incorrectLevelCount: number;
  incorrectHierarchyCount: number;
  incorrectDescriptionCount: number;
  incorrectItemTypeCount: number;
  purchaseVsProdOrderCount: number;
  incorrectUomCount: number;
  incorrectBomQtyCount: number;
  incorrectTotalBomQtyCount: number;
  supplementaryWarningCount: number;
}

export interface BomVerificationReport {
  originalTree: ParsedBomTree;
  bcTree: ParsedBomTree;
  allRecords: BomVerificationRecord[];
  matchedRecords: BomVerificationRecord[];
  incorrectRecords: BomVerificationRecord[];
  descriptionReviewRecords: BomVerificationRecord[];
  manualReviewRecords: BomVerificationRecord[];
  missingItemCodeRecords: BomVerificationRecord[];
  missingRecords: BomVerificationRecord[];
  additionalRecords: BomVerificationRecord[];
  issues: BomValidationIssue[];
  audit: ValidationAuditReport;
  summary: VerificationSummary;
}
