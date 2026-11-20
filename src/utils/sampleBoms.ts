import * as XLSX from 'xlsx';
import type { ExcelContainerFormat } from '../types/bom';

/**
 * Realistic Original Navigation BOM matrix:
 * - Header row placed at Row 4 (after report title & metadata rows)
 * - Includes Sr. No. and cost columns (Item Unit Cost, Item Std Cost, Item BOM Curr Cost) which must be ignored
 * - Includes blank rows, a parser-noise blank root-level row, & description continuation rows
 * - Includes repeated item code (FST-M4X12-SS) under multiple parent assemblies
 */
export const SAMPLE_NAV_MATRIX: unknown[][] = [
  ['Microsoft Dynamics NAV - Indented Production BOM Report'],
  ['Top Assembly: 564-ASM-001', '', 'Report Date: 2026-11-20', '', 'Currency Rate: 1.000'],
  [''],
  [
    'Sr. No.',
    'Level',
    'No.',
    'Description',
    'Item Type',
    'UOM',
    'BOM Qty.',
    'Total BOM Qty',
    'Item Unit Cost',
    'Item Unit Cost Amt',
    'Item Std Cost',
    'Item Std Amount',
    'Item BOM Curr Cost',
  ],
  [1, 0, '564-ASM-001', 'Hydraulic Manifold Actuator Assembly', 'Prod. Order', 'PCS', 1, 1, 0, 0, 0, 0, 0],
  [2, 1, '564-SUB-100', 'Valve Block Sub-Assembly', 'Prod. Order', 'PCS', 1, 1, 145.2, 145.2, 140.0, 140.0, 145.2],
  [3, 2, '564-BLK-101', 'CNC Machined 6061-T6 Manifold Block', 'Purchase', 'PCS', 1, 1, 84.5, 84.5, 82.0, 82.0, 84.5],
  // Description continuation row (wrapped long description)
  ['', '', '', 'Hard Anodized Type III Clear Coat', '', '', '', '', '', '', '', '', ''],
  [4, 2, '564-VLV-102', 'Proportional Relief Cartridge Valve', 'Purchase', 'PCS', 2, 2, 24.0, 48.0, 23.5, 47.0, 24.0],
  [5, 2, 'FST-M4X12-SS', 'M4 x 12mm Socket Head Cap Screw SS316', 'Purchase', 'PCS', 4, 4, 0.35, 1.4, 0.32, 1.28, 0.35],
  [''], // Blank separator row
  [6, 1, '564-SUB-200', 'Solenoid Control Harness Module', 'Prod. Order', 'PCS', 2, 2, 62.0, 124.0, 60.0, 120.0, 62.0],
  [7, 2, '564-COIL-201', '24VDC Proportional Solenoid Coil', 'Purchase', 'PCS', 1, 2, 31.5, 63.0, 30.0, 60.0, 31.5],
  [8, 2, '564-CON-202', 'Deutsch DT04 2-Pin Sealed Connector', 'Purchase', 'PCS', 2, 4, 4.1, 16.4, 4.0, 16.0, 4.1],
  [9, 2, 'FST-M4X12-SS', 'M4 x 12mm Socket Head Cap Screw SS316', 'Purchase', 'PCS', 2, 4, 0.35, 1.4, 0.32, 1.28, 0.35],
  [10, 1, '564-HSG-300', 'Cast Aluminum End Cap Housing', 'Purchase', 'PCS', 1, 1, 48.0, 48.0, 46.5, 46.5, 48.0],
  [11, 1, '564-GSK-301', 'Viton Flange O-Ring Seal 52mm', 'Purchase', 'PCS', 1, 1, 3.25, 3.25, 3.0, 3.0, 3.25],
  [12, 1, '564-LBL-302', 'Laser Etched Serial Tag Plate', 'Purchase', 'PCS', 1, 1, 1.1, 1.1, 1.0, 1.0, 1.1],
  // Parser-noise blank root-level row (only Level=0 & cost subtotal; must be excluded)
  ['', 0, '', '', '', '', '', '', 332.95, 332.95, 320.0, 320.0, 332.95],
];

/**
 * Realistic Business Central BOM matrix:
 * - Header row placed at Row 2 (different layout from Navigation!)
 * - Reordered sub-assemblies (564-SUB-200 before 564-SUB-100)
 * - Contains Description Difference – Review Required (564-VLV-102 with Dwg/Rev info)
 * - Contains Purchase vs Prod. Order mismatch (564-HSG-300)
 * - Contains UOM mismatch (564-CON-202), Qty mismatch (FST-M4X12-SS under 564-SUB-100), Wrong parent & Level (564-GSK-301), Additional (564-SNS-203)
 */
