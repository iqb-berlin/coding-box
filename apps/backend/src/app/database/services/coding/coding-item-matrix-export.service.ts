import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as ExcelJS from 'exceljs';
import * as fastCsv from 'fast-csv';
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

interface ResponseValue {
  code: number | null;
  score: number | null;
}

@Injectable()
export class CodingItemMatrixExportService {
  private readonly logger = new Logger(CodingItemMatrixExportService.name);

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
        const context = await this.buildMatrixContext(workspaceId);
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
            }
          },
          progressCallback,
          checkCancellation
        );

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
    const context = await this.buildMatrixContext(workspaceId);
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

    await worksheet.commit();
    await workbook.commit();
    await streamComplete;

    return Buffer.concat(chunks);
  }

  private async buildMatrixContext(workspaceId: number): Promise<{
    rows: MatrixRow[];
    columns: MatrixColumn[];
  }> {
    this.missingValueCache.clear();
    const [rows, columns] = await Promise.all([
      this.getRows(workspaceId),
      this.getColumns(workspaceId)
    ]);

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

  private async getRows(workspaceId: number): Promise<MatrixRow[]> {
    const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
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

  private async getColumns(workspaceId: number): Promise<MatrixColumn[]> {
    const [unitVariableMap, unitAliases, exclusions] = await Promise.all([
      this.workspaceFilesService.getUnitVariableMap(workspaceId),
      this.getUnitAliases(workspaceId),
      this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId)
    ]);

    const preferredHeaders = new Map<string, number>();
    const columns: MatrixColumn[] = [];

    Array.from(unitVariableMap.entries())
      .sort(([unitA], [unitB]) => unitA.localeCompare(unitB))
      .forEach(([unitName, variables]) => {
        if (isExcludedByResolvedExclusions(exclusions, '', unitName)) {
          return;
        }

        Array.from(variables)
          .sort((a, b) => a.localeCompare(b))
          .forEach(variableId => {
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
          });
      });

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

  private async getUnitAliases(workspaceId: number): Promise<Map<string, string>> {
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

    const aliasesByUnit = new Map<string, Set<string>>();
    rows.forEach(row => {
      const normalizedUnit = normalizeExclusionUnitId(row.unitName);
      const alias = String(row.unitAlias || '').trim();
      if (!normalizedUnit || !alias) {
        return;
      }
      const aliases = aliasesByUnit.get(normalizedUnit) || new Set<string>();
      aliases.add(alias);
      aliasesByUnit.set(normalizedUnit, aliases);
    });

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
        version
      );

      for (const row of batchRows) {
        const exportRow: Record<string, string | number> = {
          person_login: row.personLogin,
          person_code: row.personCode,
          person_group: row.personGroup,
          booklet_name: row.bookletName
        };
        const rowValues = responseValues.get(row.bookletId) || new Map<string, ResponseValue>();

        for (const column of columns) {
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

      await new Promise(resolve => {
        setImmediate(resolve);
      });
    }
  }

  private async getResponseValuesForRows(
    workspaceId: number,
    rows: MatrixRow[],
    version: ItemMatrixVersion
  ): Promise<Map<number, Map<string, ResponseValue>>> {
    if (rows.length === 0) {
      return new Map();
    }

    const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
    const unitVariableMap = await this.workspaceFilesService.getUnitVariableMap(workspaceId);
    const validPairs = new Set(
      Array.from(unitVariableMap.entries()).flatMap(([unitName, variables]) => (
        Array.from(variables).map(variableId => `${normalizeExclusionUnitId(unitName)}\u001F${variableId}`)
      ))
    );
    const bookletIds = rows.map(row => row.bookletId);
    const responses = await this.responseRepository
      .createQueryBuilder('response')
      .innerJoinAndSelect('response.unit', 'unit')
      .innerJoinAndSelect('unit.booklet', 'booklet')
      .innerJoinAndSelect('booklet.bookletinfo', 'bookletinfo')
      .where('booklet.id IN (:...bookletIds)', { bookletIds })
      .orderBy('response.id', 'ASC')
      .getMany();
    const result = new Map<number, Map<string, ResponseValue>>();

    for (const response of responses) {
      const unitName = response.unit?.name || '';
      const bookletName = response.unit?.booklet?.bookletinfo?.name || '';
      if (isExcludedByResolvedExclusions(exclusions, bookletName, unitName)) {
        continue;
      }

      const key = `${normalizeExclusionUnitId(unitName)}\u001F${response.variableid}`;
      if (!validPairs.has(key)) {
        continue;
      }

      const bookletId = response.unit.bookletid;
      if (!result.has(bookletId)) {
        result.set(bookletId, new Map());
      }
      result.get(bookletId)!.set(key, this.getVersionedValue(response, version));
    }

    return result;
  }

  private getVersionedValue(
    response: ResponseEntity,
    version: ItemMatrixVersion
  ): ResponseValue {
    switch (version) {
      case 'v1':
        return { code: response.code_v1, score: response.score_v1 };
      case 'v2':
        return { code: response.code_v2, score: response.score_v2 };
      case 'v3':
        return { code: response.code_v3, score: response.score_v3 };
      default:
        throw new Error(`Unsupported item-matrix version: ${version}`);
    }
  }

  private async resolveExportCellValue(
    workspaceId: number,
    value: ResponseValue,
    requestedValue: ItemMatrixValue
  ): Promise<string | number> {
    const missing = await this.resolveMissingValue(workspaceId, value.code);
    if (requestedValue === 'score') {
      return value.score ?? missing?.score ?? '';
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
