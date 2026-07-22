import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as ExcelJS from 'exceljs';
import * as fastCsv from 'fast-csv';
import * as fs from 'fs';
import { PassThrough, Stream } from 'stream';
import { Repository } from 'typeorm';
import {
  ItemDatasetNotReachedScope,
  ItemDatasetOptionsDto,
  ItemDatasetSelection
} from '../../../../../../../api-dto/coding/export-request.dto';
import {
  ItemDatasetResponseKey,
  ItemDatasetSelectionKey
} from '../../../../../../../api-dto/coding/item-dataset-key';
import { Booklet } from '../../entities/booklet.entity';
import { ResponseEntity } from '../../entities/response.entity';
import {
  isExcludedByResolvedExclusions,
  normalizeExclusionBookletId,
  WorkspaceExclusionService
} from '../workspace/workspace-exclusion.service';
import { WorkspaceFilesService } from '../workspace/workspace-files.service';
import {
  IqbStandardMissingId,
  MissingsProfilesService,
  ResolvedMissingValue
} from './missings-profiles.service';
import {
  ItemDatasetBookletDesign,
  ItemDatasetCellResolver,
  ItemDatasetColumn,
  ItemDatasetProfile,
  ItemDatasetResponseValue,
  ResolvedItemDatasetCell
} from './item-dataset-cell-resolver';
import {
  ItemDatasetColumnResolution,
  ItemDatasetMetadataService
} from './item-dataset-metadata.service';

export type ItemMatrixValue = 'code' | 'score';
export type ItemMatrixFormat = 'csv' | 'excel';
export type ItemMatrixVersion = 'v1' | 'v2' | 'v3';

export interface ItemMatrixExportConfiguration {
  missingsProfileId: number;
  notReachedScope?: ItemDatasetNotReachedScope;
  recodeTrailingOmissions?: boolean;
  items?: ItemDatasetSelection[];
}

type MatrixColumn = ItemDatasetColumn;

interface MatrixRow {
  bookletId: number;
  bookletName: string;
  personLogin: string;
  personCode: string;
  personGroup: string;
}

interface RawMatrixRow extends MatrixRow {}

interface RawResponseValueRow {
  id: number;
  bookletId: number | string;
  bookletName: string;
  unitName: string;
  variableId: string;
  status: number | string | null;
  codeV1: number | string | null;
  scoreV1: number | string | null;
  codeV2: number | string | null;
  scoreV2: number | string | null;
  codeV3: number | string | null;
  scoreV3: number | string | null;
}

type ResponseValue = ItemDatasetResponseValue;

type BookletDesign = ItemDatasetBookletDesign;

type ProfileDefinitions = ItemDatasetProfile;

type ResolvedCell = ResolvedItemDatasetCell;

interface MatrixContext {
  rows: MatrixRow[];
  columns: MatrixColumn[];
  analysisColumns: MatrixColumn[];
  bookletDesigns: Map<string, BookletDesign>;
  profile: ProfileDefinitions;
  derivedSources: Map<string, string[]>;
}

const requiredMissingIds: IqbStandardMissingId[] = [
  'mir',
  'mci',
  'mbi_mbo',
  'mnr',
  'mbd'
];

const fixedHeaders = [
  'person_login',
  'person_code',
  'person_group',
  'booklet_name'
] as const;

@Injectable()
export class CodingItemMatrixExportService {
  private readonly logger = new Logger(CodingItemMatrixExportService.name);
  private readonly cellResolver = new ItemDatasetCellResolver();
  private static readonly exportYieldEveryItems = 50;

  constructor(
    @InjectRepository(ResponseEntity)
    private readonly responseRepository: Repository<ResponseEntity>,
    @InjectRepository(Booklet)
    private readonly bookletRepository: Repository<Booklet>,
    private readonly workspaceFilesService: WorkspaceFilesService,
    private readonly workspaceExclusionService: WorkspaceExclusionService,
    private readonly missingsProfilesService: MissingsProfilesService,
    private readonly metadataService: ItemDatasetMetadataService
  ) {}

  async getItemDatasetOptions(
    workspaceId: number
  ): Promise<ItemDatasetOptionsDto> {
    const result = await this.buildColumns(workspaceId);
    return {
      items: result.columns.map(column => ({
        unitId: column.unitId,
        unitLabel: column.header.slice(
          0,
          Math.max(0, column.header.length - column.itemId.length - 1)
        ),
        itemId: column.itemId,
        itemLabel: column.itemLabel,
        columnName: column.header
      })),
      mappingIssues: result.issues,
      mappingWarnings: result.warnings
    };
  }

