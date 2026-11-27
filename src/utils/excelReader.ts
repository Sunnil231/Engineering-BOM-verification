import * as XLSX from 'xlsx';
import type {
  BomReportFormat,
  ColumnMapping,
  ExcelContainerFormat,
  LoadedExcelWorkbook,
  ParsedSheetData,
} from '../types/bom';

export const FILE_INPUT_ACCEPT =
  '.xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const COST_COLUMN_PATTERNS: RegExp[] = [
  /cost/i,
  /\bamt\b/i,
  /amount/i,
  /currency/i,
  /\bcurr\b/i,
  /\brate\b/i,
  /\bprice\b/i,
  /\bvalue\b/i,
  /\bstd\.?\s*(cost|amt|amount|price|val|value)/i,
  /item\s*std/i,
];

const IGNORED_SERIAL_PATTERNS: RegExp[] = [
  /^sr\.?\s*no\.?$/i,
  /^s\.?\s*no\.?$/i,
  /^serial\s*(no\.?|number)?$/i,
  /^line\s*no\.?$/i,
  /^row\s*no\.?$/i,
  /^seq\.?$/i,
];

const NAV_HEADER_PATTERNS: Record<keyof ColumnMapping, RegExp[]> = {
  level: [
    /^level$/i,
    /^bom[\s_-]*level$/i,
    /^lvl$/i,
    /^low[\s_-]*level[\s_-]*code$/i,
    /^depth$/i,
  ],
  itemCode: [
    /^no\.?$/i,
    /^item[\s_-]*no\.?$/i,
    /^item[\s_-]*code$/i,
    /^item[\s_-]*number$/i,
    /^part[\s_-]*(no\.?|num|number|#)$/i,
    /^component[\s_-]*(no\.?|code|item\s*no\.?)?$/i,
    /^material[\s_-]*(no\.?|code)?$/i,
    /^(?!.*parent).*item[\s_-]*no/i,
    /^item$/i,
  ],
  description: [
    /^description$/i,
    /^item[\s_-]*description$/i,
    /^part[\s_-]*desc(ription)?$/i,
    /^desc\.?$/i,
  ],
  itemType: [
    /^item[\s_-]*type$/i,
    /^type$/i,
    /^bom[\s_-]*type$/i,
    /^replenishment[\s_-]*system$/i,
  ],
  uom: [
    /^uom$/i,
    /^unit[\s_-]*of[\s_-]*measure(\s*code)?$/i,
    /^unit$/i,
    /^base[\s_-]*uom$/i,
  ],
  bomQty: [
    /^bom[\s_-]*qty\.?$/i,
    /^quantity[\s_-]*per$/i,
    /^qty\.?[\s_-]*per(\s*parent)?$/i,
    /^bom[\s_-]*quantity$/i,
    /^net[\s_-]*qty\.?$/i,
    /^qty\.?$/i,
    /^quantity$/i,
  ],
  totalBomQty: [
    /^total[\s_-]*bom[\s_-]*qty\.?$/i,
    /^total[\s_-]*bom[\s_-]*quantity$/i,
    /^total[\s_-]*qty\.?$/i,
    /^total[\s_-]*quantity$/i,
    /^extended[\s_-]*qty\.?$/i,
    /^ext\.?[\s_-]*qty\.?$/i,
    /^required[\s_-]*qty\.?$/i,
  ],
};

const BC_HEADER_PATTERNS: Record<keyof ColumnMapping, RegExp[]> = {
  level: [
    /^level$/i,
    /^bom[\s_-]*level$/i,
    /^indentation$/i,
    /^lvl$/i,
    /^depth$/i,
  ],
  itemCode: [
    /^no\.?$/i,
    /^item[\s_-]*no\.?$/i,
    /^item[\s_-]*code$/i,
    /^item[\s_-]*number$/i,
    /^component[\s_-]*no\.?$/i,
    /^part[\s_-]*(no\.?|number)$/i,
    /^(?!.*parent).*item[\s_-]*no/i,
    /^item$/i,
  ],
  description: [
    /^description$/i,
    /^item[\s_-]*description$/i,
    /^desc\.?$/i,
  ],
  itemType: [
    /^item[\s_-]*type$/i,
    /^type$/i,
    /^replenishment[\s_-]*system$/i,
    /^line[\s_-]*type$/i,
  ],
  uom: [
    /^uom$/i,
    /^unit[\s_-]*of[\s_-]*measure[\s_-]*code$/i,
    /^unit[\s_-]*of[\s_-]*measure$/i,
    /^unit$/i,
  ],
  bomQty: [
    /^bom[\s_-]*qty\.?$/i,
    /^quantity[\s_-]*per$/i,
    /^qty\.?[\s_-]*per(\s*parent)?$/i,
    /^bom[\s_-]*quantity$/i,
    /^net[\s_-]*qty\.?$/i,
    /^qty\.?$/i,
    /^quantity$/i,
  ],
  totalBomQty: [
    /^total[\s_-]*bom[\s_-]*qty\.?$/i,
    /^total[\s_-]*qty\.?$/i,
    /^total[\s_-]*quantity$/i,
    /^total[\s_-]*bom[\s_-]*quantity$/i,
    /^extended[\s_-]*quantity$/i,
    /^required[\s_-]*qty\.?$/i,
  ],
};

function hasAllowedExtension(fileName: string): boolean {
  const lower = fileName.trim().toLowerCase();
  return lower.endsWith('.xls') || lower.endsWith('.xlsx');
}

export function detectExcelContainerFormat(
  bytes: Uint8Array,
  fileName: string
): ExcelContainerFormat | null {
  if (bytes.length >= 8) {
    const isOle2 =
      bytes[0] === 0xd0 &&
      bytes[1] === 0xcf &&
      bytes[2] === 0x11 &&
      bytes[3] === 0xe0 &&
      bytes[4] === 0xa1 &&
      bytes[5] === 0xb1 &&
      bytes[6] === 0x1a &&
      bytes[7] === 0xe1;
    if (isOle2) return 'xls';
  }

  if (bytes.length >= 4) {
    const isZip =
      bytes[0] === 0x50 &&
      bytes[1] === 0x4b &&
      ((bytes[2] === 0x03 && bytes[3] === 0x04) ||
        (bytes[2] === 0x05 && bytes[3] === 0x06) ||
        (bytes[2] === 0x07 && bytes[3] === 0x08));
    if (isZip) return 'xlsx';

    const isLegacyBiff =
      (bytes[0] === 0x09 && bytes[1] === 0x08) ||
      (bytes[0] === 0x09 && bytes[1] === 0x04) ||
      (bytes[0] === 0x09 && bytes[1] === 0x02) ||
      (bytes[0] === 0x09 && bytes[1] === 0x00);
    if (isLegacyBiff) return 'xls';
  }

  if (bytes.length >= 16) {
    const snippet = new TextDecoder('utf-8', { fatal: false })
      .decode(bytes.subarray(0, Math.min(512, bytes.length)))
      .trimStart()
      .toLowerCase();
    if (
      (snippet.startsWith('<?xml') || snippet.startsWith('<workbook')) &&
      (snippet.includes('schemas-microsoft-com:office:spreadsheet') ||
        snippet.includes('progid="excel.sheet"'))
    ) {
      return 'xls';
    }
  }

  const lower = fileName.trim().toLowerCase();
  if (lower.endsWith('.xls')) return 'xls';
  if (lower.endsWith('.xlsx')) return 'xlsx';
  return null;
}

function isCostOrIgnoredColumn(header: string): boolean {
  const trimmed = header.trim();
  if (!trimmed) return false;
  if (IGNORED_SERIAL_PATTERNS.some((p) => p.test(trimmed))) return false;
  return COST_COLUMN_PATTERNS.some((p) => p.test(trimmed));
}

export function detectColumnsForFormat(
  headers: string[],
  reportFormat: BomReportFormat
): ColumnMapping {
  const patterns = reportFormat === 'navigation' ? NAV_HEADER_PATTERNS : BC_HEADER_PATTERNS;

  const findMatch = (list: RegExp[], exclude: Set<string> = new Set()): string => {
    for (const pat of list) {
      const match = headers.find((h) => {
        if (exclude.has(h)) return false;
        const trimmed = h.trim();
        if (!trimmed) return false;
        if (IGNORED_SERIAL_PATTERNS.some((s) => s.test(trimmed))) return false;
        if (isCostOrIgnoredColumn(trimmed)) return false;
        return pat.test(trimmed);
      });
      if (match) return match;
    }
    return '';
  };

  const level = findMatch(patterns.level);
  const itemCode = findMatch(patterns.itemCode);
  const description = findMatch(patterns.description);
  const itemType = findMatch(patterns.itemType);
  const uom = findMatch(patterns.uom);
  const totalBomQty = findMatch(patterns.totalBomQty);
  const bomQty = findMatch(
    patterns.bomQty,
    totalBomQty ? new Set([totalBomQty]) : new Set()
  );

  return {
    level,
    itemCode,
    description,
    itemType,
    uom,
    bomQty,
    totalBomQty,
  };
}

function sanitizeHeaderName(raw: unknown, colIndex: number, used: Set<string>): string {
  const base = String(raw ?? '').trim().replace(/\s+/g, ' ') || `Column ${colIndex + 1}`;
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${base} (${suffix})`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

function findBomHeaderRow(
  matrix: unknown[][],
  reportFormat: BomReportFormat
): { headerRowIndex: number; mergedHeaderRow: unknown[]; hasSecondHeaderLine: boolean } {
  const scanLimit = Math.min(matrix.length, 45);
  const exactHeaders = new Set(
    reportFormat === 'navigation'
      ? ['level', 'no.', 'no', 'item no.', 'description', 'item type', 'type', 'uom', 'unit of measure', 'bom qty.', 'bom qty', 'total bom qty', 'total bom qty.', 'quantity per', 'total quantity']
      : ['level', 'bom level', 'no.', 'item no.', 'description', 'item type', 'type', 'uom', 'unit of measure code', 'bom qty.', 'bom qty', 'total bom qty', 'total bom qty.', 'quantity per', 'total qty']
  );

  let bestIndex = -1;
  let bestScore = -1;

  for (let r = 0; r < scanLimit; r += 1) {
    const row = matrix[r] ?? [];
    const nonEmptyCells = row
      .map((c) => String(c ?? '').replace(/\u00a0/g, ' ').trim().replace(/\s+/g, ' '))
      .filter((t) => t.length > 0);
    if (nonEmptyCells.length < 3) continue;

    let exactHits = 0;
    let partialHits = 0;
    let numericCells = 0;
    let colonBannerCells = 0;

    for (const text of nonEmptyCells) {
      const lower = text.toLowerCase();
      if (/^\d+(\.\d+)?$/.test(lower)) {
        numericCells += 1;
        continue;
      }
      if (lower.includes(':') && lower.length > 14) {
        colonBannerCells += 1;
      }
      if (exactHeaders.has(lower)) {
        exactHits += 1;
      } else if (Array.from(exactHeaders).some((kw) => lower.includes(kw))) {
        partialHits += 1;
      }
    }

    const score =
      exactHits * 25 +
      partialHits * 8 -
      numericCells * 12 -
      colonBannerCells * 15 +
      Math.min(nonEmptyCells.length, 10);

    if ((exactHits >= 2 || exactHits + partialHits >= 3) && score > bestScore) {
      bestScore = score;
      bestIndex = r;
    }
  }

  if (bestIndex === -1) {
    const fallbackIdx = matrix.findIndex(
      (r) => (r ?? []).filter((c) => String(c ?? '').trim() !== '').length >= 2
    );
    bestIndex = fallbackIdx === -1 ? 0 : fallbackIdx;
  }

  const primaryRow = matrix[bestIndex] ?? [];
  const nextRow = matrix[bestIndex + 1] ?? [];

  let hasSecondHeaderLine = false;
  if (bestIndex + 1 < matrix.length) {
    const nextTexts = nextRow
      .map((c) => String(c ?? '').replace(/[\u00a0\u200b-\u200d\ufeff]/g, ' ').trim())
      .filter(Boolean);
    const nextHasNumbers = nextTexts.some((t) => /^\d+(\.\d+)?$/.test(t));
    const headerTokenRe = /^(qty\.?|quantity|code|type|amt|amount|cost|no\.?|uom|level|per|bom|description)$/i;
    const continuationHits = nextTexts.filter((t) => headerTokenRe.test(t)).length;
    const allShort = nextTexts.every((t) => t.length <= 22);
    const nextLooksLikeHeaderContinuation =
      nextTexts.length > 0 &&
      !nextHasNumbers &&
      allShort &&
      continuationHits >= 2 &&
      continuationHits >= Math.ceil(nextTexts.length / 2);
    if (nextLooksLikeHeaderContinuation) {
      hasSecondHeaderLine = true;
    }
  }

  const maxLen = Math.max(primaryRow.length, hasSecondHeaderLine ? nextRow.length : 0);
  const mergedHeaderRow: unknown[] = [];
  for (let c = 0; c < maxLen; c += 1) {
    const top = String(primaryRow[c] ?? '').replace(/\u00a0/g, ' ').trim().replace(/\s+/g, ' ');
    const sub = hasSecondHeaderLine
      ? String(nextRow[c] ?? '').replace(/\u00a0/g, ' ').trim().replace(/\s+/g, ' ')
      : '';
    mergedHeaderRow.push([top, sub].filter(Boolean).join(' '));
  }

  return { headerRowIndex: bestIndex, mergedHeaderRow, hasSecondHeaderLine };
}

function isFooterOrTotalRow(rowValues: string[], descText: string): boolean {
  const lowerDesc = descText.trim().toLowerCase();
  if (
    lowerDesc.startsWith('total') ||
    lowerDesc.startsWith('grand total') ||
    lowerDesc.startsWith('sub total') ||
    lowerDesc.startsWith('subtotal') ||
    lowerDesc.startsWith('note:') ||
    lowerDesc.startsWith('notes:') ||
    lowerDesc.startsWith('filter:') ||
    lowerDesc.startsWith('filters:') ||
    lowerDesc.startsWith('printed ') ||
    /^page\s+\d+/i.test(lowerDesc) ||
    /^[-_=]{3,}$/.test(lowerDesc)
  ) {
    return true;
  }
  const joined = rowValues.join(' ').trim().toLowerCase();
  if (/^page\s+\d+\s+of\s+\d+/i.test(joined)) return true;
  return false;
}

function parseWorksheetForReport(
  sheetName: string,
  worksheet: XLSX.WorkSheet,
  reportFormat: BomReportFormat
): ParsedSheetData {
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
    header: 1,
    defval: '',
    raw: true,
    blankrows: true,
  });

  if (matrix.length === 0) {
    return {
      name: sheetName,
      headers: [],
      headerRowIndex: 0,
      rows: [],
      rawRowCount: 0,
      blankRowsSkipped: 0,
      continuationRowsMerged: 0,
      ignoredCostColumns: [],
      detectedMapping: {
        level: '',
        itemCode: '',
        description: '',
        itemType: '',
        uom: '',
        bomQty: '',
        totalBomQty: '',
      },
    };
  }

  const { headerRowIndex, mergedHeaderRow, hasSecondHeaderLine } = findBomHeaderRow(
    matrix,
    reportFormat
  );
  const dataStartIndex = headerRowIndex + (hasSecondHeaderLine ? 2 : 1);

  const maxCols = matrix
    .slice(headerRowIndex)
    .reduce((max, r) => Math.max(max, (r ?? []).length), mergedHeaderRow.length);

  const usedHeaders = new Set<string>();
  const rawHeaders: string[] = [];
  for (let c = 0; c < maxCols; c += 1) {
    rawHeaders.push(sanitizeHeaderName(mergedHeaderRow[c], c, usedHeaders));
  }

  // Trim trailing completely empty columns
  let effectiveCols = rawHeaders.length;
  while (effectiveCols > 0) {
    const colIdx = effectiveCols - 1;
    const headerText = String(mergedHeaderRow[colIdx] ?? '').trim();
    const hasData = matrix
      .slice(dataStartIndex)
      .some((r) => String((r ?? [])[colIdx] ?? '').trim() !== '');
    if (!headerText && !hasData) {
      effectiveCols -= 1;
    } else {
      break;
    }
  }

  const headers = rawHeaders.slice(0, effectiveCols);
  const ignoredCostColumns = headers.filter((h) => isCostOrIgnoredColumn(h));
  const detectedMapping = detectColumnsForFormat(headers, reportFormat);

  const colIndexOf = (name: string) => (name ? headers.indexOf(name) : -1);
  const levelIdx = colIndexOf(detectedMapping.level);
  const itemIdx = colIndexOf(detectedMapping.itemCode);
  const descIdx = colIndexOf(detectedMapping.description);
  const typeIdx = colIndexOf(detectedMapping.itemType);
  const uomIdx = colIndexOf(detectedMapping.uom);
  const bomQtyIdx = colIndexOf(detectedMapping.bomQty);
  const totalQtyIdx = colIndexOf(detectedMapping.totalBomQty);

  const rows: Record<string, unknown>[] = [];
  let blankRowsSkipped = 0;
  let continuationRowsMerged = 0;
  let previousWasBlankOrSkipped = false;

  const cleanCellText = (val: unknown): string =>
    String(val ?? '')
      .replace(/[\u200b-\u200d\ufeff]/g, '')
      .replace(/\u00a0/g, ' ')
      .trim();

  for (let r = dataStartIndex; r < matrix.length; r += 1) {
    const rowArr = matrix[r] ?? [];
    const cellStrings = headers.map((_, idx) => cleanCellText(rowArr[idx]));

    // 1. Completely blank row check
    const hasAnyValue = cellStrings.some((s) => s !== '');
    if (!hasAnyValue) {
      blankRowsSkipped += 1;
      previousWasBlankOrSkipped = true;
      continue;
    }

    const levelVal = levelIdx >= 0 ? cleanCellText(rowArr[levelIdx]) : '';
    let itemVal = itemIdx >= 0 ? cleanCellText(rowArr[itemIdx]) : '';
    // Preserve zero-padded numeric formatting on Item Code if cell had leading-zero format (e.g. "00000000000")
    if (itemIdx >= 0 && typeof rowArr[itemIdx] === 'number') {
      const addr = XLSX.utils.encode_cell({ r, c: itemIdx });
      const cell = worksheet[addr] as XLSX.CellObject | undefined;
      if (
        cell?.w &&
        cell.z &&
        /^0+$/.test(String(cell.z).trim()) &&
        /^0+\d+$/.test(cell.w.trim())
      ) {
        itemVal = cell.w.trim();
      }
    }
    const descVal = descIdx >= 0 ? cleanCellText(rowArr[descIdx]) : '';
    const typeVal = typeIdx >= 0 ? cleanCellText(rowArr[typeIdx]) : '';
    const uomVal = uomIdx >= 0 ? cleanCellText(rowArr[uomIdx]) : '';
    const bomQtyVal = bomQtyIdx >= 0 ? cleanCellText(rowArr[bomQtyIdx]) : '';
    const totalQtyVal = totalQtyIdx >= 0 ? cleanCellText(rowArr[totalQtyIdx]) : '';

    // 1B. Skip repeated header rows inserted by multi-page ERP Excel exports
    const isRepeatedHeaderRow =
      detectedMapping.itemCode !== '' &&
      itemVal.toLowerCase() === detectedMapping.itemCode.toLowerCase() &&
      ((detectedMapping.level !== '' &&
        levelVal.toLowerCase() === detectedMapping.level.toLowerCase()) ||
        (detectedMapping.description !== '' &&
          descVal.toLowerCase() === detectedMapping.description.toLowerCase()));
    if (isRepeatedHeaderRow) {
      blankRowsSkipped += 1;
      previousWasBlankOrSkipped = true;
      continue;
    }

    // Exclude parser-generated blank root-level / formatting-only / cost-only / serial-only rows
    const hasSubstance = [itemVal, descVal, typeVal, uomVal, bomQtyVal, totalQtyVal].some(
      (v) => v !== ''
    );
    if (!hasSubstance) {
      blankRowsSkipped += 1;
      previousWasBlankOrSkipped = true;
      continue;
    }

    const coreNonDescValues = [levelVal, itemVal, typeVal, uomVal, bomQtyVal, totalQtyVal];
    const hasCoreNonDesc = coreNonDescValues.some((v) => v !== '');

    // 2. Skip report footer / total / note / filter / page marker rows
    if (!itemVal && !bomQtyVal && !totalQtyVal && isFooterOrTotalRow(cellStrings, descVal)) {
      blankRowsSkipped += 1;
      previousWasBlankOrSkipped = true;
      continue;
    }

    // 3. Description continuation row:
    // Must immediately follow a valid component row (no blank row separating them),
    // and only Description has text while Level, No., Item Type, UOM, BOM Qty., Total BOM Qty are empty.
    if (
      !hasCoreNonDesc &&
      descVal &&
      rows.length > 0 &&
      !previousWasBlankOrSkipped &&
      detectedMapping.description
    ) {
      const prevRow = rows[rows.length - 1];
      const prevDesc = cleanCellText(prevRow[detectedMapping.description]);
      prevRow[detectedMapping.description] = [prevDesc, descVal].filter(Boolean).join(' ');
      const prevCont = Array.isArray(prevRow.__continuationRows)
        ? (prevRow.__continuationRows as number[])
        : [];
      prevRow.__continuationRows = [...prevCont, r + 1];
      continuationRowsMerged += 1;
      continue;
    }

    // 4. Skip isolated banner/note text when no core BOM fields exist after a blank gap or before any component
    if (!hasCoreNonDesc && descVal && (rows.length === 0 || previousWasBlankOrSkipped)) {
      blankRowsSkipped += 1;
      previousWasBlankOrSkipped = true;
      continue;
    }

    previousWasBlankOrSkipped = false;

    const record: Record<string, unknown> = {
      __rowNumber: r + 1,
      __continuationRows: [],
    };

    for (let c = 0; c < headers.length; c += 1) {
      const header = headers[c];
      if (isCostOrIgnoredColumn(header)) continue;
      if (c === itemIdx && itemVal) {
        record[header] = itemVal;
        continue;
      }
      const value = rowArr[c];
      if (typeof value === 'string') {
        record[header] = value.replace(/[\u200b-\u200d\ufeff]/g, '').replace(/\u00a0/g, ' ');
      } else {
        record[header] = value === undefined || value === null ? '' : value;
      }
    }

    rows.push(record);
  }

  return {
    name: sheetName,
    headers: headers.filter((h) => !isCostOrIgnoredColumn(h)),
    headerRowIndex,
    rows,
    rawRowCount: rows.length,
    blankRowsSkipped,
    continuationRowsMerged,
    ignoredCostColumns,
    detectedMapping,
  };
}

function detectBannerFormatMismatch(
  worksheet: XLSX.WorkSheet,
  headerRowIndex: number,
  expectedFormat: BomReportFormat
): void {
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
    header: 1,
    defval: '',
    raw: true,
  });
  const topRowsText = matrix
    .slice(0, Math.max(headerRowIndex + 1, 8))
    .flat()
    .map((c) => String(c ?? '').trim().toLowerCase())
    .join(' ');

  const mentionsBc =
    topRowsText.includes('business central') || topRowsText.includes('dynamics 365');
  const mentionsNav =
    topRowsText.includes('dynamics nav') ||
    topRowsText.includes('navision') ||
    topRowsText.includes('original navigation bom');

  if (expectedFormat === 'navigation' && mentionsBc && !mentionsNav) {
    throw new Error(
      'Wrong report format uploaded: This file appears to be a Business Central BOM report, but it was uploaded into the Original Navigation BOM section.'
    );
  }

  if (expectedFormat === 'business_central' && mentionsNav && !mentionsBc) {
    throw new Error(
      'Wrong report format uploaded: This file appears to be an Original Navigation BOM report, but it was uploaded into the Business Central BOM section.'
    );
  }
}

/**
 * Separate Excel-reading entry point for Original Navigation BOM vs Business Central BOM.
 * Runs 100% client-side using SheetJS (xlsx) and supports both .xls and .xlsx workbooks.
 */
export async function readBomExcelFile(
  file: File,
  reportFormat: BomReportFormat
): Promise<LoadedExcelWorkbook> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  if (bytes.length === 0) {
    throw new Error(`"${file.name}" is empty (0 bytes).`);
  }

  const detectedContainer = detectExcelContainerFormat(bytes, file.name);
  const extensionAllowed = hasAllowedExtension(file.name);

  if (!detectedContainer && !extensionAllowed) {
    throw new Error(
      `Invalid file type: "${file.name}". Please upload a Microsoft Excel (.xls or .xlsx) BOM workbook.`
    );
  }

  const isDefinitelyNonExcel =
    (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) ||
    (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47);

  if (isDefinitelyNonExcel) {
    throw new Error(
      `Invalid file format: "${file.name}" is not a valid Excel (.xls or .xlsx) workbook.`
    );
  }

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(bytes, {
      type: 'array',
      cellDates: true,
      cellNF: true,
      cellText: false,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'Unable to parse Excel workbook.';
    throw new Error(`Could not read Excel file "${file.name}": ${detail}`);
  }

  if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
    throw new Error(`"${file.name}" does not contain any worksheets.`);
  }

  const sheets: Record<string, ParsedSheetData> = {};
  for (const sheetName of workbook.SheetNames) {
    const ws = workbook.Sheets[sheetName];
    if (ws) {
      sheets[sheetName] = parseWorksheetForReport(sheetName, ws, reportFormat);
    }
  }

  const bestSheetName =
    workbook.SheetNames.find((name) => {
      const s = sheets[name];
      return s && s.rows.length > 0 && s.detectedMapping.itemCode !== '';
    }) ??
    workbook.SheetNames.find((name) => (sheets[name]?.rows.length ?? 0) > 0) ??
    workbook.SheetNames[0];

  const primarySheet = sheets[bestSheetName];
  const primaryWorksheet = workbook.Sheets[bestSheetName];

  if (primaryWorksheet && primarySheet) {
    detectBannerFormatMismatch(primaryWorksheet, primarySheet.headerRowIndex, reportFormat);
  }

  if (!primarySheet || primarySheet.rows.length === 0) {
    throw new Error(
      `"${file.name}" contains no BOM component rows in worksheet "${bestSheetName}".`
    );
  }

  if (!primarySheet.detectedMapping.itemCode && !primarySheet.detectedMapping.description) {
    throw new Error(
      `Invalid BOM report format in "${file.name}": Required BOM columns (Level, No., Description, BOM Qty.) could not be detected.`
    );
  }

  const finalFormat: ExcelContainerFormat =
    detectedContainer ?? (file.name.toLowerCase().endsWith('.xls') ? 'xls' : 'xlsx');

  const formatNotes: string[] = [];
  formatNotes.push(`Header detected at row ${primarySheet.headerRowIndex + 1}`);
  if (primarySheet.continuationRowsMerged > 0) {
    formatNotes.push(
      `${primarySheet.continuationRowsMerged} description continuation row${
        primarySheet.continuationRowsMerged === 1 ? '' : 's'
      } merged`
    );
  }
  if (primarySheet.blankRowsSkipped > 0) {
    formatNotes.push(
      `${primarySheet.blankRowsSkipped} blank/footer row${
        primarySheet.blankRowsSkipped === 1 ? '' : 's'
      } skipped`
    );
  }
  if (primarySheet.ignoredCostColumns.length > 0) {
    formatNotes.push(
      `${primarySheet.ignoredCostColumns.length} cost column${
        primarySheet.ignoredCostColumns.length === 1 ? '' : 's'
      } ignored`
    );
  }

  return {
    reportFormat,
    fileName: file.name,
    fileSize: file.size,
    detectedFormat: finalFormat,
    formatLabel: finalFormat === 'xls' ? 'Excel 97–2003 (.xls)' : 'Excel Workbook (.xlsx)',
    sheetNames: workbook.SheetNames,
    sheets,
    selectedSheet: bestSheetName,
    loadedAt: new Date().toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }),
    formatNotes,
  };
}

export async function readNavigationBomExcel(file: File): Promise<LoadedExcelWorkbook> {
  return readBomExcelFile(file, 'navigation');
}

export async function readBusinessCentralBomExcel(file: File): Promise<LoadedExcelWorkbook> {
  return readBomExcelFile(file, 'business_central');
}

export function buildExcelBinary(
  sheets: Array<{ name: string; rows: Array<Record<string, unknown>> }>,
  format: ExcelContainerFormat
): Uint8Array {
  const wb = XLSX.utils.book_new();
  for (const sheet of sheets) {
    const ws = XLSX.utils.json_to_sheet(sheet.rows);
    XLSX.utils.book_append_sheet(wb, ws, sheet.name.slice(0, 31));
  }
  const bookType: XLSX.BookType = format === 'xls' ? 'biff8' : 'xlsx';
  const out = XLSX.write(wb, { bookType, type: 'array' }) as ArrayBuffer | Uint8Array;
  return out instanceof Uint8Array ? out : new Uint8Array(out);
}

export function triggerExcelDownload(
  fileName: string,
  sheets: Array<{ name: string; rows: Array<Record<string, unknown>> }>,
  format: ExcelContainerFormat
): void {
  const bytes = buildExcelBinary(sheets, format);
  const mime =
    format === 'xls'
      ? 'application/vnd.ms-excel'
      : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
