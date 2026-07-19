import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import * as fastCsv from 'fast-csv';
import * as fs from 'fs';
import { PassThrough } from 'stream';
import { sanitizeCsvText } from '../../../utils/csv.util';
import {
  PsychometricAnalysis,
  PsychometricMetricRow
} from './psychometric-export.types';

@Injectable()
export class PsychometricExportWriter {
  createCsvStream(
    analyze: (
      checkCancellation: () => Promise<void>
    ) => Promise<PsychometricAnalysis>,
    checkCancellation?: () => Promise<void>
  ): NodeJS.ReadableStream {
    const output = new PassThrough();
    this.writeCsv(output, analyze, checkCancellation).catch(error => {
      output.destroy(error instanceof Error ? error : new Error(String(error)));
    });
    return output;
  }

  async writeExcelToFile(
    filePath: string,
    analysis: PsychometricAnalysis,
    checkCancellation?: () => Promise<void>
  ): Promise<void> {
    await checkCancellation?.();
    const outputStream = fs.createWriteStream(filePath);
    const streamComplete = new Promise<void>((resolve, reject) => {
      outputStream.on('finish', resolve);
      outputStream.on('error', reject);
    });
    streamComplete.catch(() => undefined);
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
      stream: outputStream,
      useStyles: false,
      useSharedStrings: false
    });

    try {
      const overview = workbook.addWorksheet('Übersicht');
      overview.columns = [
        { header: 'Kennzahl', key: 'key', width: 36 },
        { header: 'Wert', key: 'value', width: 60 }
      ];
      analysis.summary.forEach(row => overview.addRow(row).commit());
      await overview.commit();

      await this.writeMetricWorksheet(
        workbook,
        'Score-Trennschärfen',
        analysis.rows.filter(row => row.type === 'SCORE')
      );
      await this.writeMetricWorksheet(
        workbook,
        'Code-Trennschärfen',
        analysis.rows.filter(row => row.type === 'CODE')
      );
      await this.writeMetricWorksheet(
        workbook,
        'Kategorie-Trennschärfen',
        analysis.rows.filter(row => row.type === 'CATEGORY')
      );

      await checkCancellation?.();
      await workbook.commit();
      await streamComplete;
    } catch (error) {
      const streamError =
        error instanceof Error ? error : new Error(String(error));
      if (!outputStream.destroyed) {
        outputStream.destroy(streamError);
      }
      await streamComplete.catch(() => undefined);
      throw error;
    }
  }

  private async writeCsv(
    output: PassThrough,
    analyze: (
      checkCancellation: () => Promise<void>
    ) => Promise<PsychometricAnalysis>,
    checkCancellation?: () => Promise<void>
  ): Promise<void> {
    let csv: ReturnType<typeof fastCsv.format> | undefined;
    let outputAborted = output.destroyed;
    let outputAbortError = new Error(
      'Psychometric CSV output stream was closed'
    );
    const abortCsvProduction = (error?: Error) => {
      outputAborted = true;
      if (error instanceof Error) {
        outputAbortError = error;
      }
      if (csv && !csv.destroyed) {
        csv.destroy(outputAbortError);
      }
    };

    output.once('error', abortCsvProduction);
    output.once('close', abortCsvProduction);

    const checkProductionCancellation = async (): Promise<void> => {
      if (outputAborted) {
        throw outputAbortError;
      }
      await checkCancellation?.();
    };

    try {
      const analysis = await analyze(checkProductionCancellation);
      await checkProductionCancellation();
      csv = fastCsv.format({
        headers: [
          'type',
          'domain',
          'domain_label',
          'unit',
          'item',
          'variable',
          'item_label',
          'code',
          'category',
          'label',
          'score',
          'source',
          'n',
          'positive_n',
          'positive_share',
          'correlation',
          'status',
          'note'
        ],
        delimiter: ';',
        alwaysWriteHeaders: true
      });

      csv.on('error', error => {
        if (!output.destroyed) {
          output.destroy(error);
        }
      });
      csv.pipe(output);

      for (const row of analysis.rows) {
        if (outputAborted) {
          throw outputAbortError;
        }
        const canContinue = csv.write({
          type: sanitizeCsvText(row.type),
          domain: sanitizeCsvText(row.domain),
          domain_label: sanitizeCsvText(row.domainLabel),
          unit: sanitizeCsvText(row.unit),
          item: sanitizeCsvText(row.item),
          variable: sanitizeCsvText(row.variable),
          item_label: sanitizeCsvText(row.itemLabel),
          code: sanitizeCsvText(row.code),
          category: sanitizeCsvText(row.category),
          label: sanitizeCsvText(row.label),
          score: row.score,
          source: sanitizeCsvText(row.source),
          n: row.n,
          positive_n: row.positiveN,
          positive_share: row.positiveShare,
          correlation: row.correlation,
          status: sanitizeCsvText(row.status),
          note: sanitizeCsvText(row.note)
        });
        if (!canContinue) {
          await new Promise<void>((resolve, reject) => {
            const onDrain = () => {
              csv!.off('error', onError);
              resolve();
            };
            const onError = (error: Error) => {
              csv!.off('drain', onDrain);
              reject(error);
            };
            csv!.once('drain', onDrain);
            csv!.once('error', onError);
          });
          await checkProductionCancellation();
        }
      }

      await checkProductionCancellation();
      csv.end();
    } catch (error) {
      if (csv && !csv.destroyed) {
        csv.destroy();
      }
      if (!output.destroyed) {
        output.destroy(
          error instanceof Error ? error : new Error(String(error))
        );
      }
    } finally {
      output.off('error', abortCsvProduction);
      output.off('close', abortCsvProduction);
    }
  }

  private async writeMetricWorksheet(
    workbook: ExcelJS.stream.xlsx.WorkbookWriter,
    name: string,
    rows: PsychometricMetricRow[]
  ): Promise<void> {
    const worksheet = workbook.addWorksheet(name);
    worksheet.columns = [
      { header: 'Domäne', key: 'domainLabel', width: 24 },
      { header: 'Domänen-ID', key: 'domain', width: 22 },
      { header: 'Unit', key: 'unit', width: 24 },
      { header: 'Item', key: 'item', width: 20 },
      { header: 'Variable', key: 'variable', width: 22 },
      { header: 'Item-Label', key: 'itemLabel', width: 32 },
      { header: 'Code', key: 'code', width: 14 },
      { header: 'Kategorie', key: 'category', width: 22 },
      { header: 'Label', key: 'label', width: 32 },
      { header: 'Score', key: 'score', width: 12 },
      { header: 'Quelle', key: 'source', width: 20 },
      { header: 'n (paarweise vollständige Fälle)', key: 'n', width: 34 },
      { header: 'N positiv', key: 'positiveN', width: 14 },
      { header: 'Anteil positiv', key: 'positiveShare', width: 16 },
      { header: 'Korrelation', key: 'correlation', width: 16 },
      { header: 'Status', key: 'status', width: 24 },
      { header: 'Hinweis', key: 'note', width: 42 }
    ];
    rows.forEach(row => worksheet.addRow(row).commit());
    await worksheet.commit();
  }
}