  exportItemMatrixAsCsvStream(
    workspaceId: number,
    value: ItemMatrixValue,
    version: ItemMatrixVersion,
    configuration: ItemMatrixExportConfiguration,
    progressCallback?: (percentage: number) => Promise<void>,
    checkCancellation?: () => Promise<void>
  ): NodeJS.ReadableStream {
    const outputStream = new PassThrough();

    (async () => {
      try {
        const context = await this.buildMatrixContext(
          workspaceId,
          configuration,
          checkCancellation
        );
        const matrixStream = fastCsv.format({
          headers: this.getHeaders(context.columns),
          delimiter: ';',
          alwaysWriteHeaders: true
        });
        matrixStream.on('error', error => outputStream.emit('error', error));
        matrixStream.pipe(outputStream);

        for await (const row of this.resolveRows(
          workspaceId,
          context,
          value,
          version,
          configuration,
          progressCallback,
          checkCancellation
        )) {
          if (!matrixStream.write(row)) {
            await new Promise(resolve => {
              matrixStream.once('drain', resolve);
            });
            await checkCancellation?.();
          }
        }
        await checkCancellation?.();
        matrixStream.end();
      } catch (error) {
        const exportError = error as Error;
        this.logger.error(
          `Error streaming item dataset export: ${exportError.message}`,
          exportError.stack
        );
        outputStream.emit('error', exportError);
      }
    })();

    return outputStream;
  }

  async exportItemMatrixAsExcel(
    workspaceId: number,
    value: ItemMatrixValue,
    version: ItemMatrixVersion,
    configuration: ItemMatrixExportConfiguration,
    progressCallback?: (percentage: number) => Promise<void>,
    checkCancellation?: () => Promise<void>
  ): Promise<Buffer> {
    const chunks: Buffer[] = [];
    const stream = new PassThrough();
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    await this.writeExcel(
      stream,
      workspaceId,
      value,
      version,
      configuration,
      progressCallback,
      checkCancellation
    );
    return Buffer.concat(chunks);
  }

  async writeItemMatrixExcelToFile(
    filePath: string,
    workspaceId: number,
    value: ItemMatrixValue,
    version: ItemMatrixVersion,
    configuration: ItemMatrixExportConfiguration,
    progressCallback?: (percentage: number) => Promise<void>,
    checkCancellation?: () => Promise<void>
  ): Promise<void> {
    const outputStream = fs.createWriteStream(filePath);
    const streamComplete = new Promise<void>((resolve, reject) => {
      outputStream.once('finish', resolve);
      outputStream.once('error', reject);
    });
    streamComplete.catch(() => undefined);
    try {
      await this.writeExcel(
        outputStream,
        workspaceId,
        value,
        version,
        configuration,
        progressCallback,
        checkCancellation
      );
      await streamComplete;
    } catch (error) {
      outputStream.destroy(error as Error);
      await streamComplete.catch(() => undefined);
      if (this.isExportCancellationError(error as Error)) {
        this.logger.log(
          `Item dataset Excel export cancelled: ${(error as Error).message}`
        );
      }
      throw error;
    }
  }

