import { useState } from 'react';
import {
  AlertCircle,
  Download,
  FileSpreadsheet,
  FileText,
  GitCompare,
  Play,
  RotateCcw,
} from 'lucide-react';
import { ComparisonResults, type ActiveResultTab } from './components/ComparisonResults';
import { FileDropZone } from './components/FileDropZone';
import type {
  BomVerificationReport,
  ColumnMapping,
  ExcelContainerFormat,
  LoadedExcelWorkbook,
} from './types/bom';
import { verifyBoms } from './utils/bomEngine';
import { exportBomVerificationExcel } from './utils/excelExport';
import {
  detectColumnsForFormat,
  readBusinessCentralBomExcel,
  readNavigationBomExcel,
} from './utils/excelReader';
import { exportBomVerificationPdf } from './utils/pdfExport';
import { createSampleMigrationFiles, downloadSampleBomFile } from './utils/sampleBoms';

const EMPTY_MAPPING: ColumnMapping = {
  level: '',
  itemCode: '',
  description: '',
  itemType: '',
  uom: '',
  bomQty: '',
  totalBomQty: '',
};

export default function App() {
  const [navWorkbook, setNavWorkbook] = useState<LoadedExcelWorkbook | null>(null);
  const [bcWorkbook, setBcWorkbook] = useState<LoadedExcelWorkbook | null>(null);
  const [navMapping, setNavMapping] = useState<ColumnMapping>(EMPTY_MAPPING);
  const [bcMapping, setBcMapping] = useState<ColumnMapping>(EMPTY_MAPPING);

  const [navError, setNavError] = useState<string | null>(null);
  const [bcError, setBcError] = useState<string | null>(null);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [navLoading, setNavLoading] = useState(false);
  const [bcLoading, setBcLoading] = useState(false);

  const [verificationReport, setVerificationReport] = useState<BomVerificationReport | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveResultTab>('incorrect');
  const [excelExportFormat, setExcelExportFormat] = useState<ExcelContainerFormat>('xlsx');

  const handleLoadNavFile = async (file: File) => {
    setNavLoading(true);
    setNavError(null);
    setCompareError(null);
    setVerificationReport(null);

    try {
      const parsed = await readNavigationBomExcel(file);
      const sheet = parsed.sheets[parsed.selectedSheet];
      setNavWorkbook(parsed);
      setNavMapping(sheet?.detectedMapping ?? EMPTY_MAPPING);
    } catch (err) {
      setNavError(err instanceof Error ? err.message : 'Unable to read Original Navigation BOM.');
    } finally {
      setNavLoading(false);
    }
  };

  const handleLoadBcFile = async (file: File) => {
    setBcLoading(true);
    setBcError(null);
    setCompareError(null);
    setVerificationReport(null);

    try {
      const parsed = await readBusinessCentralBomExcel(file);
      const sheet = parsed.sheets[parsed.selectedSheet];
      setBcWorkbook(parsed);
      setBcMapping(sheet?.detectedMapping ?? EMPTY_MAPPING);
    } catch (err) {
      setBcError(err instanceof Error ? err.message : 'Unable to read Business Central BOM.');
    } finally {
      setBcLoading(false);
    }
  };

  const handleSheetChange = (side: 'navigation' | 'business_central', sheetName: string) => {
    setVerificationReport(null);
    setCompareError(null);

    if (side === 'navigation' && navWorkbook) {
      const sheet = navWorkbook.sheets[sheetName];
      setNavWorkbook({ ...navWorkbook, selectedSheet: sheetName });
      setNavMapping(
        sheet?.detectedMapping ?? detectColumnsForFormat(sheet?.headers ?? [], 'navigation')
      );
    } else if (side === 'business_central' && bcWorkbook) {
      const sheet = bcWorkbook.sheets[sheetName];
      setBcWorkbook({ ...bcWorkbook, selectedSheet: sheetName });
      setBcMapping(
        sheet?.detectedMapping ??
          detectColumnsForFormat(sheet?.headers ?? [], 'business_central')
      );
    }
  };

  const handleCompareBom = () => {
    setCompareError(null);

    if (!navWorkbook && !bcWorkbook) {
      setCompareError(
        'Both files are missing. Please upload the Original Navigation BOM (Excel) and the Business Central BOM (Excel).'
      );
      return;
    }
    if (!navWorkbook) {
      setCompareError('Original Navigation BOM is missing. Please upload File A before comparing.');
      return;
    }
    if (!bcWorkbook) {
      setCompareError('Business Central BOM is missing. Please upload File B before comparing.');
      return;
    }

    const navSheet = navWorkbook.sheets[navWorkbook.selectedSheet];
    const bcSheet = bcWorkbook.sheets[bcWorkbook.selectedSheet];

    if (!navSheet || navSheet.rows.length === 0) {
      setCompareError('The selected Original Navigation BOM worksheet contains no component rows.');
      return;
    }
    if (!bcSheet || bcSheet.rows.length === 0) {
      setCompareError('The selected Business Central BOM worksheet contains no component rows.');
      return;
    }

    if (!navMapping.itemCode || !navMapping.level) {
      setCompareError(
        'Original Navigation BOM is missing required column mappings (Level and No. / Item Code). Open 7-Column Mapping to verify.'
      );
      return;
    }
    if (!bcMapping.itemCode || !bcMapping.level) {
      setCompareError(
        'Business Central BOM is missing required column mappings (Level and No. / Item Code). Open 7-Column Mapping to verify.'
      );
      return;
    }

    const report = verifyBoms(navSheet.rows, navMapping, bcSheet.rows, bcMapping);
    setVerificationReport(report);

    if (report.incorrectRecords.length > 0) {
      setActiveTab('incorrect');
    } else if (report.descriptionReviewRecords.length > 0) {
      setActiveTab('description_review');
    } else if (report.missingItemCodeRecords.length > 0) {
      setActiveTab('missing_item_code');
    } else if (report.missingRecords.length > 0) {
      setActiveTab('missing');
    } else if (report.additionalRecords.length > 0) {
      setActiveTab('additional');
    } else {
      setActiveTab('matched');
    }
  };

  const handleReset = () => {
    setNavWorkbook(null);
    setBcWorkbook(null);
    setNavMapping(EMPTY_MAPPING);
    setBcMapping(EMPTY_MAPPING);
    setNavError(null);
    setBcError(null);
    setCompareError(null);
    setVerificationReport(null);
    setActiveTab('incorrect');
  };

  const handleLoadSampleFiles = async () => {
    const { navFile, bcFile } = createSampleMigrationFiles();
    await Promise.all([handleLoadNavFile(navFile), handleLoadBcFile(bcFile)]);
  };

  const handleDownloadPdf = () => {
    if (!verificationReport || !navWorkbook || !bcWorkbook) return;
    exportBomVerificationPdf(
      verificationReport,
      navWorkbook.fileName,
      bcWorkbook.fileName
    );
  };

  const handleDownloadExcel = () => {
    if (!verificationReport || !navWorkbook || !bcWorkbook) return;
    exportBomVerificationExcel(
      verificationReport,
      navWorkbook.fileName,
      bcWorkbook.fileName,
      excelExportFormat
    );
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Top Bar */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between gap-8">
          <a
            href="#top"
            className="font-display text-sm sm:text-base font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
          >
            ENGINEERING BOM VERIFICATION SYSTEM
          </a>

          <nav
            aria-label="Primary sections"
            className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600"
          >
            <a
              href="#upload-section"
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              Upload BOMs
            </a>
            <a
              href="#results-section"
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              Verification Results
            </a>
          </nav>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleCompareBom}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-700 rounded-md hover:bg-blue-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <GitCompare className="w-3.5 h-3.5" />
              Compare BOM
            </button>
          </div>
        </div>
      </header>

      {/* Main Workspace */}
      <main id="top" className="flex-1 max-w-7xl w-full mx-auto px-6 py-6 space-y-6">
        {/* Title, Subtitle & Sample Helpers */}
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 pb-4 border-b border-slate-200">
          <div>
            <h1 className="font-display text-2xl font-bold text-slate-900 tracking-tight">
              ENGINEERING BOM VERIFICATION SYSTEM
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Navigation to Business Central – ERP Migration Validation
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleLoadSampleFiles}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-800 bg-white border border-slate-200 rounded-md hover:bg-slate-100 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Play className="w-3.5 h-3.5 text-blue-700" />
              Load Sample BOM 564 Pair
            </button>
            <button
              type="button"
              onClick={() => downloadSampleBomFile('navigation', 'xlsx')}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-md hover:bg-slate-100 hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              Sample NAV
            </button>
            <button
              type="button"
              onClick={() => downloadSampleBomFile('business_central', 'xlsx')}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-md hover:bg-slate-100 hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              Sample BC
            </button>
          </div>
        </div>

        {/* Two Separate Upload Sections */}
        <section id="upload-section" className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
          <FileDropZone
            label="A. Upload Original Navigation BOM (Excel)"
            roleDescription="Source Dynamics NAV BOM export (.xls or .xlsx)"
            workbook={navWorkbook}
            mapping={navMapping}
            error={navError}
            isLoading={navLoading}
            onFileSelected={handleLoadNavFile}
            onSheetChange={(name) => handleSheetChange('navigation', name)}
            onMappingChange={(next) => {
              setNavMapping(next);
              setVerificationReport(null);
            }}
            onClear={() => {
              setNavWorkbook(null);
              setNavMapping(EMPTY_MAPPING);
              setNavError(null);
              setCompareError(null);
              setVerificationReport(null);
            }}
          />

          <FileDropZone
            label="B. Upload Business Central BOM (Excel)"
            roleDescription="Target Microsoft Dynamics 365 Business Central BOM export (.xls or .xlsx)"
            workbook={bcWorkbook}
            mapping={bcMapping}
            error={bcError}
            isLoading={bcLoading}
            onFileSelected={handleLoadBcFile}
            onSheetChange={(name) => handleSheetChange('business_central', name)}
            onMappingChange={(next) => {
              setBcMapping(next);
              setVerificationReport(null);
            }}
            onClear={() => {
              setBcWorkbook(null);
              setBcMapping(EMPTY_MAPPING);
              setBcError(null);
              setCompareError(null);
              setVerificationReport(null);
            }}
          />
        </section>

        {/* Action Toolbar: Compare BOM, Reset, Download PDF Report, Download Excel Error Report */}
        <section className="bg-white border border-slate-200 rounded-lg px-5 py-3.5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={handleCompareBom}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-700 rounded-md hover:bg-blue-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <GitCompare className="w-3.5 h-3.5" />
              Compare BOM
            </button>
            <button
              type="button"
              onClick={handleReset}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={handleDownloadPdf}
              disabled={!verificationReport}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-800 bg-white border border-slate-200 rounded-md hover:bg-slate-50 disabled:opacity-45 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <FileText className="w-3.5 h-3.5 text-red-700" />
              Download PDF Report
            </button>

            <div className="inline-flex items-center gap-1.5">
              <select
                aria-label="Excel Error Report format"
                value={excelExportFormat}
                onChange={(e) => setExcelExportFormat(e.target.value as ExcelContainerFormat)}
                disabled={!verificationReport}
                className="h-8.5 px-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-blue-600"
              >
                <option value="xlsx">.xlsx</option>
                <option value="xls">.xls</option>
              </select>
              <button
                type="button"
                onClick={handleDownloadExcel}
                disabled={!verificationReport}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-800 bg-white border border-slate-200 rounded-md hover:bg-slate-50 disabled:opacity-45 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5 text-emerald-700" />
                Download Excel Error Report
              </button>
            </div>
          </div>
        </section>

        {compareError && (
          <div
            role="alert"
            className="px-4 py-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2.5 text-xs text-red-800"
          >
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            <span>{compareError}</span>
          </div>
        )}

        {/* Comparison Results Section */}
        <section id="results-section">
          {verificationReport ? (
            <ComparisonResults
              report={verificationReport}
              activeTab={activeTab}
              onTabChange={setActiveTab}
            />
          ) : (
            <div className="bg-white border border-slate-200 rounded-lg py-12 px-6 text-center">
              <div className="w-10 h-10 rounded-md bg-slate-100 border border-slate-200 flex items-center justify-center mx-auto mb-3 text-slate-600">
                <FileSpreadsheet className="w-5 h-5" />
              </div>
              <h2 className="text-sm font-semibold text-slate-900">
                {navWorkbook && bcWorkbook
                  ? 'Both BOM files are loaded — click Compare BOM to run verification'
                  : 'Upload Original Navigation BOM and Business Central BOM'}
              </h2>
              <p className="mt-1 text-xs text-slate-500 max-w-xl mx-auto">
                Compares only Level, No. (Item Code), Description, Item Type, UOM, BOM Qty., and Total BOM Qty within reconstructed parent-child assemblies. All processing stays strictly inside your browser.
              </p>
            </div>
          )}
        </section>
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="max-w-7xl mx-auto px-6 py-3 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-500">
          <span>Engineering BOM Verification System · Deterministic Client-Side Validation</span>
          <span>100% Browser-Based · No Files Uploaded to External Servers</span>
        </div>
      </footer>
    </div>
  );
}
