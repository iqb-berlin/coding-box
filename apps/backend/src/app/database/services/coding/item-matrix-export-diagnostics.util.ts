import * as fs from 'fs';
import archiver = require('archiver');
import { pipeline } from 'stream/promises';
import type {
  ItemMatrixCellFailureReason,
  ItemMatrixExportDiagnosticsDto
} from '../../../../../../../api-dto/coding/export-request.dto';
import type { ExportJobResult } from '../../../job-queue/job-queue.service';

export const itemMatrixArtifactTtlSeconds = 3600;

export interface CachedItemMatrixDiagnostics {
  diagnostics: ItemMatrixExportDiagnosticsDto;
  expiresAt: number;
}

export const getItemMatrixDiagnosticsCacheKey = (jobId: string): string => (
  `item-matrix-diagnostics:${jobId}`
);

export const getIncompleteItemMatrixResultCacheKey = (
  jobId: string
): string => `item-matrix-incomplete-result:${jobId}`;

const diagnosticTexts: Record<
ItemMatrixCellFailureReason,
{ label: string; action: string }
> = {
  'unresolved-cell': {
    label: 'Zelle konnte nicht aufgelöst werden',
    action: 'Prüfen Sie Status, Kodierung und Itemdefinition der betroffenen Spalte.'
  },
  'unresolved-status': {
    label: 'Status ohne exportierbaren Wert',
    action: 'Schließen Sie die Verarbeitung oder Kodierung der betroffenen Antworten ab.'
  },
  'derived-result-missing': {
    label: 'Ergebnis einer abgeleiteten Variable fehlt',
    action: 'Führen Sie die Ableitung erneut aus oder ergänzen Sie das erwartete Ergebnis.'
  },
  'derived-cycle': {
    label: 'Zyklische Variablenableitung',
    action: 'Korrigieren Sie die gegenseitigen Abhängigkeiten der abgeleiteten Variablen.'
  },
  'derived-source-unresolved': {
    label: 'Quelle einer abgeleiteten Variable ist nicht auflösbar',
    action: 'Prüfen Sie Quellvariablen, Variablenzuordnung und vorhandene Antwortdaten.'
  },
  'derived-design-conflict': {
    label: 'Widerspruch zwischen Booklet-Design und Ableitung',
    action: 'Prüfen Sie die Ableitung auf eine Mischung aus nicht vorgelegten und vorgelegten Quellen.'
  },
  'internal-resolution-missing': {
    label: 'Interne Zellzuordnung fehlt',
    action: 'Prüfen Sie die Item-Metadaten und starten Sie den Export erneut.'
  },
  'invalid-code': {
    label: 'Code ist nicht exportierbar',
    action: 'Ersetzen Sie reservierte technische Codes durch ein fachliches Ergebnis oder Missing.'
  },
  'missing-code': {
    label: 'Code fehlt',
    action: 'Ergänzen Sie den Code oder verwenden Sie eine Score-Matrix.'
  },
  'missing-score': {
    label: 'Score fehlt',
    action: 'Ergänzen Sie den Score oder verwenden Sie eine Code-Matrix.'
  }
};

export const getItemMatrixDiagnosticText = (
  reason: ItemMatrixCellFailureReason
): { label: string; action: string } => diagnosticTexts[reason];

const escapeCsv = (value: string | number): string => {
  const text = String(value);
  const spreadsheetSafe = /^\s*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${spreadsheetSafe.replace(/"/g, '""')}"`;
};

export const buildItemMatrixDiagnosticsCsv = (
  diagnostics: ItemMatrixExportDiagnosticsDto
): string => {
  const rows: Array<Array<string | number>> = [[
    'reason_code',
    'ursache',
    'booklet',
    'spalte',
    'anzahl',
    'beispielzeilen',
    'empfohlene_massnahme'
  ]];
  diagnostics.groups.forEach(group => {
    const text = getItemMatrixDiagnosticText(group.reasonCode);
    rows.push([
      group.reasonCode,
      text.label,
      group.bookletName,
      group.columnName,
      group.count,
      group.sampleRowNumbers.join(', '),
      text.action
    ]);
  });
  return `\uFEFF${rows
    .map(row => row.map(escapeCsv).join(';'))
    .join('\r\n')}\r\n`;
};

export interface ItemMatrixIncompleteReadmeOptions {
  diagnostics: ItemMatrixExportDiagnosticsDto;
  version: 'v1' | 'v2' | 'v3';
  matrixValue: 'code' | 'score';
  missingsProfileId: number;
  createdAt: number;
}

export const buildItemMatrixIncompleteReadme = (
  options: ItemMatrixIncompleteReadmeOptions
): string => [
  'ACHTUNG: UNVOLLSTÄNDIGER ITEMDATENSATZ',
  '',
  `In dieser Matrix sind ${options.diagnostics.total} nicht auflösbare Zellen leer.`,
  'Diese Leerzellen sind keine fachlich klassifizierten Missing-Werte und dürfen nicht als solche interpretiert werden.',
  'Verwenden Sie diagnose.csv, um die betroffenen Booklets und Spalten zu prüfen.',
  '',
  `Version: ${options.version}`,
  `Matrixwert: ${options.matrixValue === 'code' ? 'Code' : 'Score'}`,
  `Missing-Profil-ID: ${options.missingsProfileId}`,
  `Erstellt: ${new Date(options.createdAt).toISOString()}`,
  '',
  'Dieser Export wurde ausdrücklich als unvollständiger Export heruntergeladen.',
  ''
].join('\r\n');

export const writeIncompleteItemMatrixPackage = async (
  zipPath: string,
  matrixPath: string,
  matrixFileName: string,
  options: ItemMatrixIncompleteReadmeOptions
): Promise<void> => {
  if (!fs.existsSync(matrixPath)) {
    throw new Error('Incomplete item matrix source file is missing');
  }
  const output = fs.createWriteStream(zipPath);
  const archive = archiver('zip', { zlib: { level: 9 } });
  const streamComplete = pipeline(archive, output);
  streamComplete.catch(() => undefined);
  const handleWarning = (warning: Error): void => {
    output.destroy(warning);
  };
  archive.once('warning', handleWarning);
  try {
    archive.file(matrixPath, { name: matrixFileName });
    archive.append(buildItemMatrixDiagnosticsCsv(options.diagnostics), {
      name: 'diagnose.csv'
    });
    archive.append(buildItemMatrixIncompleteReadme(options), {
      name: 'README.txt'
    });
    await Promise.all([archive.finalize(), streamComplete]);
  } catch (error) {
    archive.abort();
    output.destroy(error as Error);
    await streamComplete.catch(() => undefined);
    throw error;
  } finally {
    archive.off('warning', handleWarning);
  }
};

export type IncompleteItemMatrixResult = ExportJobResult;
