import { Injectable, Logger } from '@nestjs/common';
import { Response } from 'express';
import { Readable } from 'stream';
import { CodingListService, CodingItem } from './coding-list.service';

@Injectable()
export class CodingListExportService {
  private readonly logger = new Logger(CodingListExportService.name);

  constructor(
    private codingListService: CodingListService
  ) { }

  private pipeExportStream(
    stream: Readable,
    res: Response,
    context: string
  ): Promise<void> {
    return new Promise(resolve => {
      let settled = false;

      const settle = () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      };

      stream.once('error', (error: Error) => {
        this.logger.error(`${context}: ${error.message}`, error.stack);

        if (!res.destroyed && !res.writableEnded) {
          if (!res.headersSent) {
            res.removeHeader('Content-Length');
            res.removeHeader('Content-Disposition');
            res.status(500).json({ error: 'Export failed' });
          } else {
            res.end();
          }
        }

        settle();
      });

      res.once('finish', settle);
      res.once('close', () => {
        if (!settled && !res.writableEnded) {
          stream.destroy();
        }
        settle();
      });
      stream.pipe(res);
    });
  }

  async exportCodingListAsCsv(
    workspaceId: number,
    authToken: string,
    serverUrl: string,
    res: Response,
    trainingRequired?: boolean
  ): Promise<void> {
    try {
      const csvStream = await this.codingListService.getCodingListCsvStream(
        workspaceId,
        authToken || '',
        serverUrl || '',
        undefined,
        trainingRequired
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
      await this.pipeExportStream(
        csvStream,
        res,
        `Error streaming coding list export for workspace ${workspaceId}`
      );
    } catch (error) {
      this.logger.error(
        `Error preparing coding list export for workspace ${workspaceId}: ${error.message}`,
        error.stack
      );

      if (!res.headersSent) {
        res.status(500).json({ error: 'Export failed' });
      } else if (!res.writableEnded) {
        res.end();
      }
    }
  }

  async exportCodingListAsExcel(
    workspaceId: number,
    authToken: string,
    serverUrl: string,
    res: Response,
    trainingRequired?: boolean
  ): Promise<void> {
    const excelData = await this.codingListService.getCodingListAsExcel(
      workspaceId,
      authToken || '',
      serverUrl || '',
      undefined,
      trainingRequired
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
    res: Response,
    trainingRequired?: boolean
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
      serverUrl || '',
      undefined,
      trainingRequired
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
}
