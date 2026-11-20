import type {
  BomNode,
  BomValidationIssue,
  BomVerificationRecord,
  BomVerificationReport,
  ColumnMapping,
  FieldChange,
  ParsedBomTree,
} from '../types/bom';

function normalizeTextPreserveCase(val: unknown): string {
  return String(val ?? '')
    .replace(/\u00a0/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function parseLevelValue(raw: unknown): { numeric: number; rawText: string } {
  const text = normalizeTextPreserveCase(raw);
  if (!text) {
    return { numeric: 0, rawText: '0' };
  }

  if (/^\d+(\.\d+)+$/.test(text)) {
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

function numbersMatch(a: number | null, b: number | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return Math.abs(a - b) < 1e-9;
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

  const rawLevels = rows.map((r) =>
    mapping.level ? parseLevelValue(r[mapping.level]) : { numeric: 0, rawText: '0' }
  );
  const minLevel = rawLevels.reduce((min, item) => Math.min(min, item.numeric), Infinity);
  const baseOffset = Number.isFinite(minLevel) ? minLevel : 0;

  const ancestorStack: BomNode[] = [];
  let maxDepth = 0;

  rows.forEach((row, index) => {
    const rowNumber = typeof row.__rowNumber === 'number' ? row.__rowNumber : index + 2;

    const itemCode = mapping.itemCode ? normalizeTextPreserveCase(row[mapping.itemCode]) : '';
    const parsedLvl = mapping.level
      ? parseLevelValue(row[mapping.level])
      : { numeric: 0, rawText: '0' };
    const normalizedLevel = Math.max(0, parsedLvl.numeric - baseOffset);

    const description = mapping.description
      ? normalizeTextPreserveCase(row[mapping.description])
      : '';
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

    // Determine effective level & parent context first so all warnings carry accurate parent/level
    let effectiveLevel = normalizedLevel;
    const expectedParentStack = ancestorStack.slice(0, Math.min(normalizedLevel, ancestorStack.length));
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

    if (
      mapping.bomQty &&
      (!bomQtyParsed.valid || (bomQtyParsed.value !== null && bomQtyParsed.value <= 0))
    ) {
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

    if (
      mapping.totalBomQty &&
      totalBomQtyParsed.rawText !== '' &&
      (!totalBomQtyParsed.valid ||
        (totalBomQtyParsed.value !== null && totalBomQtyParsed.value <= 0))
    ) {
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

    if (itemCode && ancestorStack.some((anc) => anc.itemCode === itemCode)) {
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
      level: effectiveLevel,
      rawLevel: parsedLvl.rawText,
      itemCode,
      description,
      itemType,
      uom,
      bomQty: bomQtyParsed.value,
      rawBomQty: bomQtyParsed.rawText,
      totalBomQty: resolvedTotalQty,
      rawTotalBomQty: resolvedRawTotalQty,
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
  return node.ancestorChain.length === 0 ? '__ROOT__' : node.ancestorChain.join(' > ');
}

function compareSevenColumns(original: BomNode, bc: BomNode): FieldChange[] {
  const changes: FieldChange[] = [];

  // 1. Level
  if (original.level !== bc.level || original.rawLevel !== bc.rawLevel) {
    changes.push({
      field: 'Level',
      category: 'Incorrect Level',
      before: original.rawLevel || String(original.level),
      after: bc.rawLevel || String(bc.level),
      explanation: `BOM Level mismatch: Navigation "${original.rawLevel || original.level}" vs Business Central "${bc.rawLevel || bc.level}".`,
    });
  }

  // 2. No. (Item Code)
  if (original.itemCode !== bc.itemCode) {
    changes.push({
      field: 'No.',
      category: 'Incorrect Item Code',
      before: original.itemCode || '—',
      after: bc.itemCode || '—',
      explanation: `Item Code mismatch: expected "${original.itemCode || '—'}", found "${bc.itemCode || '—'}".`,
    });
  }

  // 3. Description (exact meaningful comparison after whitespace trimming/collapsing)
  if (original.description !== bc.description) {
    changes.push({
      field: 'Description',
      category: 'Description Differences – Review Required',
      before: original.description || '—',
      after: bc.description || '—',
      explanation: `Description difference requires engineering review: Navigation "${original.description || '—'}" vs Business Central "${bc.description || '—'}".`,
    });
  }

  // 4. Item Type (explicitly distinguish Purchase vs Prod. Order mismatches)
  if (original.itemType !== bc.itemType) {
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
        ? `Item Type mismatch (Purchase vs Prod. Order): Navigation "${original.itemType || '—'}" vs Business Central "${bc.itemType || '—'}".`
        : `Item Type mismatch: Navigation "${original.itemType || '—'}" vs Business Central "${bc.itemType || '—'}".`,
    });
  }

  // 5. UOM
  if (original.uom !== bc.uom) {
    changes.push({
      field: 'UOM',
      category: 'Incorrect UOM',
      before: original.uom || '—',
      after: bc.uom || '—',
      explanation: `UOM mismatch: Navigation "${original.uom || '—'}" vs Business Central "${bc.uom || '—'}".`,
    });
  }

  // 6. BOM Qty.
  const bomQtyEqual =
    original.bomQty !== null && bc.bomQty !== null
      ? numbersMatch(original.bomQty, bc.bomQty)
      : original.rawBomQty === bc.rawBomQty;

  if (!bomQtyEqual) {
    const beforeStr = formatQty(original.bomQty, original.rawBomQty);
    const afterStr = formatQty(bc.bomQty, bc.rawBomQty);
    changes.push({
      field: 'BOM Qty.',
      category: 'Incorrect BOM Qty.',
      before: beforeStr,
      after: afterStr,
      explanation: `BOM Qty. mismatch: Navigation ${beforeStr} vs Business Central ${afterStr}.`,
    });
  }

  // 7. Total BOM Qty
  const totalQtyEqual =
    original.totalBomQty !== null && bc.totalBomQty !== null
      ? numbersMatch(original.totalBomQty, bc.totalBomQty)
      : original.rawTotalBomQty === bc.rawTotalBomQty;

  if (!totalQtyEqual) {
    const beforeStr = formatQty(original.totalBomQty, original.rawTotalBomQty);
    const afterStr = formatQty(bc.totalBomQty, bc.rawTotalBomQty);
    changes.push({
      field: 'Total BOM Qty',
      category: 'Incorrect Total BOM Qty',
      before: beforeStr,
      after: afterStr,
      explanation: `Total BOM Qty mismatch: Navigation ${beforeStr} vs Business Central ${afterStr}.`,
    });
  }

  return changes;
}

function scoreOccurrencePair(original: BomNode, bc: BomNode): number {
  let score = 0;
  if (original.level === bc.level) score += 20;
  if (original.description === bc.description) score += 30;
  if (original.itemType === bc.itemType) score += 15;
  if (original.uom === bc.uom) score += 10;
  if (numbersMatch(original.bomQty, bc.bomQty)) score += 20;
  if (numbersMatch(original.totalBomQty, bc.totalBomQty)) score += 15;
  return score;
}

function matchOccurrencesOrderIndependent(
  origList: BomNode[],
  bcList: BomNode[]
): {
  pairs: Array<{ original: BomNode; bc: BomNode }>;
  unmatchedOriginal: BomNode[];
  unmatchedBc: BomNode[];
} {
  const candidates: Array<{ oIdx: number; bIdx: number; exact: boolean; score: number }> = [];

  for (let oIdx = 0; oIdx < origList.length; oIdx += 1) {
    for (let bIdx = 0; bIdx < bcList.length; bIdx += 1) {
      const changes = compareSevenColumns(origList[oIdx], bcList[bIdx]);
      const exact = changes.length === 0;
      const score = exact ? 1000 : scoreOccurrencePair(origList[oIdx], bcList[bIdx]);
      candidates.push({ oIdx, bIdx, exact, score });
    }
  }

  candidates.sort((a, b) => {
    if (a.exact !== b.exact) return a.exact ? -1 : 1;
    if (a.score !== b.score) return b.score - a.score;
    if (a.oIdx !== b.oIdx) return a.oIdx - b.oIdx;
    return a.bIdx - b.bIdx;
  });

  const usedOrig = new Set<number>();
  const usedBc = new Set<number>();
  const pairs: Array<{ original: BomNode; bc: BomNode }> = [];

  for (const cand of candidates) {
    if (usedOrig.has(cand.oIdx) || usedBc.has(cand.bIdx)) continue;
    usedOrig.add(cand.oIdx);
    usedBc.add(cand.bIdx);
    pairs.push({ original: origList[cand.oIdx], bc: bcList[cand.bIdx] });
  }

  return {
    pairs,
    unmatchedOriginal: origList.filter((_, idx) => !usedOrig.has(idx)),
    unmatchedBc: bcList.filter((_, idx) => !usedBc.has(idx)),
  };
}

function summarizeErrorCategory(changes: FieldChange[]): string {
  if (changes.length === 0) return 'Matched';
  if (changes.length === 1) return changes[0].category;
  return changes.map((c) => c.field).join(', ') + ' Mismatch';
}

export function verifyBoms(
  originalRows: Record<string, unknown>[],
  originalMapping: ColumnMapping,
  bcRows: Record<string, unknown>[],
  bcMapping: ColumnMapping
): BomVerificationReport {
  const originalTree = buildBomTree(originalRows, originalMapping, 'Original Navigation');
  const bcTree = buildBomTree(bcRows, bcMapping, 'Business Central');

  const issues = [...originalTree.issues, ...bcTree.issues];

  const allRecords: BomVerificationRecord[] = [];

  // Step 0: Never classify records with blank Item Codes as matched.
  // Separate them into Missing Item Code records immediately.
  const origBlankCodeNodes = originalTree.flatNodes.filter((n) => !n.itemCode);
  const bcBlankCodeNodes = bcTree.flatNodes.filter((n) => !n.itemCode);

  for (const orig of origBlankCodeNodes) {
    allRecords.push({
      key: `missing-item-code-orig-${orig.id}`,
      status: 'missing_item_code',
      errorCategory: 'Missing Item Code',
      componentRole: orig.isParentAssembly ? 'Parent Assembly' : 'Child Component',
      sourceSide: 'Original Navigation',
      level: orig.level,
      rawLevel: orig.rawLevel || String(orig.level),
      itemCode: '(Blank)',
      description: orig.description,
      originalDescription: orig.description,
      bcDescription: '—',
      itemType: orig.itemType,
      uom: orig.uom,
      parentAssemblyCode: orig.parentItemCode ?? 'Root',
      parentPath: orig.parentPath,
      hierarchyPath: orig.hierarchyPath,
      originalNode: orig,
      bcNode: null,
      originalBomQty: orig.bomQty,
      bcBomQty: null,
      originalTotalQty: orig.totalBomQty,
      bcTotalQty: null,
      changes: [],
      detailedExplanation: `Original Navigation BOM row ${orig.rowNumber} (Level ${
        orig.rawLevel || orig.level
      }, parent "${orig.parentPath}") has a blank Item Code (No.) and cannot be classified as matched.`,
    });
  }

  for (const bc of bcBlankCodeNodes) {
    allRecords.push({
      key: `missing-item-code-bc-${bc.id}`,
      status: 'missing_item_code',
      errorCategory: 'Missing Item Code',
      componentRole: bc.isParentAssembly ? 'Parent Assembly' : 'Child Component',
      sourceSide: 'Business Central',
      level: bc.level,
      rawLevel: bc.rawLevel || String(bc.level),
      itemCode: '(Blank)',
      description: bc.description,
      originalDescription: '—',
      bcDescription: bc.description,
      itemType: bc.itemType,
      uom: bc.uom,
      parentAssemblyCode: bc.parentItemCode ?? 'Root',
      parentPath: bc.parentPath,
      hierarchyPath: bc.hierarchyPath,
      originalNode: null,
      bcNode: bc,
      originalBomQty: null,
      bcBomQty: bc.bomQty,
      originalTotalQty: null,
      bcTotalQty: bc.totalBomQty,
      changes: [],
      detailedExplanation: `Business Central BOM row ${bc.rowNumber} (Level ${
        bc.rawLevel || bc.level
      }, parent "${bc.parentPath}") has a blank Item Code (No.) and cannot be classified as matched.`,
    });
  }

  // Step 1: Bucket non-blank occurrences by (Parent Assembly Ancestor Chain, No.)
  const origBuckets = new Map<string, BomNode[]>();
  const bcBuckets = new Map<string, BomNode[]>();

  for (const node of originalTree.flatNodes) {
    if (!node.itemCode) continue;
    const key = `${getParentChainKey(node)}||${node.itemCode}`;
    const list = origBuckets.get(key) ?? [];
    list.push(node);
    origBuckets.set(key, list);
  }

  for (const node of bcTree.flatNodes) {
    if (!node.itemCode) continue;
    const key = `${getParentChainKey(node)}||${node.itemCode}`;
    const list = bcBuckets.get(key) ?? [];
    list.push(node);
    bcBuckets.set(key, list);
  }

  const leftoverOrig: BomNode[] = [];
  const leftoverBc: BomNode[] = [];
  const allKeys = new Set<string>([...origBuckets.keys(), ...bcBuckets.keys()]);

  // Step 2: Order-independent 1-to-1 occurrence matching within each (Parent Assembly, No.) bucket
  for (const key of allKeys) {
    const origList = origBuckets.get(key) ?? [];
    const bcList = bcBuckets.get(key) ?? [];

    if (origList.length === 0) {
      leftoverBc.push(...bcList);
      continue;
    }
    if (bcList.length === 0) {
      leftoverOrig.push(...origList);
      continue;
    }

    const { pairs, unmatchedOriginal, unmatchedBc } = matchOccurrencesOrderIndependent(
      origList,
      bcList
    );

    for (const { original, bc } of pairs) {
      const changes = compareSevenColumns(original, bc);
      const componentRole =
        original.isParentAssembly || bc.isParentAssembly
          ? 'Parent Assembly'
          : 'Child Component';

      const isDescriptionOnlyDiff =
        changes.length === 1 && changes[0].field === 'Description';

      const status =
        changes.length === 0
          ? 'matched'
          : isDescriptionOnlyDiff
            ? 'description_review'
            : 'incorrect';

      allRecords.push({
        key: `pair-${original.id}-${bc.id}`,
        status,
        errorCategory: summarizeErrorCategory(changes),
        componentRole,
        level: bc.level,
        rawLevel: bc.rawLevel || String(bc.level),
        itemCode: bc.itemCode,
        description: bc.description || original.description,
        originalDescription: original.description,
        bcDescription: bc.description,
        itemType: bc.itemType || original.itemType,
        uom: bc.uom || original.uom,
        parentAssemblyCode: bc.parentItemCode ?? 'Root',
        parentPath: bc.parentPath,
        hierarchyPath: bc.hierarchyPath,
        originalNode: original,
        bcNode: bc,
        originalBomQty: original.bomQty,
        bcBomQty: bc.bomQty,
        originalTotalQty: original.totalBomQty,
        bcTotalQty: bc.totalBomQty,
        changes,
        detailedExplanation:
          changes.length === 0
            ? `All 7 BOM fields match under parent "${bc.parentPath}" (NAV row ${original.rowNumber}, BC row ${bc.rowNumber}).`
            : changes.map((c) => c.explanation).join(' '),
      });
    }

    leftoverOrig.push(...unmatchedOriginal);
    leftoverBc.push(...unmatchedBc);
  }

  // Step 3: Detect components appearing under the wrong parent assembly among unmatched leftovers
  const leftoverOrigByCode = new Map<string, BomNode[]>();
  const leftoverBcByCode = new Map<string, BomNode[]>();

  for (const node of leftoverOrig) {
    const list = leftoverOrigByCode.get(node.itemCode) ?? [];
    list.push(node);
    leftoverOrigByCode.set(node.itemCode, list);
  }

  for (const node of leftoverBc) {
    const list = leftoverBcByCode.get(node.itemCode) ?? [];
    list.push(node);
    leftoverBcByCode.set(node.itemCode, list);
  }

  const finalMissing: BomNode[] = [];
  const finalAdditional: BomNode[] = [];

  for (const [codeKey, origList] of leftoverOrigByCode.entries()) {
    const bcList = leftoverBcByCode.get(codeKey);
    if (!bcList || bcList.length === 0) {
      finalMissing.push(...origList);
      continue;
    }

    const { pairs, unmatchedOriginal, unmatchedBc } = matchOccurrencesOrderIndependent(
      origList,
      bcList
    );

    for (const { original, bc } of pairs) {
      const changes = compareSevenColumns(original, bc);
      if (getParentChainKey(original) !== getParentChainKey(bc)) {
        changes.unshift({
          field: 'Parent Assembly',
          category: 'Wrong Parent Assembly',
          before: original.parentPath,
          after: bc.parentPath,
          explanation: `Component "${bc.itemCode}" appears under wrong parent assembly: expected "${original.parentPath}", found "${bc.parentPath}".`,
        });
      }

      const componentRole =
        original.isParentAssembly || bc.isParentAssembly
          ? 'Parent Assembly'
          : 'Child Component';

      allRecords.push({
        key: `wrong-parent-${original.id}-${bc.id}`,
        status: 'incorrect',
        errorCategory: summarizeErrorCategory(changes),
        componentRole,
        level: bc.level,
        rawLevel: bc.rawLevel || String(bc.level),
        itemCode: bc.itemCode,
        description: bc.description || original.description,
        originalDescription: original.description,
        bcDescription: bc.description,
        itemType: bc.itemType || original.itemType,
        uom: bc.uom || original.uom,
        parentAssemblyCode: bc.parentItemCode ?? 'Root',
        parentPath: bc.parentPath,
        hierarchyPath: bc.hierarchyPath,
        originalNode: original,
        bcNode: bc,
        originalBomQty: original.bomQty,
        bcBomQty: bc.bomQty,
        originalTotalQty: original.totalBomQty,
        bcTotalQty: bc.totalBomQty,
        changes,
        detailedExplanation: changes.map((c) => c.explanation).join(' '),
      });
    }

    finalMissing.push(...unmatchedOriginal);
    finalAdditional.push(...unmatchedBc);
    leftoverBcByCode.delete(codeKey);
  }

  for (const bcList of leftoverBcByCode.values()) {
    finalAdditional.push(...bcList);
  }

  // Step 4: Missing Components
  for (const orig of finalMissing) {
    const role = orig.isParentAssembly ? 'Parent Assembly' : 'Child Component';
    allRecords.push({
      key: `missing-${orig.id}`,
      status: 'missing',
      errorCategory: orig.isParentAssembly
        ? 'Missing Parent Assembly'
        : 'Missing Child Component',
      componentRole: role,
      sourceSide: 'Original Navigation',
      level: orig.level,
      rawLevel: orig.rawLevel || String(orig.level),
      itemCode: orig.itemCode,
      description: orig.description,
      originalDescription: orig.description,
      bcDescription: '—',
      itemType: orig.itemType,
      uom: orig.uom,
      parentAssemblyCode: orig.parentItemCode ?? 'Root',
      parentPath: orig.parentPath,
      hierarchyPath: orig.hierarchyPath,
      originalNode: orig,
      bcNode: null,
      originalBomQty: orig.bomQty,
      bcBomQty: null,
      originalTotalQty: orig.totalBomQty,
      bcTotalQty: null,
      changes: [],
      detailedExplanation: `${role} "${orig.itemCode}" present in Original Navigation BOM (row ${orig.rowNumber}, Level ${orig.rawLevel || orig.level}) under "${orig.parentPath}" is missing from Business Central BOM.`,
    });
  }

  // Step 5: Additional Components
  for (const bc of finalAdditional) {
    const role = bc.isParentAssembly ? 'Parent Assembly' : 'Child Component';
    allRecords.push({
      key: `additional-${bc.id}`,
      status: 'additional',
      errorCategory: bc.isParentAssembly
        ? 'Additional Parent Assembly'
        : 'Additional Child Component',
      componentRole: role,
      sourceSide: 'Business Central',
      level: bc.level,
      rawLevel: bc.rawLevel || String(bc.level),
      itemCode: bc.itemCode,
      description: bc.description,
      originalDescription: '—',
      bcDescription: bc.description,
      itemType: bc.itemType,
      uom: bc.uom,
      parentAssemblyCode: bc.parentItemCode ?? 'Root',
      parentPath: bc.parentPath,
      hierarchyPath: bc.hierarchyPath,
      originalNode: null,
      bcNode: bc,
      originalBomQty: null,
      bcBomQty: bc.bomQty,
      originalTotalQty: null,
      bcTotalQty: bc.totalBomQty,
      changes: [],
      detailedExplanation: `Additional ${role.toLowerCase()} "${bc.itemCode}" found in Business Central BOM (row ${bc.rowNumber}, Level ${bc.rawLevel || bc.level}) under "${bc.parentPath}" does not exist in Original Navigation BOM.`,
    });
  }

  allRecords.sort((a, b) => {
    const posA = a.bcNode?.rowNumber ?? a.originalNode?.rowNumber ?? 0;
    const posB = b.bcNode?.rowNumber ?? b.originalNode?.rowNumber ?? 0;
    if (posA !== posB) return posA - posB;
    return a.hierarchyPath.localeCompare(b.hierarchyPath);
  });

  const matchedRecords = allRecords.filter((r) => r.status === 'matched');
  const incorrectRecords = allRecords.filter((r) => r.status === 'incorrect');
  const descriptionReviewRecords = allRecords.filter((r) => r.status === 'description_review');
  const missingItemCodeRecords = allRecords.filter((r) => r.status === 'missing_item_code');
  const missingRecords = allRecords.filter((r) => r.status === 'missing');
  const additionalRecords = allRecords.filter((r) => r.status === 'additional');

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

  const missingItemCodeOriginalCount = missingItemCodeRecords.filter(
    (r) => r.sourceSide === 'Original Navigation'
  ).length;
  const missingItemCodeBcCount = missingItemCodeRecords.filter(
    (r) => r.sourceSide === 'Business Central'
  ).length;

  const overallStatus =
    missingRecords.length === 0 &&
    additionalRecords.length === 0 &&
    incorrectRecords.length === 0 &&
    descriptionReviewRecords.length === 0 &&
    missingItemCodeRecords.length === 0
      ? 'PASS'
      : 'FAIL';

  return {
    originalTree,
    bcTree,
    allRecords,
    matchedRecords,
    incorrectRecords,
    descriptionReviewRecords,
    missingItemCodeRecords,
    missingRecords,
    additionalRecords,
    issues,
    summary: {
      verifiedAt: new Date().toLocaleString(),
      overallStatus,
      originalCount: originalTree.flatNodes.length,
      bcCount: bcTree.flatNodes.length,
      matchedCount: matchedRecords.length,
      matchedWithFieldErrorsTotal: incorrectRecords.length + descriptionReviewRecords.length,
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
      missingItemCodeCount: missingItemCodeRecords.length,
      missingItemCodeOriginalCount,
      missingItemCodeBcCount,
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
