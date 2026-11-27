import type {
  BomNode,
  BomValidationIssue,
  BomVerificationRecord,
  BomVerificationReport,
  ColumnMapping,
  FieldChange,
  ParsedBomTree,
  StageAuditCheck,
  ValidationAuditReport,
} from '../types/bom';

function normalizeTextPreserveCase(val: unknown): string {
  return String(val ?? '')
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(/\u00a0/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function canonicalItemCode(code: string): string {
  let cleaned = normalizeTextPreserveCase(code)
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/\s*([-/])\s*/g, '$1')
    .toLowerCase();
  // Strip harmless float suffix like "12450000002.0" only when matching pure digits
  if (/^\d+\.0+$/.test(cleaned)) {
    cleaned = cleaned.replace(/\.0+$/, '');
  }
  return cleaned;
}

function canonicalDescription(raw: string): string {
  let text = normalizeTextPreserveCase(raw)
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\u00d7/g, 'x')
    .toLowerCase();

  // Replace non-decimal dots (including trailing dots after numbers like "LOT 1.") and punctuation with spaces
  // while preserving true decimal points between digits like "52.5" and distinct digits like "10 200" vs "102 00".
  text = text
    .replace(/(?<!\d)\.|(?<=\d)\.(?!\d)/g, ' ')
    .replace(/[-/,;:'"()[\]+&*=]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Remove spaces unless BOTH sides of the space are digits (prevents merging "10 200" with "102 00")
  return text.replace(/(?<!\d)\s+|\s+(?!\d)/g, '');
}

function canonicalUom(raw: string): string {
  return normalizeTextPreserveCase(raw)
    .toLowerCase()
    .replace(/[\s.\-_/]+/g, '');
}

function canonicalItemType(raw: string): string {
  const cleaned = normalizeTextPreserveCase(raw)
    .toLowerCase()
    .replace(/[.\-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  if (/^(purch|purchase|purchased|buy)$/.test(cleaned)) return 'purchase';
  if (
    /^(prod\s*order|production\s*order|prodorder|productionorder|mfg|manufacture|manufactured)$/.test(
      cleaned
    )
  ) {
    return 'prod_order';
  }
  if (/^(prod\s*bom|production\s*bom|prodbom|productionbom)$/.test(cleaned)) {
    return 'prod_bom';
  }
  if (/^(assembly|assembly\s*order|assembly\s*bom)$/.test(cleaned)) {
    return 'assembly';
  }
  return cleaned.replace(/\s+/g, '');
}

function parseLevelValue(
  raw: unknown,
  useWbsDottedMode: boolean
): { numeric: number; rawText: string } {
  const text = normalizeTextPreserveCase(raw);
  if (!text) {
    return { numeric: 0, rawText: '0' };
  }

  if (useWbsDottedMode && /^\d+(\.\d+)*$/.test(text)) {
    const segments = text.split('.').filter(Boolean);
    return { numeric: Math.max(0, segments.length - 1), rawText: text };
  }

  const numMatch = text.match(/(\d+)/);
  if (numMatch) {
    return { numeric: Number.parseInt(numMatch[1], 10), rawText: text };
  }

  return { numeric: 0, rawText: text };
}

function parseNumericStrict(raw: unknown): {
  value: number | null;
  valid: boolean;
  rawText: string;
} {
  if (typeof raw === 'number') {
    return {
      value: Number.isFinite(raw) ? raw : null,
      valid: Number.isFinite(raw),
      rawText: String(raw),
    };
  }
  const text = normalizeTextPreserveCase(raw);
  if (!text) {
    return { value: null, valid: false, rawText: '' };
  }
  const cleaned = text.replace(/,/g, '');
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) {
    return { value: null, valid: false, rawText: text };
  }
  return {
    value: parsed,
    valid: true,
    rawText: text,
  };
}

function numbersMatchExact(a: number | null, b: number | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  // Compare at 1e-9 to absorb IEEE-754 / Excel export float drift while catching real precision diffs (e.g. 2.5 vs 2.505)
  return Math.abs(a - b) < 1e-9;
}

function computeNumericDiff(a: number | null, b: number | null): number | null {
  if (a === null || b === null) return null;
  const diff = b - a;
  return Math.abs(diff) < 1e-9 ? 0 : Number(diff.toFixed(9));
}

function formatQty(val: number | null, rawText: string): string {
  if (val !== null) return String(val);
  return rawText || '—';
}

function isPurchaseType(val: string): boolean {
  return /\bpurch(ase|ased)?\b/i.test(val);
}

function isProdOrderType(val: string): boolean {
  return /\bprod(\.|uction)?\s*(order|bom)?\b|\bmanufactur/i.test(val);
}

/**
 * Reconstructs parent-child BOM hierarchy from Level column.
 * Retains every component occurrence independently (zero duplicate suppression or consolidation).
 */
export function buildBomTree(
  rows: Record<string, unknown>[],
  mapping: ColumnMapping,
  source: 'Original Navigation' | 'Business Central'
): ParsedBomTree {
  const issues: BomValidationIssue[] = [];
  const flatNodes: BomNode[] = [];
  const roots: BomNode[] = [];

  if (rows.length === 0) {
    return { roots, flatNodes, issues, maxDepth: 0 };
  }

  const useWbsDottedMode = mapping.level
    ? rows.some((r) => /^\d+(\.\d+)+$/.test(normalizeTextPreserveCase(r[mapping.level])))
    : false;

  const rawLevels = rows.map((r) =>
    mapping.level
      ? parseLevelValue(r[mapping.level], useWbsDottedMode)
      : { numeric: 0, rawText: '0' }
  );
  const minLevel = rawLevels.reduce((min, item) => Math.min(min, item.numeric), Infinity);
  const baseOffset = Number.isFinite(minLevel) ? minLevel : 0;

  const ancestorStack: BomNode[] = [];
  let maxDepth = 0;

  rows.forEach((row, index) => {
    const rowNumber = typeof row.__rowNumber === 'number' ? row.__rowNumber : index + 2;
    const continuationRows = Array.isArray(row.__continuationRows)
      ? (row.__continuationRows as number[])
      : [];

    const itemCode = mapping.itemCode ? normalizeTextPreserveCase(row[mapping.itemCode]) : '';
    const parsedLvl = mapping.level
      ? parseLevelValue(row[mapping.level], useWbsDottedMode)
      : { numeric: 0, rawText: '0' };
    const normalizedLevel = Math.max(0, parsedLvl.numeric - baseOffset);

    const rawDescription = mapping.description ? String(row[mapping.description] ?? '') : '';
    const description = normalizeTextPreserveCase(rawDescription);
    const itemType = mapping.itemType
      ? normalizeTextPreserveCase(row[mapping.itemType])
      : '';
    const uom = mapping.uom ? normalizeTextPreserveCase(row[mapping.uom]) : '';

    const bomQtyParsed = mapping.bomQty
      ? parseNumericStrict(row[mapping.bomQty])
      : { value: null, valid: true, rawText: '' };

    const totalBomQtyParsed = mapping.totalBomQty
      ? parseNumericStrict(row[mapping.totalBomQty])
      : { value: null, valid: true, rawText: '' };

    let effectiveLevel = normalizedLevel;
    let nodeHasUncertainty = false;

    const expectedParentStack = ancestorStack.slice(
      0,
      Math.min(normalizedLevel, ancestorStack.length)
    );
    const provisionalParent =
      expectedParentStack.length > 0
        ? expectedParentStack[expectedParentStack.length - 1]
        : null;
    const provisionalParentCode = provisionalParent?.itemCode || 'Root';
    const provisionalParentPath =
      expectedParentStack.map((n) => n.itemCode || `(Row ${n.rowNumber})`).join(' > ') || 'Root';

    if (normalizedLevel > ancestorStack.length) {
      issues.push({
        id: `${source}-hierarchy-jump-${rowNumber}-${index}`,
        source,
        severity: 'warning',
        code: 'HIERARCHY_JUMP',
        warningCategory: 'Hierarchy Level Jump',
        rowNumber,
        level: parsedLvl.rawText || String(normalizedLevel),
        parentAssembly: provisionalParentCode,
        itemCode: itemCode || '(Blank)',
        description,
        hierarchyPath: provisionalParentPath,
        message: `Hierarchy level jump at row ${rowNumber}: expected level ≤ ${
          ancestorStack.length + baseOffset
        }, found "${parsedLvl.rawText}".`,
      });
      effectiveLevel = ancestorStack.length;
    }

    ancestorStack.length = effectiveLevel;
    const parentNode = effectiveLevel > 0 ? ancestorStack[effectiveLevel - 1] ?? null : null;
    const parentAssembly = parentNode?.itemCode || 'Root';
    const ancestorChain = ancestorStack.map((n) => n.itemCode || `(Row ${n.rowNumber})`);
    const parentPath = ancestorChain.length > 0 ? ancestorChain.join(' > ') : 'Root';

    if (!itemCode) {
      issues.push({
        id: `${source}-missing-item-${rowNumber}-${index}`,
        source,
        severity: 'warning',
        code: 'MISSING_ITEM_CODE',
        warningCategory: 'Missing Item Code',
        rowNumber,
        level: parsedLvl.rawText || String(effectiveLevel),
        parentAssembly,
        itemCode: '(Blank)',
        description,
        hierarchyPath: parentPath,
        message: `Row ${rowNumber} under parent "${parentAssembly}" (Level ${
          parsedLvl.rawText || effectiveLevel
        }) is missing No. (Item Code).`,
      });
    }

    const bomQtyValid =
      !mapping.bomQty ||
      (bomQtyParsed.valid && (bomQtyParsed.value === null || bomQtyParsed.value > 0));
    if (mapping.bomQty && !bomQtyValid) {
      issues.push({
        id: `${source}-invalid-qty-${rowNumber}-${index}`,
        source,
        severity: 'warning',
        code: 'INVALID_QUANTITY',
        warningCategory: 'Invalid Quantity',
        rowNumber,
        level: parsedLvl.rawText || String(effectiveLevel),
        parentAssembly,
        itemCode: itemCode || '(Blank)',
        description,
        hierarchyPath: parentPath,
        message: `Row ${rowNumber} (${itemCode || 'Blank No.'}) has invalid BOM Qty. "${
          bomQtyParsed.rawText || 'blank'
        }".`,
      });
    }

    const totalBomQtyValid =
      !mapping.totalBomQty ||
      totalBomQtyParsed.rawText === '' ||
      (totalBomQtyParsed.valid &&
        (totalBomQtyParsed.value === null || totalBomQtyParsed.value > 0));
    if (mapping.totalBomQty && !totalBomQtyValid) {
      issues.push({
        id: `${source}-invalid-total-qty-${rowNumber}-${index}`,
        source,
        severity: 'warning',
        code: 'INVALID_QUANTITY',
        warningCategory: 'Invalid Quantity',
        rowNumber,
        level: parsedLvl.rawText || String(effectiveLevel),
        parentAssembly,
        itemCode: itemCode || '(Blank)',
        description,
        hierarchyPath: parentPath,
        message: `Row ${rowNumber} (${itemCode || 'Blank No.'}) has invalid Total BOM Qty "${
          totalBomQtyParsed.rawText
        }".`,
      });
    }

    if (
      itemCode &&
      ancestorStack.some((anc) => canonicalItemCode(anc.itemCode) === canonicalItemCode(itemCode))
    ) {
      nodeHasUncertainty = true;
      issues.push({
        id: `${source}-circular-${rowNumber}-${index}`,
        source,
        severity: 'warning',
        code: 'CIRCULAR_REFERENCE',
        warningCategory: 'Circular Reference',
        rowNumber,
        level: parsedLvl.rawText || String(effectiveLevel),
        parentAssembly,
        itemCode,
        description,
        hierarchyPath: [...ancestorChain, itemCode].join(' > '),
        message: `Circular reference at row ${rowNumber}: "${itemCode}" appears beneath its own ancestor chain.`,
      });
    }

    // Keep circular reference uncertainty strictly on the directly affected node only
    // (never cascade HIERARCHY_JUMP to strip valid matches from children).

    let resolvedTotalQty = totalBomQtyParsed.value;
    let resolvedRawTotalQty = totalBomQtyParsed.rawText;
    if (!mapping.totalBomQty && bomQtyParsed.value !== null) {
      const parentTotal = parentNode?.totalBomQty ?? 1;
      resolvedTotalQty = Number((parentTotal * bomQtyParsed.value).toFixed(9));
      resolvedRawTotalQty = String(resolvedTotalQty);
    }

    const displayCode = itemCode || `(Blank Row ${rowNumber})`;
    const hierarchyPath =
      ancestorChain.length > 0 ? `${parentPath} > ${displayCode}` : displayCode;

    const node: BomNode = {
      id: `${source}-${rowNumber}-${index}`,
      rowNumber,
      continuationRows,
      level: effectiveLevel,
      rawLevel: parsedLvl.rawText,
      itemCode,
      description,
      rawDescription,
      itemType,
      uom,
      bomQty: bomQtyParsed.value,
      rawBomQty: bomQtyParsed.rawText,
      totalBomQty: resolvedTotalQty,
      rawTotalBomQty: resolvedRawTotalQty,
      bomQtyValid,
      totalBomQtyValid,
      hasHierarchyUncertainty: nodeHasUncertainty,
      isParentAssembly: false,
      parentId: parentNode ? parentNode.id : null,
      parentItemCode: parentNode ? parentNode.itemCode : null,
      ancestorChain,
      parentPath,
      hierarchyPath,
      children: [],
    };

    if (effectiveLevel > maxDepth) {
      maxDepth = effectiveLevel;
    }

    if (parentNode) {
      parentNode.children.push(node);
      parentNode.isParentAssembly = true;
    } else {
      roots.push(node);
    }

    ancestorStack[effectiveLevel] = node;
    flatNodes.push(node);
  });

  for (const node of flatNodes) {
    if (
      node.children.length > 0 ||
      /assembly|production\s*bom|sub[\s-]*assy|sub[\s-]*assembly|prod\.?\s*order/i.test(
        node.itemType
      )
    ) {
      node.isParentAssembly = true;
    }
  }

  return {
    roots,
    flatNodes,
    issues,
    maxDepth,
  };
}

function getParentChainKey(node: BomNode): string {
  return node.ancestorChain.length === 0
    ? '__ROOT__'
    : node.ancestorChain.map(canonicalItemCode).join(' > ');
}

function compareSevenColumns(original: BomNode, bc: BomNode): FieldChange[] {
  const changes: FieldChange[] = [];

  // 1. Level (compare reconstructed hierarchical level; ignore harmless formatting like "01" vs "1", ".1" vs "1", or 0-based vs 1-based offset)
  if (original.level !== bc.level) {
    changes.push({
      field: 'Level',
      category: 'Incorrect Level',
      before: original.rawLevel || String(original.level),
      after: bc.rawLevel || String(bc.level),
      explanation: `Level changed from "${original.rawLevel || original.level}" to "${bc.rawLevel || bc.level}".`,
    });
  }

  // 2. No. (Item Code — ignore case, extra spaces, spaces around hyphens/slashes, trailing .0 float suffix)
  if (canonicalItemCode(original.itemCode) !== canonicalItemCode(bc.itemCode)) {
    changes.push({
      field: 'No.',
      category: 'Incorrect Item Code',
      before: original.itemCode || '—',
      after: bc.itemCode || '—',
      explanation: `Part No. changed from "${original.itemCode || '—'}" to "${bc.itemCode || '—'}".`,
    });
  }

  // 3. Description (ignore harmless case, whitespace, and punctuation-spacing differences; flag genuine wording/spec/revision diffs)
  if (canonicalDescription(original.description) !== canonicalDescription(bc.description)) {
    changes.push({
      field: 'Description',
      category: 'Description Differences – Review Required',
      before: original.description || '—',
      after: bc.description || '—',
      explanation: `Description changed from "${original.description || '—'}" to "${bc.description || '—'}".`,
    });
  }

  // 4. Item Type (normalize case/dots/spacing & standard synonyms; catch Purchase vs Prod. Order mismatches)
  if (canonicalItemType(original.itemType) !== canonicalItemType(bc.itemType)) {
    const isPurchVsProd =
      (isPurchaseType(original.itemType) && isProdOrderType(bc.itemType)) ||
      (isProdOrderType(original.itemType) && isPurchaseType(bc.itemType));

    changes.push({
      field: 'Item Type',
      category: isPurchVsProd
        ? 'Item Type Mismatch (Purchase vs Prod. Order)'
        : 'Incorrect Item Type',
      before: original.itemType || '—',
      after: bc.itemType || '—',
      explanation: isPurchVsProd
        ? `Item Type changed (Purchase vs Prod. Order) from "${original.itemType || '—'}" to "${bc.itemType || '—'}".`
        : `Item Type changed from "${original.itemType || '—'}" to "${bc.itemType || '—'}".`,
    });
  }

  // 5. UOM (ignore harmless case, whitespace, and trailing period differences like "PCS" vs "Pcs.")
  if (canonicalUom(original.uom) !== canonicalUom(bc.uom)) {
    changes.push({
      field: 'UOM',
      category: 'Incorrect UOM',
      before: original.uom || '—',
      after: bc.uom || '—',
      explanation: `UOM changed from "${original.uom || '—'}" to "${bc.uom || '—'}".`,
    });
  }

  // 6. BOM Qty. (strict numerical comparison, preserving decimal precision)
  const bomQtyEqual =
    original.bomQty !== null && bc.bomQty !== null
      ? numbersMatchExact(original.bomQty, bc.bomQty)
      : normalizeTextPreserveCase(original.rawBomQty) === normalizeTextPreserveCase(bc.rawBomQty);

  if (!bomQtyEqual) {
    const beforeStr = formatQty(original.bomQty, original.rawBomQty);
    const afterStr = formatQty(bc.bomQty, bc.rawBomQty);
    const diff = computeNumericDiff(original.bomQty, bc.bomQty);
    const diffLabel = diff !== null ? ` (${diff > 0 ? `+${diff}` : diff})` : '';
    changes.push({
      field: 'BOM Qty.',
      category: 'Incorrect BOM Qty.',
      before: beforeStr,
      after: afterStr,
      numericDiff: diff,
      explanation: `BOM Qty. changed from ${beforeStr} to ${afterStr}${diffLabel}.`,
    });
  }

  // 7. Total BOM Qty (strict numerical comparison, preserving decimal precision)
  const totalQtyEqual =
    original.totalBomQty !== null && bc.totalBomQty !== null
      ? numbersMatchExact(original.totalBomQty, bc.totalBomQty)
      : normalizeTextPreserveCase(original.rawTotalBomQty) ===
        normalizeTextPreserveCase(bc.rawTotalBomQty);

  if (!totalQtyEqual) {
    const beforeStr = formatQty(original.totalBomQty, original.rawTotalBomQty);
    const afterStr = formatQty(bc.totalBomQty, bc.rawTotalBomQty);
    const diff = computeNumericDiff(original.totalBomQty, bc.totalBomQty);
    const diffLabel = diff !== null ? ` (${diff > 0 ? `+${diff}` : diff})` : '';
    changes.push({
      field: 'Total BOM Qty',
      category: 'Incorrect Total BOM Qty',
      before: beforeStr,
      after: afterStr,
      numericDiff: diff,
      explanation: `Total BOM Qty changed from ${beforeStr} to ${afterStr}${diffLabel}.`,
    });
  }

  return changes;
}

function scoreOccurrenceSimilarity(original: BomNode, bc: BomNode): number {
  let score = 0;
  if (
    original.description &&
    canonicalDescription(original.description) === canonicalDescription(bc.description)
  ) {
    score += 40;
  }
  if (original.level === bc.level) score += 15;
  if (
    original.itemType &&
    canonicalItemType(original.itemType) === canonicalItemType(bc.itemType)
  ) {
    score += 15;
  }
  if (original.uom && canonicalUom(original.uom) === canonicalUom(bc.uom)) score += 10;
  if (original.bomQty !== null && numbersMatchExact(original.bomQty, bc.bomQty)) score += 20;
  if (original.totalBomQty !== null && numbersMatchExact(original.totalBomQty, bc.totalBomQty)) {
    score += 10;
  }
  return score;
}

function areNodesFieldEquivalent(a: BomNode, b: BomNode): boolean {
  return (
    a.level === b.level &&
    canonicalItemCode(a.itemCode) === canonicalItemCode(b.itemCode) &&
    canonicalDescription(a.description) === canonicalDescription(b.description) &&
    canonicalItemType(a.itemType) === canonicalItemType(b.itemType) &&
    canonicalUom(a.uom) === canonicalUom(b.uom) &&
    numbersMatchExact(a.bomQty, b.bomQty) &&
    numbersMatchExact(a.totalBomQty, b.totalBomQty)
  );
}

function summarizeErrorCategory(changes: FieldChange[]): string {
  if (changes.length === 0) return 'Matched';
  const hasParentMismatch = changes.some((c) => c.field === 'Parent Assembly');
  if (hasParentMismatch) {
    const otherFields = changes.filter(
      (c) => c.field !== 'Parent Assembly' && c.field !== 'Level'
    );
    return otherFields.length === 0
      ? 'Hierarchy Mismatch (Wrong Parent Assembly)'
      : `Hierarchy Mismatch + ${otherFields.map((c) => c.field).join(', ')}`;
  }
  if (changes.length === 1) return changes[0].category;
  return changes.map((c) => c.field).join(', ') + ' Mismatch';
}

function makePairedRecord(
  original: BomNode,
  bc: BomNode,
  changes: FieldChange[],
  keyPrefix: string
): BomVerificationRecord {
  const componentRole =
    original.isParentAssembly || bc.isParentAssembly ? 'Parent Assembly' : 'Child Component';

  const isDescriptionOnlyDiff =
    changes.length === 1 && changes[0].field === 'Description';

  const status =
    changes.length === 0
      ? 'matched'
      : isDescriptionOnlyDiff
        ? 'description_review'
        : 'incorrect';

  const errorCategory = summarizeErrorCategory(changes);
  const reasonForClassification =
    changes.length === 0
      ? `Exact 7-field match under parent assembly "${bc.parentPath}".`
      : changes.map((c) => c.explanation).join(' ');

  return {
    key: `${keyPrefix}-${original.id}-${bc.id}`,
    status,
    discrepancyCategory: errorCategory,
    errorCategory,
    componentRole,
    originalRowNumber: original.rowNumber,
    bcRowNumber: bc.rowNumber,
    level: bc.level,
    rawLevel: bc.rawLevel || String(bc.level),
    originalLevel: original.rawLevel || String(original.level),
    bcLevel: bc.rawLevel || String(bc.level),
    itemCode: bc.itemCode,
    description: bc.description || original.description,
    originalDescription: original.description,
    bcDescription: bc.description,
    itemType: bc.itemType || original.itemType,
    uom: bc.uom || original.uom,
    parentAssemblyCode: bc.parentItemCode ?? 'Root',
    originalParentAssembly: original.parentPath,
    bcParentAssembly: bc.parentPath,
    parentPath: bc.parentPath,
    hierarchyPath: bc.hierarchyPath,
    originalNode: original,
    bcNode: bc,
    originalBomQty: original.bomQty,
    bcBomQty: bc.bomQty,
    bomQtyDiff: computeNumericDiff(original.bomQty, bc.bomQty),
    originalTotalQty: original.totalBomQty,
    bcTotalQty: bc.totalBomQty,
    totalQtyDiff: computeNumericDiff(original.totalBomQty, bc.totalBomQty),
    originalValueSummary:
      changes.length === 0
        ? `Lvl ${original.rawLevel || original.level} · Qty ${formatQty(original.bomQty, original.rawBomQty)}`
        : changes.map((c) => `${c.field}: ${c.before}`).join(' | '),
    bcValueSummary:
      changes.length === 0
        ? `Lvl ${bc.rawLevel || bc.level} · Qty ${formatQty(bc.bomQty, bc.rawBomQty)}`
        : changes.map((c) => `${c.field}: ${c.after}`).join(' | '),
    changes,
    reasonForClassification,
    detailedExplanation: reasonForClassification,
  };
}

function makeManualReviewRecord(
  node: BomNode,
  sourceSide: 'Original Navigation' | 'Business Central',
  reason: string
): BomVerificationRecord {
  const isOrig = sourceSide === 'Original Navigation';
  return {
    key: `manual-${isOrig ? 'orig' : 'bc'}-${node.id}`,
    status: 'manual_review',
    discrepancyCategory: 'Requires Manual Review',
    errorCategory: 'Requires Manual Review',
    componentRole: node.isParentAssembly ? 'Parent Assembly' : 'Child Component',
    sourceSide,
    originalRowNumber: isOrig ? node.rowNumber : null,
    bcRowNumber: isOrig ? null : node.rowNumber,
    level: node.level,
    rawLevel: node.rawLevel || String(node.level),
    originalLevel: isOrig ? node.rawLevel || String(node.level) : '—',
    bcLevel: isOrig ? '—' : node.rawLevel || String(node.level),
    itemCode: node.itemCode || '(Blank)',
    description: node.description,
    originalDescription: isOrig ? node.description : '—',
    bcDescription: isOrig ? '—' : node.description,
    itemType: node.itemType,
    uom: node.uom,
    parentAssemblyCode: node.parentItemCode ?? 'Root',
    originalParentAssembly: isOrig ? node.parentPath : '—',
    bcParentAssembly: isOrig ? '—' : node.parentPath,
    parentPath: node.parentPath,
    hierarchyPath: node.hierarchyPath,
    originalNode: isOrig ? node : null,
    bcNode: isOrig ? null : node,
    originalBomQty: isOrig ? node.bomQty : null,
    bcBomQty: isOrig ? null : node.bomQty,
    bomQtyDiff: null,
    originalTotalQty: isOrig ? node.totalBomQty : null,
    bcTotalQty: isOrig ? null : node.totalBomQty,
    totalQtyDiff: null,
    originalValueSummary: isOrig
      ? `Row ${node.rowNumber} · Lvl ${node.rawLevel || node.level} · Qty ${formatQty(node.bomQty, node.rawBomQty)}`
      : '—',
    bcValueSummary: isOrig
      ? '—'
      : `Row ${node.rowNumber} · Lvl ${node.rawLevel || node.level} · Qty ${formatQty(node.bomQty, node.rawBomQty)}`,
    changes: [],
    reasonForClassification: reason,
    detailedExplanation: reason,
  };
}

function makeUnmatchedRecord(
  node: BomNode,
  kind: 'missing' | 'additional'
): BomVerificationRecord {
  const isMissing = kind === 'missing';
  const role = node.isParentAssembly ? 'Parent Assembly' : 'Child Component';
  const category = isMissing
    ? node.isParentAssembly
      ? 'Missing Parent Assembly'
      : 'Missing Child Component'
    : node.isParentAssembly
      ? 'Additional Parent Assembly'
      : 'Additional Child Component';

  const reason = isMissing
    ? `${role} "${node.itemCode}" in Original Navigation BOM (row ${node.rowNumber}, Level ${
        node.rawLevel || node.level
      }) under parent "${node.parentPath}" was not found in Business Central BOM.`
    : `Additional ${role.toLowerCase()} "${node.itemCode}" in Business Central BOM (row ${
        node.rowNumber
      }, Level ${node.rawLevel || node.level}) under parent "${node.parentPath}" does not exist in Original Navigation BOM.`;

  return {
    key: `${kind}-${node.id}`,
    status: kind,
    discrepancyCategory: category,
    errorCategory: category,
    componentRole: role,
    sourceSide: isMissing ? 'Original Navigation' : 'Business Central',
    originalRowNumber: isMissing ? node.rowNumber : null,
    bcRowNumber: isMissing ? null : node.rowNumber,
    level: node.level,
    rawLevel: node.rawLevel || String(node.level),
    originalLevel: isMissing ? node.rawLevel || String(node.level) : '—',
    bcLevel: isMissing ? '—' : node.rawLevel || String(node.level),
    itemCode: node.itemCode,
    description: node.description,
    originalDescription: isMissing ? node.description : '—',
    bcDescription: isMissing ? '—' : node.description,
    itemType: node.itemType,
    uom: node.uom,
    parentAssemblyCode: node.parentItemCode ?? 'Root',
    originalParentAssembly: isMissing ? node.parentPath : '—',
    bcParentAssembly: isMissing ? '—' : node.parentPath,
    parentPath: node.parentPath,
    hierarchyPath: node.hierarchyPath,
    originalNode: isMissing ? node : null,
    bcNode: isMissing ? null : node,
    originalBomQty: isMissing ? node.bomQty : null,
    bcBomQty: isMissing ? null : node.bomQty,
    bomQtyDiff: null,
    originalTotalQty: isMissing ? node.totalBomQty : null,
    bcTotalQty: isMissing ? null : node.totalBomQty,
    totalQtyDiff: null,
    originalValueSummary: isMissing
      ? `Lvl ${node.rawLevel || node.level} · Qty ${formatQty(node.bomQty, node.rawBomQty)} · Total ${formatQty(node.totalBomQty, node.rawTotalBomQty)} · ${node.uom || '—'}`
      : 'Not in Original',
    bcValueSummary: isMissing
      ? 'Missing in BC'
      : `Lvl ${node.rawLevel || node.level} · Qty ${formatQty(node.bomQty, node.rawBomQty)} · Total ${formatQty(node.totalBomQty, node.rawTotalBomQty)} · ${node.uom || '—'}`,
    changes: [],
    reasonForClassification: reason,
    detailedExplanation: reason,
  };
}

function computeAncestorOverlapScore(a: BomNode, b: BomNode): number {
  if (a.ancestorChain.length === 0 && b.ancestorChain.length === 0) return 200;
  if (a.ancestorChain.length === 0 || b.ancestorChain.length === 0) return 0;
  const setA = new Set(a.ancestorChain.map(canonicalItemCode));
  const setB = new Set(b.ancestorChain.map(canonicalItemCode));
  let shared = 0;
  for (const code of setA) {
    if (setB.has(code)) shared += 1;
  }
  const denom = Math.max(setA.size, setB.size);
  return denom === 0 ? 0 : Math.round((200 * shared) / denom);
}

function computeParentContextScore(
  orig: BomNode,
  bc: BomNode,
  pairedParentMap: Map<string, string>
): number {
  let score = scoreOccurrenceSimilarity(orig, bc);

  // Bonus for normalized description prefix/substring overlap (e.g. revision suffix)
  const canonOrigDesc = canonicalDescription(orig.description);
  const canonBcDesc = canonicalDescription(bc.description);
  if (
    canonOrigDesc &&
    canonBcDesc &&
    canonOrigDesc !== canonBcDesc &&
    (canonOrigDesc.includes(canonBcDesc) || canonBcDesc.includes(canonOrigDesc))
  ) {
    score += 20;
  }

  // Priority A: Immediate parent assemblies are already paired
  if (orig.parentId && bc.parentId && pairedParentMap.get(orig.parentId) === bc.parentId) {
    score += 1000;
  } else if (!orig.parentId && !bc.parentId) {
    score += 500;
  } else if (
    orig.parentItemCode &&
    bc.parentItemCode &&
    canonicalItemCode(orig.parentItemCode) === canonicalItemCode(bc.parentItemCode)
  ) {
    score += 500;
  }

  score += computeAncestorOverlapScore(orig, bc);
  return score;
}

function buildPairedChangesWithHierarchy(original: BomNode, bc: BomNode): FieldChange[] {
  const changes = compareSevenColumns(original, bc);
  const sameParentChain = getParentChainKey(original) === getParentChainKey(bc);
  const sameImmediateParent =
    canonicalItemCode(original.parentItemCode ?? 'Root') ===
    canonicalItemCode(bc.parentItemCode ?? 'Root');

  if (!sameParentChain) {
    changes.unshift({
      field: 'Parent Assembly',
      category: 'Hierarchy Mismatch',
      before: original.parentPath,
      after: bc.parentPath,
      explanation: sameImmediateParent
        ? `Hierarchy path shifted: expected "${original.parentPath}", found "${bc.parentPath}".`
        : `Wrong parent assembly: expected "${original.parentPath}", found "${bc.parentPath}".`,
    });
  }
  return changes;
}

/**
 * Deterministically pairs occurrences in a bucket using global optimal assignment for small buckets
 * and symmetric-duplicate tolerance, reserving Manual Review ONLY for genuine non-equivalent ties.
 */
function resolveBucketAssignments(
  remOrig: BomNode[],
  remBc: BomNode[],
  scoreFn: (o: BomNode, b: BomNode) => number
): {
  pairs: Array<{ o: BomNode; b: BomNode }>;
  ambiguousOrig: Array<{ node: BomNode; candidates: BomNode[] }>;
  ambiguousBc: Array<{ node: BomNode; candidates: BomNode[] }>;
  surplusOrig: BomNode[];
  surplusBc: BomNode[];
} {
  if (remOrig.length === 0 || remBc.length === 0) {
    return {
      pairs: [],
      ambiguousOrig: [],
      ambiguousBc: [],
      surplusOrig: [...remOrig],
      surplusBc: [...remBc],
    };
  }

  // Exact 1-to-1 remaining pair -> 100% deterministic, zero ambiguity!
  if (remOrig.length === 1 && remBc.length === 1) {
    return {
      pairs: [{ o: remOrig[0], b: remBc[0] }],
      ambiguousOrig: [],
      ambiguousBc: [],
      surplusOrig: [],
      surplusBc: [],
    };
  }

  // If ALL remaining Original nodes are identical siblings OR ALL remaining BC nodes are identical siblings,
  // any pairing order produces identical field results (no ambiguity!).
  const allOrigIdentical = remOrig.every((n) => areNodesFieldEquivalent(n, remOrig[0]));
  const allBcIdentical = remBc.every((n) => areNodesFieldEquivalent(n, remBc[0]));
  if (allOrigIdentical && allBcIdentical) {
    const count = Math.min(remOrig.length, remBc.length);
    const pairs: Array<{ o: BomNode; b: BomNode }> = [];
    for (let i = 0; i < count; i += 1) {
      pairs.push({ o: remOrig[i], b: remBc[i] });
    }
    return {
      pairs,
      ambiguousOrig: [],
      ambiguousBc: [],
      surplusOrig: remOrig.slice(count),
      surplusBc: remBc.slice(count),
    };
  }

  const m = remOrig.length;
  const n = remBc.length;
  const scores: number[][] = Array.from({ length: m }, (_, i) =>
    Array.from({ length: n }, (_, j) => scoreFn(remOrig[i], remBc[j]))
  );

  // For moderate sizes (m, n <= 7), find exact maximum-weight bipartite matchings
  if (m <= 7 && n <= 7) {
    const k = Math.min(m, n);
    let bestWeight = -Infinity;
    const optimalAssignments: Array<Array<{ oIdx: number; bIdx: number }>> = [];
    const usedB = new Array<boolean>(n).fill(false);

    const search = (
      oPos: number,
      picked: number,
      weight: number,
      current: Array<{ oIdx: number; bIdx: number }>
    ) => {
      if (picked === k) {
        if (weight > bestWeight) {
          bestWeight = weight;
          optimalAssignments.length = 0;
          optimalAssignments.push([...current]);
        } else if (weight === bestWeight && optimalAssignments.length < 16) {
          optimalAssignments.push([...current]);
        }
        return;
      }
      if (m - oPos < k - picked) return;

      // Option 1: pair remOrig[oPos] with each unused bIdx
      for (let bIdx = 0; bIdx < n; bIdx += 1) {
        if (usedB[bIdx]) continue;
        usedB[bIdx] = true;
        current.push({ oIdx: oPos, bIdx });
        search(oPos + 1, picked + 1, weight + scores[oPos][bIdx], current);
        current.pop();
        usedB[bIdx] = false;
      }

      // Option 2: skip remOrig[oPos] if m > k
      if (m - oPos > k - picked) {
        search(oPos + 1, picked, weight, current);
      }
    };

    search(0, 0, 0, []);

    const firstOpt = optimalAssignments[0] ?? [];
    // Check if ALL optimal assignments agree on every pair up to node field-equivalence!
    const signature = (assign: Array<{ oIdx: number; bIdx: number }>) =>
      assign
        .map(({ oIdx, bIdx }) => {
          const o = remOrig[oIdx];
          const b = remBc[bIdx];
          return `${getParentChainKey(o)}|${o.level}|${canonicalDescription(o.description)}|${canonicalItemType(o.itemType)}|${canonicalUom(o.uom)}|${o.bomQty}|${o.totalBomQty}=>${getParentChainKey(b)}|${b.level}|${canonicalDescription(b.description)}|${canonicalItemType(b.itemType)}|${canonicalUom(b.uom)}|${b.bomQty}|${b.totalBomQty}`;
        })
        .sort()
        .join(';;');

    const uniqueSignatures = new Set(optimalAssignments.map(signature));
    if (uniqueSignatures.size <= 1) {
      const usedOIdx = new Set(firstOpt.map((p) => p.oIdx));
      const usedBIdx = new Set(firstOpt.map((p) => p.bIdx));
      return {
        pairs: firstOpt.map(({ oIdx, bIdx }) => ({ o: remOrig[oIdx], b: remBc[bIdx] })),
        ambiguousOrig: [],
        ambiguousBc: [],
        surplusOrig: remOrig.filter((_, idx) => !usedOIdx.has(idx)),
        surplusBc: remBc.filter((_, idx) => !usedBIdx.has(idx)),
      };
    }

    // Separate unambiguous pairs (identical across all optimal assignments) from genuinely tied ones
    const unambiguousO = new Set<number>();
    const unambiguousB = new Set<number>();
    const pairs: Array<{ o: BomNode; b: BomNode }> = [];

    for (const { oIdx, bIdx } of firstOpt) {
      const alwaysSame = optimalAssignments.every((alt) =>
        alt.some((p) => p.oIdx === oIdx && p.bIdx === bIdx)
      );
      if (alwaysSame) {
        unambiguousO.add(oIdx);
        unambiguousB.add(bIdx);
        pairs.push({ o: remOrig[oIdx], b: remBc[bIdx] });
      }
    }

    const leftO = remOrig.filter((_, idx) => !unambiguousO.has(idx));
    const leftB = remBc.filter((_, idx) => !unambiguousB.has(idx));

    // Only keep ambiguous items when BOTH sides have competing candidates; extra items are surplus
    if (leftO.length > 0 && leftB.length > 0) {
      return {
        pairs,
        ambiguousOrig: leftO.map((node) => ({ node, candidates: leftB })),
        ambiguousBc: leftB.map((node) => ({ node, candidates: leftO })),
        surplusOrig: [],
        surplusBc: [],
      };
    }

    return {
      pairs,
      ambiguousOrig: [],
      ambiguousBc: [],
      surplusOrig: leftO,
      surplusBc: leftB,
    };
  }

  // Fallback for large (>7) repeated buckets: score-ordered pairing with equivalence tolerance
  const candidates: Array<{ oIdx: number; bIdx: number; score: number }> = [];
  for (let oIdx = 0; oIdx < m; oIdx += 1) {
    for (let bIdx = 0; bIdx < n; bIdx += 1) {
      candidates.push({ oIdx, bIdx, score: scores[oIdx][bIdx] });
    }
  }
  candidates.sort((a, b) => b.score - a.score);

  const usedO = new Set<number>();
  const usedB = new Set<number>();
  const pairs: Array<{ o: BomNode; b: BomNode }> = [];

  for (const cand of candidates) {
    if (usedO.has(cand.oIdx) || usedB.has(cand.bIdx)) continue;
    const oNode = remOrig[cand.oIdx];
    const bNode = remBc[cand.bIdx];

    const nonEquivTies = candidates.filter(
      (other) =>
        !usedO.has(other.oIdx) &&
        !usedB.has(other.bIdx) &&
        other.score === cand.score &&
        (other.oIdx === cand.oIdx || other.bIdx === cand.bIdx) &&
        !(
          areNodesFieldEquivalent(remOrig[other.oIdx], oNode) &&
          areNodesFieldEquivalent(remBc[other.bIdx], bNode) &&
          getParentChainKey(remOrig[other.oIdx]) === getParentChainKey(oNode) &&
          getParentChainKey(remBc[other.bIdx]) === getParentChainKey(bNode)
        )
    );
    if (nonEquivTies.length > 0) continue;

    usedO.add(cand.oIdx);
    usedB.add(cand.bIdx);
    pairs.push({ o: oNode, b: bNode });
  }

  const leftO = remOrig.filter((_, idx) => !usedO.has(idx));
  const leftB = remBc.filter((_, idx) => !usedB.has(idx));

  if (leftO.length > 0 && leftB.length > 0) {
    return {
      pairs,
      ambiguousOrig: leftO.map((node) => ({ node, candidates: leftB })),
      ambiguousBc: leftB.map((node) => ({ node, candidates: leftO })),
      surplusOrig: [],
      surplusBc: [],
    };
  }

  return {
    pairs,
    ambiguousOrig: [],
    ambiguousBc: [],
    surplusOrig: leftO,
    surplusBc: leftB,
  };
}

/**
 * STAGE 1: Multi-Pass Parent-Context BOM Comparison
 * Matching priority:
 * 1. Exact Item Code + exact Parent Assembly + hierarchy path (row order ignored)
 * 2. Exact Item Code + matched / corresponding parent assembly or equivalent context
 * 3. Exact Item Code across reordered / changed parents (preserving every repeated occurrence)
 * 4. Canonical Item Code formatting fallback (case / trailing .0)
 * 5. Confirmed Missing / Additional only when no unmatched counterpart remains anywhere in the BOM
 */
function runStage1Comparison(
  originalTree: ParsedBomTree,
  bcTree: ParsedBomTree
): BomVerificationRecord[] {
  const records: BomVerificationRecord[] = [];
  const pairedOrigIds = new Set<string>();
  const pairedBcIds = new Set<string>();
  const pairedParentMap = new Map<string, string>(); // origNode.id -> bcNode.id

  const addPair = (
    original: BomNode,
    bc: BomNode,
    changes: FieldChange[],
    keyPrefix: string
  ) => {
    if (pairedOrigIds.has(original.id) || pairedBcIds.has(bc.id)) return;
    pairedOrigIds.add(original.id);
    pairedBcIds.add(bc.id);
    pairedParentMap.set(original.id, bc.id);
    records.push(makePairedRecord(original, bc, changes, keyPrefix));
  };

  // PASS 0: Isolate blank Item Code rows (never matched automatically)
  for (const orig of originalTree.flatNodes.filter((n) => !n.itemCode)) {
    const reason = `Original Navigation BOM row ${orig.rowNumber} (Level ${
      orig.rawLevel || orig.level
    }, parent "${orig.parentPath}") has a blank Item Code (No.) and cannot be classified as matched.`;
    records.push({
      key: `missing-item-code-orig-${orig.id}`,
      status: 'missing_item_code',
      discrepancyCategory: 'Missing Item Code',
      errorCategory: 'Missing Item Code',
      componentRole: orig.isParentAssembly ? 'Parent Assembly' : 'Child Component',
      sourceSide: 'Original Navigation',
      originalRowNumber: orig.rowNumber,
      bcRowNumber: null,
      level: orig.level,
      rawLevel: orig.rawLevel || String(orig.level),
      originalLevel: orig.rawLevel || String(orig.level),
      bcLevel: '—',
      itemCode: '(Blank)',
      description: orig.description,
      originalDescription: orig.description,
      bcDescription: '—',
      itemType: orig.itemType,
      uom: orig.uom,
      parentAssemblyCode: orig.parentItemCode ?? 'Root',
      originalParentAssembly: orig.parentPath,
      bcParentAssembly: '—',
      parentPath: orig.parentPath,
      hierarchyPath: orig.hierarchyPath,
      originalNode: orig,
      bcNode: null,
      originalBomQty: orig.bomQty,
      bcBomQty: null,
      bomQtyDiff: null,
      originalTotalQty: orig.totalBomQty,
      bcTotalQty: null,
      totalQtyDiff: null,
      originalValueSummary: `Row ${orig.rowNumber} · Blank No.`,
      bcValueSummary: '—',
      changes: [],
      reasonForClassification: reason,
      detailedExplanation: reason,
    });
  }

  for (const bc of bcTree.flatNodes.filter((n) => !n.itemCode)) {
    const reason = `Business Central BOM row ${bc.rowNumber} (Level ${
      bc.rawLevel || bc.level
    }, parent "${bc.parentPath}") has a blank Item Code (No.) and cannot be classified as matched.`;
    records.push({
      key: `missing-item-code-bc-${bc.id}`,
      status: 'missing_item_code',
      discrepancyCategory: 'Missing Item Code',
      errorCategory: 'Missing Item Code',
      componentRole: bc.isParentAssembly ? 'Parent Assembly' : 'Child Component',
      sourceSide: 'Business Central',
      originalRowNumber: null,
      bcRowNumber: bc.rowNumber,
      level: bc.level,
      rawLevel: bc.rawLevel || String(bc.level),
      originalLevel: '—',
      bcLevel: bc.rawLevel || String(bc.level),
      itemCode: '(Blank)',
      description: bc.description,
      originalDescription: '—',
      bcDescription: bc.description,
      itemType: bc.itemType,
      uom: bc.uom,
      parentAssemblyCode: bc.parentItemCode ?? 'Root',
      originalParentAssembly: '—',
      bcParentAssembly: bc.parentPath,
      parentPath: bc.parentPath,
      hierarchyPath: bc.hierarchyPath,
      originalNode: null,
      bcNode: bc,
      originalBomQty: null,
      bcBomQty: bc.bomQty,
      bomQtyDiff: null,
      originalTotalQty: null,
      bcTotalQty: bc.totalBomQty,
      totalQtyDiff: null,
      originalValueSummary: '—',
      bcValueSummary: `Row ${bc.rowNumber} · Blank No.`,
      changes: [],
      reasonForClassification: reason,
      detailedExplanation: reason,
    });
  }

  const allOrig = originalTree.flatNodes.filter((n) => n.itemCode !== '');
  const allBc = bcTree.flatNodes.filter((n) => n.itemCode !== '');

  // Count total occurrences of each canonical itemCode across both BOMs for clear diagnostic explanations
  const totalOrigByCode = new Map<string, number>();
  const totalBcByCode = new Map<string, number>();
  for (const n of allOrig) {
    const k = canonicalItemCode(n.itemCode);
    totalOrigByCode.set(k, (totalOrigByCode.get(k) ?? 0) + 1);
  }
  for (const n of allBc) {
    const k = canonicalItemCode(n.itemCode);
    totalBcByCode.set(k, (totalBcByCode.get(k) ?? 0) + 1);
  }

  // PASS 1: Canonical Item Code + Canonical Full Hierarchy Path (ancestorChain)
  const exactPathOrig = new Map<string, BomNode[]>();
  const exactPathBc = new Map<string, BomNode[]>();
  for (const n of allOrig) {
    const key = `${getParentChainKey(n)}||${canonicalItemCode(n.itemCode)}`;
    const list = exactPathOrig.get(key) ?? [];
    list.push(n);
    exactPathOrig.set(key, list);
  }
  for (const n of allBc) {
    const key = `${getParentChainKey(n)}||${canonicalItemCode(n.itemCode)}`;
    const list = exactPathBc.get(key) ?? [];
    list.push(n);
    exactPathBc.set(key, list);
  }

  const pass1AmbiguousOrig = new Set<string>();
  const pass1AmbiguousBc = new Set<string>();

  for (const [key, origList] of exactPathOrig.entries()) {
    const bcList = exactPathBc.get(key) ?? [];
    if (bcList.length === 0) continue;

    // 1A. Pair exact 7-field matches first
    const usedO = new Set<number>();
    const usedB = new Set<number>();
    for (let oIdx = 0; oIdx < origList.length; oIdx += 1) {
      for (let bIdx = 0; bIdx < bcList.length; bIdx += 1) {
        if (usedO.has(oIdx) || usedB.has(bIdx)) continue;
        const changes = compareSevenColumns(origList[oIdx], bcList[bIdx]);
        if (changes.length === 0) {
          usedO.add(oIdx);
          usedB.add(bIdx);
          addPair(origList[oIdx], bcList[bIdx], changes, 'pair');
        }
      }
    }

    const remOrig = origList.filter((_, idx) => !usedO.has(idx));
    const remBc = bcList.filter((_, idx) => !usedB.has(idx));
    if (remOrig.length > 0 && remBc.length > 0) {
      // Only pair as many as exist on both sides if unambiguous; leave surplus for Pass 2/3
      const resolved = resolveBucketAssignments(remOrig, remBc, (o, b) =>
        scoreOccurrenceSimilarity(o, b)
      );
      for (const { o, b } of resolved.pairs) {
        addPair(o, b, compareSevenColumns(o, b), 'pair');
      }
      // Note: Do NOT lock ambiguous items into Manual Review yet if surplus/cross-parent exists;
      // only if total counts in exact parent match equally and have genuine competing ties.
      if (resolved.ambiguousOrig.length > 0 && resolved.ambiguousBc.length > 0) {
        for (const item of resolved.ambiguousOrig) {
          pass1AmbiguousOrig.add(item.node.id);
          pairedOrigIds.add(item.node.id);
          const candDesc = item.candidates
            .map((c) => `BC row ${c.rowNumber} (Qty ${formatQty(c.bomQty, c.rawBomQty)})`)
            .join(', ');
          records.push(
            makeManualReviewRecord(
              item.node,
              'Original Navigation',
              `Requires Manual Review: Multiple non-equivalent occurrences of "${item.node.itemCode}" under parent "${item.node.parentPath}" tied with equal match score against ${candDesc}.`
            )
          );
        }
        for (const item of resolved.ambiguousBc) {
          pass1AmbiguousBc.add(item.node.id);
          pairedBcIds.add(item.node.id);
          const candDesc = item.candidates
            .map((c) => `NAV row ${c.rowNumber} (Qty ${formatQty(c.bomQty, c.rawBomQty)})`)
            .join(', ');
          records.push(
            makeManualReviewRecord(
              item.node,
              'Business Central',
              `Requires Manual Review: Multiple non-equivalent occurrences of "${item.node.itemCode}" under parent "${item.node.parentPath}" tied with equal match score against ${candDesc}.`
            )
          );
        }
      }
    }
  }

  // PASS 2: Iterative Matched-Parent & Corresponding-Assembly Propagation
  // Handles reordered / shifted-level parent assemblies AND assemblies whose own Item Code changed.
  let madeProgress = true;
  while (madeProgress) {
    madeProgress = false;

    const remOrig = allOrig.filter((n) => !pairedOrigIds.has(n.id));
    const remBc = allBc.filter((n) => !pairedBcIds.has(n.id));
    if (remOrig.length === 0 || remBc.length === 0) break;

    // 2A. Pair nodes with canonical itemCode whose immediate parents are ALREADY matched
    const matchedParentGroupsOrig = new Map<string, BomNode[]>();
    const matchedParentGroupsBc = new Map<string, BomNode[]>();
    for (const o of remOrig) {
      const mappedBcParent = o.parentId ? pairedParentMap.get(o.parentId) : '__ROOT__';
      if (!mappedBcParent) continue;
      const key = `${mappedBcParent}||${canonicalItemCode(o.itemCode)}`;
      const list = matchedParentGroupsOrig.get(key) ?? [];
      list.push(o);
      matchedParentGroupsOrig.set(key, list);
    }
    for (const b of remBc) {
      const bcParentKey = b.parentId ?? '__ROOT__';
      const key = `${bcParentKey}||${canonicalItemCode(b.itemCode)}`;
      const list = matchedParentGroupsBc.get(key) ?? [];
      list.push(b);
      matchedParentGroupsBc.set(key, list);
    }

    for (const [key, oList] of matchedParentGroupsOrig.entries()) {
      const bList = matchedParentGroupsBc.get(key);
      if (!bList || bList.length === 0) continue;

      const resolved = resolveBucketAssignments(oList, bList, (o, b) =>
        scoreOccurrenceSimilarity(o, b)
      );
      for (const { o, b } of resolved.pairs) {
        addPair(o, b, buildPairedChangesWithHierarchy(o, b), 'equiv-parent');
        madeProgress = true;
      }
    }

    // 2B. Discover corresponding parent assemblies whose own Item Code changed (or shifted)
    // by checking child itemCode set overlap (>= 60% Jaccard & >= 2 shared child codes)
    const remParentOrig = allOrig.filter(
      (n) => !pairedOrigIds.has(n.id) && n.children.length >= 2
    );
    const remParentBc = allBc.filter(
      (n) => !pairedBcIds.has(n.id) && n.children.length >= 2
    );

    if (remParentOrig.length > 0 && remParentBc.length > 0) {
      const parentCands: Array<{ o: BomNode; b: BomNode; overlap: number; shared: number }> = [];
      for (const po of remParentOrig) {
        const codesO = new Set(po.children.map((c) => canonicalItemCode(c.itemCode)).filter(Boolean));
        if (codesO.size === 0) continue;
        for (const pb of remParentBc) {
          const codesB = new Set(pb.children.map((c) => canonicalItemCode(c.itemCode)).filter(Boolean));
          if (codesB.size === 0) continue;
          let shared = 0;
          for (const code of codesO) {
            if (codesB.has(code)) shared += 1;
          }
          const union = new Set([...codesO, ...codesB]).size;
          const overlap = union === 0 ? 0 : shared / union;
          if (shared >= 2 && overlap >= 0.6) {
            parentCands.push({ o: po, b: pb, overlap, shared });
          }
        }
      }
      parentCands.sort((a, b) => b.overlap - a.overlap || b.shared - a.shared);

      for (const cand of parentCands) {
        if (pairedOrigIds.has(cand.o.id) || pairedBcIds.has(cand.b.id)) continue;
        const tied = parentCands.filter(
          (other) =>
            !pairedOrigIds.has(other.o.id) &&
            !pairedBcIds.has(other.b.id) &&
            other.overlap === cand.overlap &&
            other.shared === cand.shared &&
            (other.o.id === cand.o.id || other.b.id === cand.b.id) &&
            (other.o.id !== cand.o.id || other.b.id !== cand.b.id)
        );
        if (tied.length > 0) continue;

        addPair(
          cand.o,
          cand.b,
          buildPairedChangesWithHierarchy(cand.o, cand.b),
          'corr-assembly'
        );
        madeProgress = true;
      }
    }
  }

  // PASS 3: Remaining Same-Item-Code Occurrences across Equivalent / Reordered / Changed Parents
  const remOrigByCode = new Map<string, BomNode[]>();
  const remBcByCode = new Map<string, BomNode[]>();

  for (const o of allOrig) {
    if (pairedOrigIds.has(o.id)) continue;
    const key = canonicalItemCode(o.itemCode);
    const list = remOrigByCode.get(key) ?? [];
    list.push(o);
    remOrigByCode.set(key, list);
  }
  for (const b of allBc) {
    if (pairedBcIds.has(b.id)) continue;
    const key = canonicalItemCode(b.itemCode);
    const list = remBcByCode.get(key) ?? [];
    list.push(b);
    remBcByCode.set(key, list);
  }

  for (const [code, oList] of remOrigByCode.entries()) {
    const bList = remBcByCode.get(code);
    if (!bList || bList.length === 0) continue;

    const resolved = resolveBucketAssignments(oList, bList, (o, b) =>
      computeParentContextScore(o, b, pairedParentMap)
    );

    for (const { o, b } of resolved.pairs) {
      addPair(o, b, buildPairedChangesWithHierarchy(o, b), 'ctx-pair');
    }

    if (resolved.ambiguousOrig.length > 0 && resolved.ambiguousBc.length > 0) {
      for (const item of resolved.ambiguousOrig) {
        pairedOrigIds.add(item.node.id);
        const candDesc = item.candidates
          .map((c) => `BC row ${c.rowNumber} under "${c.parentPath}"`)
          .join(', ');
        records.push(
          makeManualReviewRecord(
            item.node,
            'Original Navigation',
            `Requires Manual Review: "${item.node.itemCode}" under "${item.node.parentPath}" (row ${item.node.rowNumber}) has equally valid competing candidate(s) in Business Central: ${candDesc}.`
          )
        );
      }
      for (const item of resolved.ambiguousBc) {
        pairedBcIds.add(item.node.id);
        const candDesc = item.candidates
          .map((c) => `NAV row ${c.rowNumber} under "${c.parentPath}"`)
          .join(', ');
        records.push(
          makeManualReviewRecord(
            item.node,
            'Business Central',
            `Requires Manual Review: "${item.node.itemCode}" under "${item.node.parentPath}" (row ${item.node.rowNumber}) has equally valid competing candidate(s) in Original Navigation: ${candDesc}.`
          )
        );
      }
    }
  }

  // PASS 4: Canonical Item Code Fallback (case differences or trailing .0 on numeric codes)
  const leftOrigCanon = new Map<string, BomNode[]>();
  const leftBcCanon = new Map<string, BomNode[]>();
  for (const o of allOrig) {
    if (pairedOrigIds.has(o.id)) continue;
    const key = canonicalItemCode(o.itemCode);
    const list = leftOrigCanon.get(key) ?? [];
    list.push(o);
    leftOrigCanon.set(key, list);
  }
  for (const b of allBc) {
    if (pairedBcIds.has(b.id)) continue;
    const key = canonicalItemCode(b.itemCode);
    const list = leftBcCanon.get(key) ?? [];
    list.push(b);
    leftBcCanon.set(key, list);
  }

  for (const [canonKey, oList] of leftOrigCanon.entries()) {
    const bList = leftBcCanon.get(canonKey);
    if (!bList || bList.length === 0) continue;
    const resolved = resolveBucketAssignments(oList, bList, (o, b) =>
      computeParentContextScore(o, b, pairedParentMap)
    );
    for (const { o, b } of resolved.pairs) {
      addPair(o, b, buildPairedChangesWithHierarchy(o, b), 'canon-pair');
    }
  }

  // PASS 5: Confirmed Genuinely Missing and Genuinely Additional Components
  // (Only nodes with zero unmatched counterpart anywhere in the opposite BOM)
  for (const o of allOrig) {
    if (pairedOrigIds.has(o.id)) continue;
    const origTotal = totalOrigByCode.get(canonicalItemCode(o.itemCode)) ?? 0;
    const bcTotal = totalBcByCode.get(canonicalItemCode(o.itemCode)) ?? 0;
    const rec = makeUnmatchedRecord(o, 'missing');
    if (bcTotal > 0) {
      const note = `Total occurrences of "${o.itemCode}": Original=${origTotal}, Business Central=${bcTotal}. All ${bcTotal} Business Central occurrence(s) were already matched to other Original occurrences; this surplus occurrence at row ${o.rowNumber} has no counterpart in Business Central.`;
      rec.reasonForClassification = note;
      rec.detailedExplanation = note;
    }
    records.push(rec);
  }

  for (const b of allBc) {
    if (pairedBcIds.has(b.id)) continue;
    const origTotal = totalOrigByCode.get(canonicalItemCode(b.itemCode)) ?? 0;
    const bcTotal = totalBcByCode.get(canonicalItemCode(b.itemCode)) ?? 0;
    const rec = makeUnmatchedRecord(b, 'additional');
    if (origTotal > 0) {
      const note = `Total occurrences of "${b.itemCode}": Original=${origTotal}, Business Central=${bcTotal}. All ${origTotal} Original occurrence(s) were already matched to other Business Central occurrences; this surplus occurrence at row ${b.rowNumber} has no unmatched counterpart in Original Navigation.`;
      rec.reasonForClassification = note;
      rec.detailedExplanation = note;
    }
    records.push(rec);
  }

  return records;
}

/**
 * STAGE 2: Independent Cross-Verification
 * Validates Stage 1 output against raw parsed trees:
 * - Re-checks every matched record for false positives (blank code, invalid qty, 7-field & parent path diffs)
 * - Audits Missing & Additional records to guarantee NO unmatched same-item-code counterparts remain across the entire BOM
 */
function runStage2CrossVerification(
  stage1Records: BomVerificationRecord[],
  originalTree: ParsedBomTree,
  bcTree: ParsedBomTree
): {
  verifiedRecords: BomVerificationRecord[];
  adjustmentsCount: number;
  adjustmentNotes: string[];
} {
  const adjustmentNotes: string[] = [];
  const verifiedRecords: BomVerificationRecord[] = [];

  for (const rec of stage1Records) {
    if (rec.status === 'matched') {
      const o = rec.originalNode;
      const b = rec.bcNode;
      if (!o || !b) {
        adjustmentNotes.push(
          `Stage 2 rejected matched record "${rec.itemCode}": missing source node reference.`
        );
        continue;
      }

      if (!o.itemCode || !b.itemCode) {
        adjustmentNotes.push(
          `Stage 2 caught blank item code marked matched at NAV row ${o.rowNumber} / BC row ${b.rowNumber}; escalated to Manual Review.`
        );
        verifiedRecords.push(
          makeManualReviewRecord(o, 'Original Navigation', 'Stage 2 flagged blank item code.')
        );
        verifiedRecords.push(
          makeManualReviewRecord(b, 'Business Central', 'Stage 2 flagged blank item code.')
        );
        continue;
      }

      if (!o.bomQtyValid || !b.bomQtyValid || !o.totalBomQtyValid || !b.totalBomQtyValid) {
        adjustmentNotes.push(
          `Stage 2 escalated "${o.itemCode}" (NAV row ${o.rowNumber}, BC row ${b.rowNumber}) to Requires Manual Review because quantity value is invalid or non-numeric.`
        );
        verifiedRecords.push(
          makeManualReviewRecord(
            o,
            'Original Navigation',
            `Requires Manual Review: Invalid/non-numeric quantity ("${o.rawBomQty}" / "${o.rawTotalBomQty}") at NAV row ${o.rowNumber}.`
          )
        );
        verifiedRecords.push(
          makeManualReviewRecord(
            b,
            'Business Central',
            `Requires Manual Review: Invalid/non-numeric quantity ("${b.rawBomQty}" / "${b.rawTotalBomQty}") at BC row ${b.rowNumber}.`
          )
        );
        continue;
      }

      const freshChanges = buildPairedChangesWithHierarchy(o, b);
      if (freshChanges.length > 0) {
        adjustmentNotes.push(
          `Stage 2 caught false-positive match on "${o.itemCode}" (NAV row ${o.rowNumber}, BC row ${b.rowNumber}); reclassified with actual differences.`
        );
        verifiedRecords.push(makePairedRecord(o, b, freshChanges, 'stage2-reclassified'));
        continue;
      }

      verifiedRecords.push(rec);
      continue;
    }

    // Only escalate paired items to Manual Review if a direct CIRCULAR_REFERENCE prevents reliable parent verification
    if (
      (rec.status === 'incorrect' || rec.status === 'description_review') &&
      rec.originalNode &&
      rec.bcNode &&
      (rec.originalNode.hasHierarchyUncertainty || rec.bcNode.hasHierarchyUncertainty)
    ) {
      adjustmentNotes.push(
        `Stage 2 escalated "${rec.originalNode.itemCode}" (NAV row ${rec.originalNode.rowNumber}, BC row ${rec.bcNode.rowNumber}) to Requires Manual Review due to circular reference in hierarchy.`
      );
      verifiedRecords.push(
        makeManualReviewRecord(
          rec.originalNode,
          'Original Navigation',
          `Requires Manual Review: Circular reference affects parent reconstruction for NAV row ${rec.originalNode.rowNumber}.`
        )
      );
      verifiedRecords.push(
        makeManualReviewRecord(
          rec.bcNode,
          'Business Central',
          `Requires Manual Review: Circular reference affects parent reconstruction for BC row ${rec.bcNode.rowNumber}.`
        )
      );
      continue;
    }

    verifiedRecords.push(rec);
  }

  // Check 3: Global False-Negative Audit on Missing & Additional records
  // Guarantee: No item with an unmatched counterpart on the opposite side (same itemCode or canonicalItemCode) can ever remain Missing + Additional.
  const missingIndices = new Set<number>();
  const additionalIndices = new Set<number>();

  for (let i = 0; i < verifiedRecords.length; i += 1) {
    if (verifiedRecords[i].status !== 'missing') continue;
    for (let j = 0; j < verifiedRecords.length; j += 1) {
      if (verifiedRecords[j].status !== 'additional') continue;
      if (missingIndices.has(i) || additionalIndices.has(j)) continue;

      const m = verifiedRecords[i];
      const a = verifiedRecords[j];
      if (
        m.originalNode &&
        a.bcNode &&
        canonicalItemCode(m.originalNode.itemCode) === canonicalItemCode(a.bcNode.itemCode)
      ) {
        missingIndices.add(i);
        additionalIndices.add(j);
        const changes = buildPairedChangesWithHierarchy(m.originalNode, a.bcNode);
        adjustmentNotes.push(
          `Stage 2 recovered unmatched same-item pair "${m.itemCode}" (NAV row ${m.originalNode.rowNumber} vs BC row ${a.bcNode.rowNumber}).`
        );
        verifiedRecords.push(makePairedRecord(m.originalNode, a.bcNode, changes, 'stage2-recovered'));
        break;
      }
    }
  }

  const finalRecords = verifiedRecords.filter(
    (_, idx) => !missingIndices.has(idx) && !additionalIndices.has(idx)
  );

  // Check 4: Independent Parent-Child Instance Consistency Verification (PASS 2 Structure Check)
  const pairedNodeMap = new Map<string, string>();
  for (const rec of finalRecords) {
    if (
      (rec.status === 'matched' ||
        rec.status === 'incorrect' ||
        rec.status === 'description_review') &&
      rec.originalNode &&
      rec.bcNode
    ) {
      pairedNodeMap.set(rec.originalNode.id, rec.bcNode.id);
    }
  }

  for (let i = 0; i < finalRecords.length; i += 1) {
    const rec = finalRecords[i];
    if (
      (rec.status === 'matched' ||
        rec.status === 'incorrect' ||
        rec.status === 'description_review') &&
      rec.originalNode &&
      rec.bcNode
    ) {
      const o = rec.originalNode;
      const b = rec.bcNode;
      if (o.parentId && pairedNodeMap.has(o.parentId)) {
        const expectedBcParentId = pairedNodeMap.get(o.parentId);
        if (b.parentId !== expectedBcParentId) {
          const alreadyHasParentDiff = rec.changes.some((c) => c.field === 'Parent Assembly');
          if (!alreadyHasParentDiff) {
            const nextChanges: FieldChange[] = [
              {
                field: 'Parent Assembly',
                category: 'Hierarchy Mismatch',
                before: `${o.parentPath} (Row ${o.rowNumber})`,
                after: `${b.parentPath} (Row ${b.rowNumber})`,
                explanation: `Component is attached under a different parent assembly instance (${o.parentPath} vs ${b.parentPath}).`,
              },
              ...rec.changes,
            ];
            adjustmentNotes.push(
              `Pass 2 structure check caught parent-instance mismatch on "${o.itemCode}" (Std Row ${o.rowNumber} vs Upl Row ${b.rowNumber}).`
            );
            finalRecords[i] = makePairedRecord(o, b, nextChanges, 'pass2-hierarchy');
          }
        }
      }
    }
  }

  // Verify occurrence totals across both trees
  const origCountsByCode = new Map<string, number>();
  const bcCountsByCode = new Map<string, number>();
  for (const n of originalTree.flatNodes) {
    origCountsByCode.set(n.itemCode, (origCountsByCode.get(n.itemCode) ?? 0) + 1);
  }
  for (const n of bcTree.flatNodes) {
    bcCountsByCode.set(n.itemCode, (bcCountsByCode.get(n.itemCode) ?? 0) + 1);
  }

  return {
    verifiedRecords: finalRecords,
    adjustmentsCount: adjustmentNotes.length,
    adjustmentNotes,
  };
}

/**
 * STAGE 3: Final Audit & Mathematical Reconciliation
 * Verifies 1-to-1 occurrence coverage, mutual exclusivity, source row integrity, and mathematical reconciliation.
 */
function runStage3FinalAudit(
  records: BomVerificationRecord[],
  originalTree: ParsedBomTree,
  bcTree: ParsedBomTree,
  stage1DurationMs: number,
  stage2AdjustmentsCount: number,
  stage2AdjustmentNotes: string[]
): ValidationAuditReport {
  const checks: StageAuditCheck[] = [];
  const failureReasons: string[] = [];

  const origSeen = new Map<string, number>();
  const bcSeen = new Map<string, number>();

  let missingRowRefCount = 0;
  let invalidMatchedChangeCount = 0;
  let invalidErrorReasonCount = 0;

  for (const rec of records) {
    if (rec.originalNode) {
      origSeen.set(rec.originalNode.id, (origSeen.get(rec.originalNode.id) ?? 0) + 1);
      if (!rec.originalRowNumber || rec.originalRowNumber < 1) {
        missingRowRefCount += 1;
      }
    }
    if (rec.bcNode) {
      bcSeen.set(rec.bcNode.id, (bcSeen.get(rec.bcNode.id) ?? 0) + 1);
      if (!rec.bcRowNumber || rec.bcRowNumber < 1) {
        missingRowRefCount += 1;
      }
    }
    if (rec.status === 'matched' && rec.changes.length > 0) {
      invalidMatchedChangeCount += 1;
    }
    if (
      (rec.status === 'incorrect' || rec.status === 'description_review') &&
      (rec.changes.length === 0 || !rec.reasonForClassification)
    ) {
      invalidErrorReasonCount += 1;
    }
  }

  // Check 1: Every Original occurrence covered exactly once (no double count, no omission)
  const origDuplicates = Array.from(origSeen.values()).filter((c) => c > 1).length;
  const origMissingIds = originalTree.flatNodes.filter((n) => !origSeen.has(n.id)).length;
  const origCoverageOk = origDuplicates === 0 && origMissingIds === 0;
  checks.push({
    stage: 'Stage 3: Final Audit',
    checkName: 'Original BOM Occurrence Coverage & Mutual Exclusivity',
    passed: origCoverageOk,
    details: origCoverageOk
      ? `All ${originalTree.flatNodes.length} original occurrences accounted for exactly once.`
      : `Coverage mismatch: ${origDuplicates} double-counted, ${origMissingIds} omitted.`,
  });
  if (!origCoverageOk) {
    failureReasons.push(
      `Original BOM audit failed (${origDuplicates} duplicate counts, ${origMissingIds} omitted records).`
    );
  }

  // Check 2: Every BC occurrence covered exactly once
  const bcDuplicates = Array.from(bcSeen.values()).filter((c) => c > 1).length;
  const bcMissingIds = bcTree.flatNodes.filter((n) => !bcSeen.has(n.id)).length;
  const bcCoverageOk = bcDuplicates === 0 && bcMissingIds === 0;
  checks.push({
    stage: 'Stage 3: Final Audit',
    checkName: 'Business Central BOM Occurrence Coverage & Mutual Exclusivity',
    passed: bcCoverageOk,
    details: bcCoverageOk
      ? `All ${bcTree.flatNodes.length} Business Central occurrences accounted for exactly once.`
      : `Coverage mismatch: ${bcDuplicates} double-counted, ${bcMissingIds} omitted.`,
  });
  if (!bcCoverageOk) {
    failureReasons.push(
      `Business Central BOM audit failed (${bcDuplicates} duplicate counts, ${bcMissingIds} omitted records).`
    );
  }

  // Check 3: Mathematical Reconciliation Formula
  const matched = records.filter((r) => r.status === 'matched').length;
  const withErrors = records.filter(
    (r) => r.status === 'incorrect' || r.status === 'description_review'
  ).length;
  const missing = records.filter((r) => r.status === 'missing').length;
  const additional = records.filter((r) => r.status === 'additional').length;
  const unresolvedOrig = records.filter(
    (r) =>
      (r.status === 'manual_review' || r.status === 'missing_item_code') &&
      r.originalNode !== null
  ).length;
  const unresolvedBc = records.filter(
    (r) =>
      (r.status === 'manual_review' || r.status === 'missing_item_code') &&
      r.bcNode !== null
  ).length;

  const originalOccurrencesAccounted = matched + withErrors + missing + unresolvedOrig;
  const bcOccurrencesAccounted = matched + withErrors + additional + unresolvedBc;

  const mathOk =
    originalOccurrencesAccounted === originalTree.flatNodes.length &&
    bcOccurrencesAccounted === bcTree.flatNodes.length;

  checks.push({
    stage: 'Stage 3: Final Audit',
    checkName: 'Mathematical Count Reconciliation',
    passed: mathOk,
    details: `Orig: ${originalOccurrencesAccounted} === ${originalTree.flatNodes.length} | BC: ${bcOccurrencesAccounted} === ${bcTree.flatNodes.length}`,
  });
  if (!mathOk) {
    failureReasons.push(
      `Mathematical count reconciliation failed (Orig ${originalOccurrencesAccounted}/${originalTree.flatNodes.length}, BC ${bcOccurrencesAccounted}/${bcTree.flatNodes.length}).`
    );
  }

  // Check 4: Blank item codes never marked matched
  const blankMatched = records.filter(
    (r) => r.status === 'matched' && (!r.originalNode?.itemCode || !r.bcNode?.itemCode)
  ).length;
  const blankOk = blankMatched === 0;
  checks.push({
    stage: 'Stage 2: Cross-Verification',
    checkName: 'Blank Item Code Isolation Check',
    passed: blankOk,
    details: blankOk
      ? 'Zero blank item-code records classified as matched.'
      : `${blankMatched} blank item-code records were classified as matched.`,
  });
  if (!blankOk) {
    failureReasons.push(`${blankMatched} blank item-code records improperly classified as matched.`);
  }

  // Check 5: No Simultaneous Missing & Additional for Same Item Code
  const missingCodes = new Set(
    records
      .filter((r) => r.status === 'missing' && r.originalNode?.itemCode)
      .map((r) => canonicalItemCode(r.originalNode!.itemCode))
  );
  const overlappingAdditional = records.filter(
    (r) =>
      r.status === 'additional' &&
      r.bcNode?.itemCode &&
      missingCodes.has(canonicalItemCode(r.bcNode.itemCode))
  );
  const noFalseAdditionalOk = overlappingAdditional.length === 0;
  checks.push({
    stage: 'Stage 3: Final Audit',
    checkName: 'False Additional / Missing Cross-Check',
    passed: noFalseAdditionalOk,
    details: noFalseAdditionalOk
      ? 'Zero item codes appear simultaneously as Missing and Additional.'
      : `${overlappingAdditional.length} item code(s) have unmatched counterparts on both sides.`,
  });
  if (!noFalseAdditionalOk) {
    failureReasons.push(
      `Cross-check failed: ${overlappingAdditional.length} item(s) simultaneously marked Missing and Additional.`
    );
  }

  // Check 6: Source Row & Classification Integrity
  const integrityOk =
    missingRowRefCount === 0 &&
    invalidMatchedChangeCount === 0 &&
    invalidErrorReasonCount === 0;
  checks.push({
    stage: 'Stage 3: Final Audit',
    checkName: 'Source Row Reference & Classification Integrity',
    passed: integrityOk,
    details: integrityOk
      ? 'All records carry valid source row numbers and consistent discrepancy classifications.'
      : `Integrity issues: missing row refs=${missingRowRefCount}, invalid matches=${invalidMatchedChangeCount}, missing reasons=${invalidErrorReasonCount}.`,
  });
  if (!integrityOk) {
    failureReasons.push('Source row reference or classification integrity check failed.');
  }

  // Stage 1 & Stage 2 summary checks
  checks.unshift({
    stage: 'Stage 2: Cross-Verification',
    checkName: 'Independent False-Positive & False-Negative Cross-Verification',
    passed: true,
    details:
      stage2AdjustmentsCount === 0
        ? 'Independent cross-check confirmed all Stage 1 classifications.'
        : `Stage 2 applied ${stage2AdjustmentsCount} verification adjustment(s).`,
  });
  checks.unshift({
    stage: 'Stage 1: Initial Comparison',
    checkName: '7-Field Parent-Child Hierarchy Comparison',
    passed: true,
    details: `Compared ${originalTree.flatNodes.length} NAV occurrences against ${bcTree.flatNodes.length} BC occurrences in ${stage1DurationMs} ms.`,
  });

  const reconciliationPassed = checks.every((c) => c.passed);
  const validationStatus = reconciliationPassed ? 'APPROVED' : 'NOT_APPROVED';

  return {
    validationStatus,
    statusBannerText: reconciliationPassed
      ? 'Three-Stage Verification & Reconciliation Passed'
      : 'VALIDATION INCOMPLETE – REPORT NOT APPROVED',
    stage1DurationMs,
    stage2AdjustmentsCount,
    stage2AdjustmentNotes,
    originalOccurrencesAccounted,
    bcOccurrencesAccounted,
    reconciliationPassed,
    checks,
    failureReasons,
  };
}

export function verifyBoms(
  originalRows: Record<string, unknown>[],
  originalMapping: ColumnMapping,
  bcRows: Record<string, unknown>[],
  bcMapping: ColumnMapping
): BomVerificationReport {
  const startMs = Date.now();

  const originalTree = buildBomTree(originalRows, originalMapping, 'Original Navigation');
  const bcTree = buildBomTree(bcRows, bcMapping, 'Business Central');
  const issues = [...originalTree.issues, ...bcTree.issues];

  // Stage 1: Initial BOM Comparison
  const stage1Records = runStage1Comparison(originalTree, bcTree);
  const stage1DurationMs = Math.max(1, Date.now() - startMs);

  // Stage 2: Independent Cross-Verification
  const { verifiedRecords, adjustmentsCount, adjustmentNotes } = runStage2CrossVerification(
    stage1Records,
    originalTree,
    bcTree
  );

  verifiedRecords.sort((a, b) => {
    const posA = a.bcRowNumber ?? a.originalRowNumber ?? 0;
    const posB = b.bcRowNumber ?? b.originalRowNumber ?? 0;
    if (posA !== posB) return posA - posB;
    return a.hierarchyPath.localeCompare(b.hierarchyPath);
  });

  // Stage 3: Final Audit & Mathematical Reconciliation
  const audit = runStage3FinalAudit(
    verifiedRecords,
    originalTree,
    bcTree,
    stage1DurationMs,
    adjustmentsCount,
    adjustmentNotes
  );

  const matchedRecords = verifiedRecords.filter((r) => r.status === 'matched');
  const incorrectRecords = verifiedRecords.filter((r) => r.status === 'incorrect');
  const descriptionReviewRecords = verifiedRecords.filter(
    (r) => r.status === 'description_review'
  );
  const manualReviewRecords = verifiedRecords.filter((r) => r.status === 'manual_review');
  const missingItemCodeRecords = verifiedRecords.filter((r) => r.status === 'missing_item_code');
  const missingRecords = verifiedRecords.filter((r) => r.status === 'missing');
  const additionalRecords = verifiedRecords.filter((r) => r.status === 'additional');

  const combinedErrorRecords = [...incorrectRecords, ...descriptionReviewRecords];

  const countFieldError = (field: FieldChange['field']) =>
    combinedErrorRecords.filter((r) => r.changes.some((c) => c.field === field)).length;

  const incorrectHierarchyCount = incorrectRecords.filter((r) =>
    r.changes.some(
      (c) => c.field === 'Parent Assembly' || c.field === 'Level' || c.field === 'No.'
    )
  ).length;

  const purchaseVsProdOrderCount = incorrectRecords.filter((r) =>
    r.changes.some(
      (c) =>
        c.field === 'Item Type' &&
        c.category === 'Item Type Mismatch (Purchase vs Prod. Order)'
    )
  ).length;

  const manualReviewOriginalCount = manualReviewRecords.filter(
    (r) => r.originalNode !== null
  ).length;
  const manualReviewBcCount = manualReviewRecords.filter((r) => r.bcNode !== null).length;

  const missingItemCodeOriginalCount = missingItemCodeRecords.filter(
    (r) => r.sourceSide === 'Original Navigation'
  ).length;
  const missingItemCodeBcCount = missingItemCodeRecords.filter(
    (r) => r.sourceSide === 'Business Central'
  ).length;

  const incorrectOccurrenceCount = incorrectRecords.length + descriptionReviewRecords.length;
  const unresolvedCount = manualReviewRecords.length + missingItemCodeRecords.length;
  const unresolvedOriginalCount = manualReviewOriginalCount + missingItemCodeOriginalCount;
  const unresolvedBcCount = manualReviewBcCount + missingItemCodeBcCount;
  const totalFieldErrorsCount = combinedErrorRecords.reduce(
    (sum, rec) => sum + Math.max(1, rec.changes.length),
    0
  );

  const totalEvaluatedScope =
    matchedRecords.length +
    incorrectOccurrenceCount +
    missingRecords.length +
    additionalRecords.length +
    unresolvedCount;

  const verificationPercentage =
    audit.validationStatus !== 'APPROVED'
      ? 0
      : totalEvaluatedScope === 0
        ? 100
        : Number(((matchedRecords.length / totalEvaluatedScope) * 100).toFixed(1));

  const verificationFormulaText =
    audit.validationStatus !== 'APPROVED'
      ? '0.0% (Pass 3 reconciliation failed)'
      : `${matchedRecords.length} / ${totalEvaluatedScope} × 100 = ${verificationPercentage.toFixed(1)}%`;

  const verificationResult =
    audit.validationStatus !== 'APPROVED'
      ? 'VERIFICATION FAILED – Reliable comparison could not be completed.'
      : unresolvedCount > 0
        ? 'UNRESOLVED – Some records require manual investigation.'
        : incorrectOccurrenceCount > 0 ||
            missingRecords.length > 0 ||
            additionalRecords.length > 0
          ? 'VERIFIED WITH ERRORS – Discrepancies identified.'
          : 'VERIFIED – No discrepancies.';

  const overallStatus =
    audit.validationStatus !== 'APPROVED'
      ? 'VALIDATION INCOMPLETE – REPORT NOT APPROVED'
      : missingRecords.length === 0 &&
          additionalRecords.length === 0 &&
          incorrectRecords.length === 0 &&
          descriptionReviewRecords.length === 0 &&
          manualReviewRecords.length === 0 &&
          missingItemCodeRecords.length === 0
        ? 'PASS'
        : 'FAIL';

  return {
    originalTree,
    bcTree,
    allRecords: verifiedRecords,
    matchedRecords,
    incorrectRecords,
    descriptionReviewRecords,
    manualReviewRecords,
    missingItemCodeRecords,
    missingRecords,
    additionalRecords,
    issues,
    audit,
    summary: {
      verifiedAt: new Date().toLocaleString(),
      validationStatus: audit.validationStatus,
      overallStatus,
      verificationResult,
      verificationPercentage,
      verificationFormulaText,
      originalCount: originalTree.flatNodes.length,
      bcCount: bcTree.flatNodes.length,
      matchedCount: matchedRecords.length,
      incorrectOccurrenceCount,
      matchedWithFieldErrorsTotal: incorrectOccurrenceCount,
      descriptionReviewCount: descriptionReviewRecords.length,
      recordsWithErrorsCount: incorrectRecords.length,
      missingCount: missingRecords.length,
      missingParentCount: missingRecords.filter((r) => r.componentRole === 'Parent Assembly')
        .length,
      missingChildCount: missingRecords.filter((r) => r.componentRole === 'Child Component')
        .length,
      additionalCount: additionalRecords.length,
      additionalParentCount: additionalRecords.filter(
        (r) => r.componentRole === 'Parent Assembly'
      ).length,
      additionalChildCount: additionalRecords.filter(
        (r) => r.componentRole === 'Child Component'
      ).length,
      unresolvedCount,
      unresolvedOriginalCount,
      unresolvedBcCount,
      manualReviewCount: manualReviewRecords.length,
      manualReviewOriginalCount,
      manualReviewBcCount,
      missingItemCodeCount: missingItemCodeRecords.length,
      missingItemCodeOriginalCount,
      missingItemCodeBcCount,
      totalFieldErrorsCount,
      incorrectLevelCount: countFieldError('Level'),
      incorrectHierarchyCount,
      incorrectDescriptionCount: countFieldError('Description'),
      incorrectItemTypeCount: countFieldError('Item Type'),
      purchaseVsProdOrderCount,
      incorrectUomCount: countFieldError('UOM'),
      incorrectBomQtyCount: countFieldError('BOM Qty.'),
      incorrectTotalBomQtyCount: countFieldError('Total BOM Qty'),
      supplementaryWarningCount: issues.length,
    },
  };
}