export const SAMPLE_BC_MATRIX: unknown[][] = [
  ['Dynamics 365 Business Central - Production BOM Verification Export (BOM 564)'],
  [
    'Level',
    'No.',
    'Description',
    'Item Type',
    'UOM',
    'BOM Qty.',
    'Total BOM Qty',
    'Unit Cost',
    'Total Cost',
  ],
  [0, '564-ASM-001', 'Hydraulic Manifold Actuator Assembly', 'Prod. Order', 'PCS', 1.0, 1.0, 0, 0],
  [1, '564-SUB-200', 'Solenoid Control Harness Module', 'Prod. Order', 'PCS', 2, 2, 65.0, 130.0],
  [2, '564-COIL-201', '24VDC Proportional Solenoid Coil', 'Purchase', 'PCS', 1, 2, 32.0, 64.0],
  [2, '564-CON-202', 'Deutsch DT04 2-Pin Sealed Connector', 'Purchase', 'EA', 2, 4, 4.25, 17.0],
  [2, 'FST-M4X12-SS', 'M4 x 12mm Socket Head Cap Screw SS316', 'Purchase', 'PCS', 2, 4, 0.38, 1.52],
  [2, '564-SNS-203', 'Hall-Effect Spool Position Sensor', 'Purchase', 'PCS', 1, 2, 18.5, 37.0],
  [1, '564-SUB-100', 'Valve Block Sub-Assembly', 'Prod. Order', 'PCS', 1, 1, 150.0, 150.0],
  [2, '564-BLK-101', 'CNC Machined 6061-T6 Manifold Block Hard Anodized Type III Clear Coat', 'Purchase', 'PCS', 1, 1, 86.0, 86.0],
  [2, '564-VLV-102', 'Proportional Relief Cartridge Valve (Dwg 564-D12 Rev B)', 'Purchase', 'PCS', 2, 2, 24.5, 49.0],
  [2, 'FST-M4X12-SS', 'M4 x 12mm Socket Head Cap Screw SS316', 'Purchase', 'PCS', 6, 6, 0.38, 2.28],
  [2, '564-GSK-301', 'Viton Flange O-Ring Seal 52mm', 'Purchase', 'PCS', 1, 1, 3.3, 3.3],
  [1, '564-HSG-300', 'Cast Aluminum End Cap Housing', 'Prod. Order', 'PCS', 1, 1, 49.0, 49.0],
];

function matrixToExcelBytes(
  sheetName: string,
  matrix: unknown[][],
  format: ExcelContainerFormat
): Uint8Array {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(matrix);
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  const bookType: XLSX.BookType = format === 'xls' ? 'biff8' : 'xlsx';
  const out = XLSX.write(wb, { bookType, type: 'array' }) as ArrayBuffer | Uint8Array;
  return out instanceof Uint8Array ? out : new Uint8Array(out);
}

export function createSampleMigrationFiles(): {
  navFile: File;
  bcFile: File;
} {
  const navBytes = matrixToExcelBytes('NAV_BOM_564', SAMPLE_NAV_MATRIX, 'xlsx');
  const bcBytes = matrixToExcelBytes('BC_BOM_564', SAMPLE_BC_MATRIX, 'xlsx');

  const navFile = new File([navBytes.buffer as ArrayBuffer], 'Original Navigation BOM- 564.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const bcFile = new File([bcBytes.buffer as ArrayBuffer], 'Business Central BOM- 564.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  return { navFile, bcFile };
}

export function downloadSampleBomFile(
  kind: 'navigation' | 'business_central',
  format: ExcelContainerFormat
): void {
  const matrix = kind === 'navigation' ? SAMPLE_NAV_MATRIX : SAMPLE_BC_MATRIX;
  const sheetName = kind === 'navigation' ? 'NAV_BOM_564' : 'BC_BOM_564';
  const ext = format === 'xls' ? 'xls' : 'xlsx';
  const fileName =
    kind === 'navigation'
      ? `Original Navigation BOM- 564.${ext}`
      : `Business Central BOM- 564.${ext}`;
  const bytes = matrixToExcelBytes(sheetName, matrix, format);
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