  private async writeExcel(
    stream: Stream,
    workspaceId: number,
    value: ItemMatrixValue,
    version: ItemMatrixVersion,
    configuration: ItemMatrixExportConfiguration,
    progressCallback?: (percentage: number) => Promise<void>,
    checkCancellation?: () => Promise<void>
  ): Promise<void> {
    const context = await this.buildMatrixContext(
      workspaceId,
      configuration,
      checkCancellation
    );
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
      stream,
      useStyles: false,
      useSharedStrings: false
    });
    const worksheet = workbook.addWorksheet('Itemdatensatz');
    worksheet.columns = this.getHeaders(context.columns).map(header => ({
      header,
      key: header,
      width: header.length > 24 ? 28 : 18
    }));

    for await (const row of this.resolveRows(
      workspaceId,
      context,
      value,
      version,
      configuration,
      progressCallback,
      checkCancellation
    )) {
      worksheet.addRow(row).commit();
    }
    await checkCancellation?.();
    await worksheet.commit();
    await workbook.commit();
    await checkCancellation?.();
  }

  private async buildMatrixContext(
    workspaceId: number,
    configuration: ItemMatrixExportConfiguration,
    checkCancellation?: () => Promise<void>
  ): Promise<MatrixContext> {
    this.assertConfiguration(configuration);
    await checkCancellation?.();
    const [rows, columnResult, bookletDesigns, profile, derivedSources] =
      await Promise.all([
        this.getRows(workspaceId, checkCancellation),
        this.buildColumns(workspaceId, undefined, checkCancellation),
        this.getBookletDesigns(workspaceId, checkCancellation),
        this.loadAndValidateProfile(
          workspaceId,
          configuration.missingsProfileId
        ),
        this.getDerivedSources(workspaceId)
      ]);
    const orderedColumns = this.sortColumnsByBookletDesigns(
      columnResult.columns,
      bookletDesigns
    );
    const selectedColumns = this.filterColumns(
      orderedColumns,
      configuration.items
    );
    const issues = [...columnResult.issues, ...selectedColumns.issues];
    if (issues.length > 0) {
      const issueMessages = issues.map(issue => issue.message).join('; ');
      throw new BadRequestException(
        `Item-Metadaten sind unvollständig oder mehrdeutig: ${issueMessages}`
      );
    }
    if (selectedColumns.columns.length === 0) {
      throw new BadRequestException(
        'Für den Itemdatensatz wurden keine gültigen Items ausgewählt'
      );
    }

    const missingBookletStructures = Array.from(
      new Set(
        rows
          .map(row => row.bookletName)
          .filter(
            bookletName => !bookletDesigns.has(normalizeExclusionBookletId(bookletName))
          )
      )
    );
    if (missingBookletStructures.length > 0) {
      throw new BadRequestException(
        `Booklet-Struktur für Itemdatensatz nicht gefunden: ${missingBookletStructures.join(', ')}`
      );
    }

    this.logger.log(
      `Prepared item dataset context for workspace ${workspaceId}: ` +
        `${rows.length} rows, ${selectedColumns.columns.length} columns`
    );
    return {
      rows,
      columns: selectedColumns.columns,
      analysisColumns: orderedColumns,
      bookletDesigns,
      profile,
      derivedSources
    };
  }

  private assertConfiguration(
    configuration: ItemMatrixExportConfiguration
  ): void {
    if (
      !configuration ||
      !Number.isSafeInteger(configuration.missingsProfileId) ||
      configuration.missingsProfileId <= 0
    ) {
      throw new BadRequestException(
        'Für den Itemdatensatz muss ein Missing-Profil gewählt werden'
      );
    }
    const scope = configuration.notReachedScope || 'unit';
    if (configuration.recodeTrailingOmissions && scope === 'unit') {
      throw new BadRequestException(
        'Abschließende Auslassungen können nur pro Testlet oder Booklet rekodiert werden'
      );
    }
  }

  private async loadAndValidateProfile(
    workspaceId: number,
    profileId: number
  ): Promise<ProfileDefinitions> {
    const profile =
      await this.missingsProfilesService.getMissingsProfileDetails(
        workspaceId,
        profileId
      );
    if (!profile) {
      throw new BadRequestException(
        `Missing-Profil ${profileId} wurde nicht gefunden`
      );
    }
    const entries = profile.parseMissings();
    const byId = new Map<IqbStandardMissingId, ResolvedMissingValue>();
    const byCode = new Map<number, ResolvedMissingValue>();

    entries.forEach(entry => {
      if (!Object.prototype.hasOwnProperty.call(entry, 'score')) {
        throw new BadRequestException(
          `Missing '${entry.id}' in Profil ${profileId} hat kein score-Property`
        );
      }
      const resolved: ResolvedMissingValue = {
        id: entry.id,
        label: entry.label,
        code: Number(entry.code),
        score: entry.score === null ? null : Number(entry.score)
      };
      if (
        !Number.isInteger(resolved.code) ||
        (resolved.score !== null && !Number.isFinite(resolved.score))
      ) {
        throw new BadRequestException(
          `Missing '${entry.id}' in Profil ${profileId} ist ungültig`
        );
      }
      byCode.set(resolved.code, resolved);
      if (requiredMissingIds.includes(entry.id as IqbStandardMissingId)) {
        byId.set(entry.id as IqbStandardMissingId, resolved);
      }
    });

    const missingIds = requiredMissingIds.filter(id => !byId.has(id));
    if (missingIds.length > 0) {
      throw new BadRequestException(
        `Missing-Profil ${profileId} enthält nicht: ${missingIds.join(', ')}`
      );
    }
    return { byId, byCode };
  }

  private async buildColumns(
    workspaceId: number,
    selection?: ItemDatasetSelection[],
    checkCancellation?: () => Promise<void>
  ): Promise<ItemDatasetColumnResolution> {
    return this.metadataService.buildColumns(
      workspaceId,
      selection,
      checkCancellation
    );
  }

  private filterColumns(
    columns: MatrixColumn[],
    selection?: ItemDatasetSelection[]
  ): ItemDatasetColumnResolution {
    return this.metadataService.filterColumns(columns, selection);
  }

  private sortColumnsByBookletDesigns(
    columns: MatrixColumn[],
    designs: Map<string, BookletDesign>
  ): MatrixColumn[] {
    return this.metadataService.sortColumnsByBookletDesigns(columns, designs);
  }

  private async getBookletDesigns(
    workspaceId: number,
    checkCancellation?: () => Promise<void>
  ): Promise<Map<string, BookletDesign>> {
    return this.metadataService.getBookletDesigns(
      workspaceId,
      checkCancellation
    );
  }

  private async getDerivedSources(
    workspaceId: number
  ): Promise<Map<string, string[]>> {
    return this.metadataService.getDerivedSources(workspaceId);
  }

  private getHeaders(columns: MatrixColumn[]): string[] {
    return [...fixedHeaders, ...columns.map(column => column.header)];
  }

  private async getRows(
    workspaceId: number,
    checkCancellation?: () => Promise<void>
  ): Promise<MatrixRow[]> {
    const exclusions =
      await this.workspaceExclusionService.resolveExclusionsForQueries(
        workspaceId
      );
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
    return rows
      .filter(
        row => !isExcludedByResolvedExclusions(exclusions, row.bookletName, '')
      )
      .map(row => ({
        bookletId: Number(row.bookletId),
        bookletName: row.bookletName || '',
        personLogin: row.personLogin || '',
        personCode: row.personCode || '',
        personGroup: row.personGroup || ''
      }));
  }

  private async* resolveRows(
    workspaceId: number,
    context: MatrixContext,
    requestedValue: ItemMatrixValue,
    version: ItemMatrixVersion,
    configuration: ItemMatrixExportConfiguration,
    progressCallback?: (percentage: number) => Promise<void>,
    checkCancellation?: () => Promise<void>
  ): AsyncGenerator<Record<string, string | number>> {
    const batchSize = 100;
    let written = 0;
    for (let start = 0; start < context.rows.length; start += batchSize) {
      await checkCancellation?.();
      const rows = context.rows.slice(start, start + batchSize);
      const valuesByBooklet = await this.getResponseValuesForRows(
        workspaceId,
        rows,
        version,
        checkCancellation
      );
      for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
        await this.checkExportCancellationPoint(rowIndex, checkCancellation);
        const row = rows[rowIndex];
        const design = context.bookletDesigns.get(
          normalizeExclusionBookletId(row.bookletName)
        );
        if (!design) {
          throw new BadRequestException(
            `Booklet-Struktur für Itemdatensatz nicht gefunden: ${row.bookletName}`
          );
        }
        const responseValues = valuesByBooklet.get(row.bookletId) || new Map();
        const analysisColumns = context.analysisColumns || context.columns;
        const cells = await this.resolveRowCells(
          analysisColumns,
          design,
          responseValues,
          context.profile,
          context.derivedSources,
          configuration,
          checkCancellation
        );
        const exportRow: Record<string, string | number> = {
          person_login: row.personLogin,
          person_code: row.personCode,
          person_group: row.personGroup,
          booklet_name: row.bookletName
        };
        const cellsByItem = new Map<string, ResolvedCell>();
        for (let index = 0; index < analysisColumns.length; index += 1) {
          await this.checkExportCancellationPoint(index, checkCancellation);
          const column = analysisColumns[index];
          cellsByItem.set(
            this.getSelectionKey(column.unitId, column.itemId),
            cells[index]
          );
        }
        for (let index = 0; index < context.columns.length; index += 1) {
          await this.checkExportCancellationPoint(index, checkCancellation);
          const column = context.columns[index];
          exportRow[column.header] = this.getExportValue(
            cellsByItem.get(
              this.getSelectionKey(column.unitId, column.itemId)
            ) || this.unresolvedCell(),
            requestedValue
          );
        }
        yield exportRow;
        written += 1;
      }
      if (progressCallback && context.rows.length > 0) {
        await progressCallback(
          Math.min(100, Math.round((written / context.rows.length) * 100))
        );
      }
      await this.yieldToEventLoop();
    }
  }

  private async resolveRowCells(
    columns: MatrixColumn[],
    design: BookletDesign,
    responseValues: Map<string, ResponseValue>,
    profile: ProfileDefinitions,
    derivedSources: Map<string, string[]>,
    configuration: ItemMatrixExportConfiguration,
    checkCancellation?: () => Promise<void>
  ): Promise<ResolvedCell[]> {
    await checkCancellation?.();
    const resolution = this.cellResolver.resolveIncrementally(
      columns,
      design,
      responseValues,
      profile,
      derivedSources,
      configuration
    );
    let step = resolution.next();
    while (!step.done) {
      await checkCancellation?.();
      await this.yieldToEventLoop();
      step = resolution.next();
    }
    await checkCancellation?.();
    return step.value;
  }

  private unresolvedCell(): ResolvedCell {
    return this.cellResolver.unresolvedCell();
  }

  private getExportValue(
    cell: ResolvedCell,
    requestedValue: ItemMatrixValue
  ): string | number {
    return this.cellResolver.getExportValue(cell, requestedValue);
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
    const exclusions =
      await this.workspaceExclusionService.resolveExclusionsForQueries(
        workspaceId
      );
    const validMap =
      await this.workspaceFilesService.getUnitVariableMap(workspaceId);
    const validPairs = new Set(
      Array.from(validMap.entries()).flatMap(([unitName, variables]) => Array.from(variables).map(variable => this.getResponseKey(unitName, variable)
      )
      )
    );
    await checkCancellation?.();
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
      .addSelect('response.status', 'status')
      .addSelect('response.code_v1', 'codeV1')
      .addSelect('response.score_v1', 'scoreV1')
      .addSelect('response.code_v2', 'codeV2')
      .addSelect('response.score_v2', 'scoreV2')
      .addSelect('response.code_v3', 'codeV3')
      .addSelect('response.score_v3', 'scoreV3')
      .where('booklet.id IN (:...bookletIds)', {
        bookletIds: rows.map(row => row.bookletId)
      })
      .orderBy('response.id', 'ASC')
      .getRawMany<RawResponseValueRow>();
    await checkCancellation?.();
    const result = new Map<number, Map<string, ResponseValue>>();
    for (let index = 0; index < responses.length; index += 1) {
      if (index % 500 === 0) {
        await checkCancellation?.();
        await this.yieldToEventLoop();
      }
      const response = responses[index];
      if (
        isExcludedByResolvedExclusions(
          exclusions,
          response.bookletName || '',
          response.unitName || ''
        )
      ) {
        continue;
      }
      const key = this.getResponseKey(
        response.unitName || '',
        response.variableId || ''
      );
      if (!validPairs.has(key)) {
        continue;
      }
      const bookletId = Number(response.bookletId);
      const values = result.get(bookletId) || new Map<string, ResponseValue>();
      values.set(key, this.getVersionedValue(response, version));
      result.set(bookletId, values);
    }
    return result;
  }

  private getVersionedValue(
    response: ResponseEntity | RawResponseValueRow,
    version: ItemMatrixVersion
  ): ResponseValue {
    const hydrated = 'code_v1' in response;
    const status = hydrated ?
      response.status :
      this.toNullableNumber(response.status);
    switch (version) {
      case 'v1':
        return hydrated ?
          {
            code: response.code_v1,
            score: response.score_v1,
            status
          } :
          {
            code: this.toNullableNumber(response.codeV1),
            score: this.toNullableNumber(response.scoreV1),
            status
          };
      case 'v2':
        return hydrated ?
          {
            code: response.code_v2,
            score: response.score_v2,
            status
          } :
          {
            code: this.toNullableNumber(response.codeV2),
            score: this.toNullableNumber(response.scoreV2),
            status
          };
      case 'v3':
        return hydrated ?
          {
            code: response.code_v3,
            score: response.score_v3,
            status
          } :
          {
            code: this.toNullableNumber(response.codeV3),
            score: this.toNullableNumber(response.scoreV3),
            status
          };
      default:
        throw new Error(`Unsupported item dataset version: ${version}`);
    }
  }

  private getSelectionKey(unitId: string, itemId: string): string {
    return ItemDatasetSelectionKey.from(unitId, itemId).toString();
  }

  private getResponseKey(unitId: string, variableId: string): string {
    return ItemDatasetResponseKey.from(unitId, variableId).toString();
  }

  private toNullableNumber(
    value: number | string | null | undefined
  ): number | null {
    if (value === null || value === undefined || value === '') {
      return null;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private shouldYieldExportItem(index: number): boolean {
    return (
      index > 0 &&
      index % CodingItemMatrixExportService.exportYieldEveryItems === 0
    );
  }

  private async checkExportCancellationPoint(
    index: number,
    checkCancellation?: () => Promise<void>
  ): Promise<void> {
    if (this.shouldYieldExportItem(index)) {
      await checkCancellation?.();
      await this.yieldToEventLoop();
    }
  }

  private async yieldToEventLoop(): Promise<void> {
    await new Promise<void>(resolve => {
      setImmediate(resolve);
    });
  }

  private isExportCancellationError(error: Error): boolean {
    return /^Export job .* was cancelled$/.test(error.message);
  }
}
