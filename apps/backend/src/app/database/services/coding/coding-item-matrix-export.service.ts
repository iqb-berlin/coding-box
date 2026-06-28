import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as ExcelJS from 'exceljs';
import * as fastCsv from 'fast-csv';
import * as fs from 'fs';
import { PassThrough } from 'stream';
import { Repository } from 'typeorm';
import { Booklet } from '../../entities/booklet.entity';
import { ResponseEntity } from '../../entities/response.entity';
import { Unit } from '../../entities/unit.entity';
import {
  isExcludedByResolvedExclusions,
  normalizeExclusionUnitId,
  WorkspaceExclusionService
} from '../workspace/workspace-exclusion.service';
import { WorkspaceFilesService } from '../workspace/workspace-files.service';
import { mapCodeForExport } from '../../../utils/coding-utils';
import { MissingsProfilesService, ResolvedMissingValue } from './missings-profiles.service';

export type ItemMatrixValue = 'code' | 'score';
export type ItemMatrixFormat = 'csv' | 'excel';
export type ItemMatrixVersion = 'v1' | 'v2' | 'v3';

interface MatrixColumn {
  key: string;
  header: string;
  unitName: string;
  variableId: string;
}

interface MatrixRow {
  bookletId: number;
  bookletName: string;
  personLogin: string;
  personCode: string;
  personGroup: string;
}

interface RawMatrixRow {
  bookletId: number;
  bookletName: string;
  personLogin: string;
  personCode: string;
  personGroup: string;
}

interface RawResponseValueRow {
  id: number;
  bookletId: number | string;
  bookletName: string;
  unitName: string;
  variableId: string;
  codeV1: number | string | null;
  scoreV1: number | string | null;
  codeV2: number | string | null;
  scoreV2: number | string | null;
  codeV3: number | string | null;
  scoreV3: number | string | null;
}

interface ResponseValue {
  code: number | null;
  score: number | null;
}

@Injectable()
export class CodingItemMatrixExportService {
  private readonly logger = new Logger(CodingItemMatrixExportService.name);
  private static readonly exportYieldEveryItems = 50;

  private readonly missingValueCache = new Map<string, ResolvedMissingValue>();

  constructor(
    @InjectRepository(ResponseEntity)
    private readonly responseRepository: Repository<ResponseEntity>,
    @InjectRepository(Booklet)
    private readonly bookletRepository: Repository<Booklet>,
    @InjectRepository(Unit)
    private readonly unitRepository: Repository<Unit>,
    private readonly workspaceFilesService: WorkspaceFilesService,
    private readonly workspaceExclusionService: WorkspaceExclusionService,
    @Optional()
    private readonly missingsProfilesService?: MissingsProfilesService
  ) {}

  private async yieldToEventLoop(): Promise<void> {
    await new Promise<void>(resolve => {
      setImmediate(resolve);
    });
  }

  private shouldYieldExportItem(index: number): boolean {
    return index > 0 &&
      index % CodingItemMatrixExportService.exportYieldEveryItems === 0;
  }

  private toNullableNumber(value: number | string | null | undefined): number | null {
    if (value === null || value === undefined || value === '') {
      return null;
    }

    const parsedValue = Number(value);
    return Number.isFinite(parsedValue) ? parsedValue : null;
  }

  exportItemMatrixAsCsvStream(
    workspaceId: number,
    value: ItemMatrixValue,
    version: ItemMatrixVersion = 'v2',
    progressCallback?: (percentage: number) => Promise<void>,
    checkCancellation?: () => Promise<void>
  ): NodeJS.ReadableStream {
    const outputStream = new PassThrough();

    (async () => {
      try {
        const context = await this.buildMatrixContext(workspaceId, checkCancellation);
        const headers = this.getHeaders(context.columns);
        const matrixStream = fastCsv.format({
          headers,
          delimiter: ';',
          alwaysWriteHeaders: true
        });

        matrixStream.on('error', error => outputStream.emit('error', error));
        matrixStream.pipe(outputStream);

        await this.writeRows(
          workspaceId,
          context.rows,
          context.columns,
          value,
          version,
          async row => {
            if (!matrixStream.write(row)) {
              await new Promise(resolve => {
                matrixStream.once('drain', resolve);
              });
              await checkCancellation?.();
            }
          },
          progressCallback,
          checkCancellation
        );

        await checkCancellation?.();
        matrixStream.end();
      } catch (error) {
        this.logger.error(`Error streaming item matrix export: ${error.message}`, error.stack);
        outputStream.emit('error', error);
      }
    })();

    return outputStream;
  }

