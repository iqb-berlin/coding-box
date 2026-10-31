import { Injectable, Logger } from '@nestjs/common';
import { Readable, PassThrough } from 'stream';
import { Response } from 'express';
import { CodingListService, CodingItem } from './coding-list.service';

@Injectable()
export class CodingExportDownloadService {
  private readonly logger = new Logger(CodingExportDownloadService.name);

  constructor(
    private codingListService: CodingListService
  ) {}

  async exportCodingListAsCsv(
    workspaceId: number,
    authToken: string,
    serverUrl: string,
    res: Response
  ): Promise<void> {
    const csvStream = await this.codingListService.getCodingListCsvStream(
      workspaceId,
      authToken || '',
      serverUrl || ''
    );

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="coding-list-${new Date()
        .toISOString()
        .slice(0, 10)}.csv"`
    );

    // Excel compatibility: UTF-8 BOM
    res.write('\uFEFF');
    csvStream.pipe(res);
  }

  async exportCodingListAsExcel(
    workspaceId: number,
    authToken: string,
    serverUrl: string,
    res: Response
  ): Promise<void> {
    const excelData = await this.codingListService.getCodingListAsExcel(
      workspaceId,
      authToken || '',
      serverUrl || ''
    );

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="coding-list-${new Date()
        .toISOString()
        .slice(0, 10)}.xlsx"`
    );

    res.send(excelData);
  }

  async exportCodingListAsJson(
    workspaceId: number,
    authToken: string,
    serverUrl: string,
    res: Response
  ): Promise<void> {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="coding-list-${new Date()
        .toISOString()
        .slice(0, 10)}.json"`
    );
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    res.write('[');
    const stream = await this.codingListService.getCodingListJsonStream(
      workspaceId,
      authToken || '',
      serverUrl || ''
    );

    let first = true;
    stream.on('data', (item: CodingItem) => {
      if (!first) {
        res.write(',');
      } else {
        first = false;
      }
      res.write(JSON.stringify(item));

      if (global.gc) {
        global.gc();
      }
    });

    stream.on('end', () => {
      res.write(']');
      res.end();
    });

    stream.on('error', (error: Error) => {
      this.logger.error(`Error during JSON export: ${error.message}`);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Export failed' });
      } else {
        res.end();
      }
    });
  }

  async exportCodingListForJobAsCsv(
    workspaceId: number,
    authToken: string,
    serverUrl: string,
    progressCallback?: (percentage: number) => Promise<void>,
    trainingRequired?: boolean,
    checkCancellation?: () => Promise<void>
  ): Promise<Readable> {
    return this.codingListService.getCodingListCsvStream(
      workspaceId,
      authToken || '',
      serverUrl || '',
      progressCallback,
      trainingRequired,
      checkCancellation
    );
  }

  async exportCodingListForJobAsExcel(
    workspaceId: number,
    authToken: string,
    serverUrl: string,
    progressCallback?: (percentage: number) => Promise<void>,
    trainingRequired?: boolean,
    checkCancellation?: () => Promise<void>
  ): Promise<Buffer> {
    return this.codingListService.getCodingListAsExcel(
      workspaceId,
      authToken || '',
      serverUrl || '',
      progressCallback,
      trainingRequired,
      checkCancellation
    );
  }

  async exportCodingListForJobAsExcelToFile(
    filePath: string,
    workspaceId: number,
    authToken: string,
    serverUrl: string,
    progressCallback?: (percentage: number) => Promise<void>,
    trainingRequired?: boolean,
    checkCancellation?: () => Promise<void>
  ): Promise<void> {
    return this.codingListService.writeCodingListExcelToFile(
      filePath,
      workspaceId,
      authToken || '',
      serverUrl || '',
      progressCallback,
      trainingRequired,
      checkCancellation
    );
  }

  async exportCodingListForJobAsJson(
    workspaceId: number,
    authToken: string,
    serverUrl: string,
    progressCallback?: (percentage: number) => Promise<void>,
    trainingRequired?: boolean,
    checkCancellation?: () => Promise<void>
  ): Promise<Readable> {
    const stream = this.codingListService.getCodingListJsonStream(
      workspaceId,
      authToken || '',
      serverUrl || '',
      progressCallback,
      trainingRequired,
      checkCancellation
    );

    const passThrough = new PassThrough();
    passThrough.write('[');
    let first = true;

    stream.on('data', (item: CodingItem) => {
      if (!first) {
        passThrough.write(',');
      } else {
        first = false;
      }
      passThrough.write(JSON.stringify(item));
    });

    stream.on('end', () => {
      passThrough.write(']');
      passThrough.end();
    });

    stream.on('error', err => {
      passThrough.emit('error', err);
    });

    return passThrough;
  }

  async exportCodingResultsByVersionAsCsv(
    workspaceId: number,
    version: 'v1' | 'v2' | 'v3',
    missingsProfileId: number,
    authToken: string,
    serverUrl: string,
    includeReplayUrls: boolean,
    progressCallback?: (percentage: number) => Promise<void>,
    includeResponseValues: boolean = true,
    includeGeoGebraResponseValues: boolean = false
  ): Promise<Readable> {
    return this.codingListService.getCodingResultsByVersionCsvStream(
      workspaceId,
      version,
      missingsProfileId,
      authToken || '',
      serverUrl || '',
      includeReplayUrls,
      progressCallback,
      includeResponseValues,
      includeGeoGebraResponseValues,
      undefined
    );
  }

  async exportCodingResultsByVersionAsExcel(
    workspaceId: number,
    version: 'v1' | 'v2' | 'v3',
    missingsProfileId: number,
    authToken: string,
    serverUrl: string,
    includeReplayUrls: boolean,
    progressCallback?: (percentage: number) => Promise<void>,
    includeResponseValues: boolean = true,
    includeGeoGebraResponseValues: boolean = false
  ): Promise<Buffer> {
    return this.codingListService.getCodingResultsByVersionAsExcel(
      workspaceId,
      version,
      missingsProfileId,
      authToken || '',
      serverUrl || '',
      includeReplayUrls,
      progressCallback,
      includeResponseValues,
      includeGeoGebraResponseValues,
      undefined
    );
  }
}