  async exportItemMatrixAsExcel(
    workspaceId: number,
    value: ItemMatrixValue,
    version: ItemMatrixVersion = 'v2',
    progressCallback?: (percentage: number) => Promise<void>,
    checkCancellation?: () => Promise<void>
  ): Promise<Buffer> {
    const context = await this.buildMatrixContext(workspaceId, checkCancellation);
    const chunks: Buffer[] = [];
    const stream = new PassThrough();

    stream.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });

    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
      stream,
      useStyles: false,
      useSharedStrings: false
    });
    const worksheet = workbook.addWorksheet('Itemmatrix');
    worksheet.columns = this.getHeaders(context.columns).map(header => ({
      header,
      key: header,
      width: header.length > 24 ? 28 : 18
    }));

    const streamComplete = new Promise<void>((resolve, reject) => {
      stream.on('end', resolve);
      stream.on('error', reject);
    });

    await this.writeRows(
      workspaceId,
      context.rows,
      context.columns,
      value,
      version,
      async row => {
        worksheet.addRow(row).commit();
      },
      progressCallback,
      checkCancellation
    );

    await checkCancellation?.();
    await worksheet.commit();
    await workbook.commit();
    await streamComplete;
    await checkCancellation?.();

    return Buffer.concat(chunks);
  }

  async writeItemMatrixExcelToFile(
    filePath: string,
    workspaceId: number,
    value: ItemMatrixValue,
    version: ItemMatrixVersion = 'v2',
    progressCallback?: (percentage: number) => Promise<void>,
    checkCancellation?: () => Promise<void>
  ): Promise<void> {
    const context = await this.buildMatrixContext(workspaceId, checkCancellation);
    const outputStream = fs.createWriteStream(filePath);
    const streamComplete = new Promise<void>((resolve, reject) => {
      outputStream.on('finish', resolve);
      outputStream.on('error', reject);
    });
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
      stream: outputStream,
      useStyles: false,
      useSharedStrings: false
    });
    const worksheet = workbook.addWorksheet('Itemmatrix');
    worksheet.columns = this.getHeaders(context.columns).map(header => ({
      header,
      key: header,
      width: header.length > 24 ? 28 : 18
    }));

    try {
      await this.writeRows(
        workspaceId,
        context.rows,
        context.columns,
        value,
        version,
        async row => {
          worksheet.addRow(row).commit();
        },
        progressCallback,
        checkCancellation
      );

      await checkCancellation?.();
      await worksheet.commit();
      await workbook.commit();
      await streamComplete;
      await checkCancellation?.();
    } catch (error) {
      outputStream.destroy(error);
      await streamComplete.catch(() => undefined);
      if (this.isExportCancellationError(error)) {
        this.logger.log(`Item matrix Excel export cancelled: ${error.message}`);
      }
      throw error;
    }
  }

  private async buildMatrixContext(
    workspaceId: number,
    checkCancellation?: () => Promise<void>
  ): Promise<{
      rows: MatrixRow[];
      columns: MatrixColumn[];
    }> {
    this.missingValueCache.clear();
    await checkCancellation?.();
    const [rows, columns] = await Promise.all([
      this.getRows(workspaceId, checkCancellation),
      this.getColumns(workspaceId, checkCancellation)
    ]);
    await checkCancellation?.();

    this.logger.log(
      `Prepared item matrix context for workspace ${workspaceId}: ${rows.length} rows, ${columns.length} columns`
    );

    return { rows, columns };
  }

  private getHeaders(columns: MatrixColumn[]): string[] {
    return [
      'person_login',
      'person_code',
      'person_group',
      'booklet_name',
      ...columns.map(column => column.header)
    ];
  }

  private async getRows(
    workspaceId: number,
    checkCancellation?: () => Promise<void>
  ): Promise<MatrixRow[]> {
    await checkCancellation?.();
    const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
    await checkCancellation?.();
    const rows = await this.bookletRepository
      .createQueryBuilder('booklet')
      .innerJoin('booklet.person', 'person')
      .innerJoin('booklet.bookletinfo', 'bookletinfo')
      .select('booklet.id', 'bookletId')
      .addSelect('bookletinfo.name', 'bookletName')
      .addSelect('person.login', 'personLogin')
      .addSelect('person.code', 'personCode')
      .addSelect('person.group', 'personGroup')
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true })
      .orderBy('person.group', 'ASC')
      .addOrderBy('person.login', 'ASC')
      .addOrderBy('person.code', 'ASC')
      .addOrderBy('bookletinfo.name', 'ASC')
      .getRawMany<RawMatrixRow>();
    await checkCancellation?.();

    return rows
      .filter(row => !isExcludedByResolvedExclusions(exclusions, row.bookletName, ''))
      .map(row => ({
        bookletId: Number(row.bookletId),
        bookletName: row.bookletName || '',
        personLogin: row.personLogin || '',
        personCode: row.personCode || '',
        personGroup: row.personGroup || ''
      }));
  }

  private async getColumns(
    workspaceId: number,
    checkCancellation?: () => Promise<void>
  ): Promise<MatrixColumn[]> {
    await checkCancellation?.();
    const [unitVariableMap, unitAliases, exclusions] = await Promise.all([
      this.workspaceFilesService.getUnitVariableMap(workspaceId),
      this.getUnitAliases(workspaceId, checkCancellation),
      this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId)
    ]);
    await checkCancellation?.();

    const preferredHeaders = new Map<string, number>();
    const columns: MatrixColumn[] = [];

    for (const [unitName, variables] of Array.from(unitVariableMap.entries())
      .sort(([unitA], [unitB]) => unitA.localeCompare(unitB))) {
      await checkCancellation?.();
      if (isExcludedByResolvedExclusions(exclusions, '', unitName)) {
        continue;
      }

      const sortedVariables = Array.from(variables).sort((a, b) => a.localeCompare(b));
      for (let variableIndex = 0; variableIndex < sortedVariables.length; variableIndex += 1) {
        if (this.shouldYieldExportItem(variableIndex)) {
          await checkCancellation?.();
          await this.yieldToEventLoop();
        }

        const variableId = sortedVariables[variableIndex];
        const alias = unitAliases.get(normalizeExclusionUnitId(unitName));
        const preferredHeader = `${alias || unitName}__${variableId}`;
        const header = this.createUniqueHeader(
          preferredHeader,
          `${unitName}__${variableId}`,
          preferredHeaders
        );
        columns.push({
          key: `${normalizeExclusionUnitId(unitName)}\u001F${variableId}`,
          header,
          unitName,
          variableId
        });
      }
    }

    return columns;
  }

  private createUniqueHeader(
    preferredHeader: string,
    fallbackHeader: string,
    seen: Map<string, number>
  ): string {
    if (!seen.has(preferredHeader)) {
      seen.set(preferredHeader, 1);
      return preferredHeader;
    }

    if (!seen.has(fallbackHeader)) {
      seen.set(fallbackHeader, 1);
      return fallbackHeader;
    }

    const nextCount = (seen.get(fallbackHeader) || 1) + 1;
    seen.set(fallbackHeader, nextCount);
    return `${fallbackHeader}__${nextCount}`;
  }

  private async getUnitAliases(
    workspaceId: number,
    checkCancellation?: () => Promise<void>
  ): Promise<Map<string, string>> {
    await checkCancellation?.();
    const rows = await this.unitRepository
      .createQueryBuilder('unit')
      .innerJoin('unit.booklet', 'booklet')
      .innerJoin('booklet.person', 'person')
      .select('unit.name', 'unitName')
      .addSelect('unit.alias', 'unitAlias')
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('unit.alias IS NOT NULL')
      .andWhere("unit.alias != ''")
      .distinct(true)
      .getRawMany<{ unitName: string; unitAlias: string }>();
    await checkCancellation?.();

    const aliasesByUnit = new Map<string, Set<string>>();
    for (const row of rows) {
      const normalizedUnit = normalizeExclusionUnitId(row.unitName);
      const alias = String(row.unitAlias || '').trim();
      if (!normalizedUnit || !alias) {
        continue;
      }
      const aliases = aliasesByUnit.get(normalizedUnit) || new Set<string>();
      aliases.add(alias);
      aliasesByUnit.set(normalizedUnit, aliases);
    }

    const stableAliases = new Map<string, string>();
    aliasesByUnit.forEach((aliases, unitName) => {
      if (aliases.size === 1) {
        stableAliases.set(unitName, Array.from(aliases)[0]);
      }
    });
    return stableAliases;
  }

  private async writeRows(
    workspaceId: number,
    rows: MatrixRow[],
    columns: MatrixColumn[],
    value: ItemMatrixValue,
    version: ItemMatrixVersion,
    writeRow: (row: Record<string, string | number>) => Promise<void>,
    progressCallback?: (percentage: number) => Promise<void>,
    checkCancellation?: () => Promise<void>
  ): Promise<void> {
    const batchSize = 100;
    let written = 0;

    for (let start = 0; start < rows.length; start += batchSize) {
      await checkCancellation?.();
      const batchRows = rows.slice(start, start + batchSize);
      const responseValues = await this.getResponseValuesForRows(
        workspaceId,
        batchRows,
        version,
        checkCancellation
      );
      await checkCancellation?.();

      for (let rowIndex = 0; rowIndex < batchRows.length; rowIndex += 1) {
        if (this.shouldYieldExportItem(rowIndex)) {
          await checkCancellation?.();
          await this.yieldToEventLoop();
        }

        const row = batchRows[rowIndex];
        await checkCancellation?.();
        const exportRow: Record<string, string | number> = {
          person_login: row.personLogin,
          person_code: row.personCode,
          person_group: row.personGroup,
          booklet_name: row.bookletName
        };
        const rowValues = responseValues.get(row.bookletId) || new Map<string, ResponseValue>();

        for (let columnIndex = 0; columnIndex < columns.length; columnIndex += 1) {
          if (this.shouldYieldExportItem(columnIndex)) {
            await checkCancellation?.();
            await this.yieldToEventLoop();
          }

          const column = columns[columnIndex];
          const cellValue = rowValues.get(column.key);
          exportRow[column.header] = cellValue ?
            await this.resolveExportCellValue(workspaceId, cellValue, value) :
            '';
        }

        await writeRow(exportRow);
        written += 1;
      }

      if (progressCallback && rows.length > 0) {
        await progressCallback(Math.min(100, Math.round((written / rows.length) * 100)));
      }

      await this.yieldToEventLoop();
    }
  }

  private async getResponseValuesForRows(
    workspaceId: number,
    rows: MatrixRow[],
    version: ItemMatrixVersion,
    checkCancellation?: () => Promise<void>
  ): Promise<Map<number, Map<string, ResponseValue>>> {
    if (rows.length === 0) {
      return new Map();
    }

    await checkCancellation?.();
    const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
    await checkCancellation?.();
    const unitVariableMap = await this.workspaceFilesService.getUnitVariableMap(workspaceId);
    await checkCancellation?.();
    const validPairs = new Set(
      Array.from(unitVariableMap.entries()).flatMap(([unitName, variables]) => (
        Array.from(variables).map(variableId => `${normalizeExclusionUnitId(unitName)}\u001F${variableId}`)
      ))
    );
    const bookletIds = rows.map(row => row.bookletId);
    const responses = await this.responseRepository
      .createQueryBuilder('response')
      .innerJoin('response.unit', 'unit')
      .innerJoin('unit.booklet', 'booklet')
      .innerJoin('booklet.bookletinfo', 'bookletinfo')
      .select('response.id', 'id')
      .addSelect('booklet.id', 'bookletId')
      .addSelect('bookletinfo.name', 'bookletName')
      .addSelect('unit.name', 'unitName')
      .addSelect('response.variableid', 'variableId')
      .addSelect('response.code_v1', 'codeV1')
      .addSelect('response.score_v1', 'scoreV1')
      .addSelect('response.code_v2', 'codeV2')
      .addSelect('response.score_v2', 'scoreV2')
      .addSelect('response.code_v3', 'codeV3')
      .addSelect('response.score_v3', 'scoreV3')
      .where('booklet.id IN (:...bookletIds)', { bookletIds })
      .orderBy('response.id', 'ASC')
      .getRawMany<RawResponseValueRow>();
    await checkCancellation?.();
    const result = new Map<number, Map<string, ResponseValue>>();

    for (let index = 0; index < responses.length; index += 1) {
      if (index % 500 === 0) {
        await checkCancellation?.();
      }
      const response = responses[index];
      const unitName = response.unitName || '';
      const bookletName = response.bookletName || '';
      if (isExcludedByResolvedExclusions(exclusions, bookletName, unitName)) {
        continue;
      }

      const variableId = response.variableId || '';
      const responseKey = `${normalizeExclusionUnitId(unitName)}\u001F${variableId}`;
      if (!validPairs.has(responseKey)) {
        continue;
      }

      const bookletId = Number(response.bookletId);
      if (!result.has(bookletId)) {
        result.set(bookletId, new Map());
      }
      result.get(bookletId)!.set(responseKey, this.getVersionedValue(response, version));
    }

    return result;
  }

  private getVersionedValue(
    response: ResponseEntity | RawResponseValueRow,
    version: ItemMatrixVersion
  ): ResponseValue {
    switch (version) {
      case 'v1':
        return 'code_v1' in response ?
          { code: response.code_v1, score: response.score_v1 } :
          {
            code: this.toNullableNumber(response.codeV1),
            score: this.toNullableNumber(response.scoreV1)
          };
      case 'v2':
        return 'code_v2' in response ?
          { code: response.code_v2, score: response.score_v2 } :
          {
            code: this.toNullableNumber(response.codeV2),
            score: this.toNullableNumber(response.scoreV2)
          };
      case 'v3':
        return 'code_v3' in response ?
          { code: response.code_v3, score: response.score_v3 } :
          {
            code: this.toNullableNumber(response.codeV3),
            score: this.toNullableNumber(response.scoreV3)
          };
      default:
        throw new Error(`Unsupported item-matrix version: ${version}`);
    }
  }

  private isExportCancellationError(error: Error): boolean {
    return /^Export job .* was cancelled$/.test(error.message);
  }

  private async resolveExportCellValue(
    workspaceId: number,
    value: ResponseValue,
    requestedValue: ItemMatrixValue
  ): Promise<string | number> {
    const missing = await this.resolveMissingValue(workspaceId, value.code);
    if (requestedValue === 'score') {
      if (value.score !== null && value.score !== undefined) {
        return value.score;
      }
      if (missing) {
        return missing.score === null ? 'NA' : missing.score;
      }
      return value.code !== null && value.code < 0 ? 'NA' : '';
    }

    return missing?.code ?? mapCodeForExport(value.code) ?? '';
  }

  private async resolveMissingValue(
    workspaceId: number,
    code: number | null
  ): Promise<ResolvedMissingValue | null> {
    if (code !== -3 && code !== -4) {
      return null;
    }

    const cacheKey = `${workspaceId}:id:${code === -3 ? 'mir' : 'mci'}`;

    if (this.missingValueCache.has(cacheKey)) {
      return this.missingValueCache.get(cacheKey)!;
    }

    if (!this.missingsProfilesService) {
      return null;
    }

    const missing = await this.missingsProfilesService.getMissingByIdForProfileOrDefault(
      workspaceId,
      null,
      code === -3 ? 'mir' : 'mci'
    );

    this.missingValueCache.set(cacheKey, missing);
    return missing;
  }
}
