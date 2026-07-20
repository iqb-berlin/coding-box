import {
  BadRequestException,
  Injectable,
  Logger,
  Optional
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as cheerio from 'cheerio';
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
import { Booklet } from '../../entities/booklet.entity';
import FileUpload from '../../entities/file_upload.entity';
import { ResponseEntity } from '../../entities/response.entity';
import { Unit } from '../../entities/unit.entity';
import { statusNumberToString } from '../../utils/response-status-converter';
import {
  isExcludedByResolvedExclusions,
  normalizeExclusionBookletId,
  normalizeExclusionUnitId,
  WorkspaceExclusionService
} from '../workspace/workspace-exclusion.service';
import { WorkspaceFilesService } from '../workspace/workspace-files.service';
import {
  aggregateItemDatasetMissingStates,
  ItemDatasetMissingState
} from './item-dataset-missing-aggregation.util';
import {
  IqbStandardMissingId,
  MissingsProfilesService,
  ResolvedMissingValue
} from './missings-profiles.service';
import { PsychometricMetadataResolver } from './psychometric-metadata-resolver.service';

export type ItemMatrixValue = 'code' | 'score';
export type ItemMatrixFormat = 'csv' | 'excel';
export type ItemMatrixVersion = 'v1' | 'v2' | 'v3';

export interface ItemMatrixExportConfiguration {
  missingsProfileId: number;
  notReachedScope?: ItemDatasetNotReachedScope;
  recodeTrailingOmissions?: boolean;
  items?: ItemDatasetSelection[];
}

interface MatrixColumn {
  key: string;
  header: string;
  unitName: string;
  unitId: string;
  variableId: string;
  sourceVariableId: string;
  itemId: string;
  itemLabel: string;
  itemOrder: number;
  isDerived: boolean;
}

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

interface ResponseValue {
  code: number | null;
  score: number | null;
  status: number | null;
}

interface BookletUnitPosition {
  unitId: string;
  order: number;
  testletKey: string;
}

interface BookletDesign {
  units: Map<string, BookletUnitPosition>;
}

interface ProfileDefinitions {
  byId: Map<IqbStandardMissingId, ResolvedMissingValue>;
  byCode: Map<number, ResolvedMissingValue>;
}

interface ResolvedCell {
  state: ItemDatasetMissingState;
  code: number | null;
  score: number | null;
  unresolved: boolean;
  activity: boolean;
  candidate: boolean;
  omission: boolean;
}

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
  private static readonly exportYieldEveryItems = 50;

  constructor(
    @InjectRepository(ResponseEntity)
    private readonly responseRepository: Repository<ResponseEntity>,
    @InjectRepository(Booklet)
    private readonly bookletRepository: Repository<Booklet>,
    @InjectRepository(Unit)
    private readonly unitRepository: Repository<Unit>,
    private readonly workspaceFilesService: WorkspaceFilesService,
    private readonly workspaceExclusionService: WorkspaceExclusionService,
    private readonly missingsProfilesService: MissingsProfilesService,
    @Optional()
    @InjectRepository(FileUpload)
    private readonly fileUploadRepository?: Repository<FileUpload>,
    @Optional()
    private readonly metadataResolver?: PsychometricMetadataResolver
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
      mappingIssues: result.issues
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

        await this.writeRows(
          workspaceId,
          context,
          value,
          version,
          configuration,
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

    await this.writeRows(
      workspaceId,
      context,
      value,
      version,
      configuration,
      async row => {
        worksheet.addRow(row).commit();
      },
      progressCallback,
      checkCancellation
    );
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
      throw new BadRequestException(
        `Item-Metadaten sind unvollständig oder mehrdeutig: ${issues.join('; ')}`
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
  ): Promise<{ columns: MatrixColumn[]; issues: string[] }> {
    if (!this.metadataResolver) {
      return {
        columns: [],
        issues: ['VOMD-Metadaten-Resolver ist nicht verfügbar']
      };
    }
    await checkCancellation?.();
    const exclusions =
      await this.workspaceExclusionService.resolveExclusionsForQueries(
        workspaceId
      );
    const [mapping, aliases] = await Promise.all([
      this.metadataResolver.buildItemMapping(workspaceId, {
        excludedUnitNames: exclusions.globalIgnoredUnits,
        requireItemIds: true
      }),
      this.getUnitAliases(workspaceId, checkCancellation)
    ]);
    const issues = [
      ...mapping.issues,
      ...mapping.fallbacks.map(
        fallback => `Nicht eindeutige VOMD-Fallback-Zuordnung: ${fallback}`
      )
    ];
    const requested = selection ?
      new Set(
        selection.map(item => this.getSelectionKey(item.unitId, item.itemId)
        )
      ) :
      null;
    const matched = new Set<string>();
    const headers = new Map<string, string>(
      fixedHeaders.map(header => [header, 'feste Identifikationsspalte'])
    );
    const columns: MatrixColumn[] = [];

    mapping.items.forEach((item, itemOrder) => {
      const unitId = normalizeExclusionUnitId(item.unitName);
      const selectionKey = this.getSelectionKey(unitId, item.itemId);
      if (
        isExcludedByResolvedExclusions(exclusions, '', item.unitName) ||
        (requested && !requested.has(selectionKey))
      ) {
        return;
      }
      matched.add(selectionKey);
      const unitLabel = aliases.get(unitId) || unitId;
      const header = `${unitLabel}_${item.itemId}`;
      const existing = headers.get(header);
      if (existing) {
        issues.push(
          `Spaltenname '${header}' kollidiert für ${existing} und ${selectionKey}`
        );
        return;
      }
      headers.set(header, selectionKey);
      columns.push({
        key: this.getResponseKey(item.unitName, item.variableId),
        header,
        unitName: item.unitName,
        unitId,
        variableId: item.variableId,
        sourceVariableId: item.sourceVariableId,
        itemId: item.itemId,
        itemLabel: item.itemLabel,
        itemOrder,
        isDerived: item.variable.isDerived === true
      });
    });

    requested?.forEach(key => {
      if (!matched.has(key)) {
        issues.push(
          `Ausgewähltes Item '${key}' konnte nicht eindeutig zugeordnet werden`
        );
      }
    });
    return { columns, issues: Array.from(new Set(issues)) };
  }

  private filterColumns(
    columns: MatrixColumn[],
    selection?: ItemDatasetSelection[]
  ): { columns: MatrixColumn[]; issues: string[] } {
    if (!selection) {
      return { columns, issues: [] };
    }
    const requested = new Set(
      selection.map(item => this.getSelectionKey(item.unitId, item.itemId))
    );
    const filtered = columns.filter(item => requested.has(this.getSelectionKey(item.unitId, item.itemId))
    );
    const matched = new Set(
      filtered.map(item => this.getSelectionKey(item.unitId, item.itemId))
    );
    return {
      columns: filtered,
      issues: Array.from(requested)
        .filter(key => !matched.has(key))
        .map(
          key => `Ausgewähltes Item '${key}' konnte nicht eindeutig zugeordnet werden`
        )
    };
  }

  private sortColumnsByBookletDesigns(
    columns: MatrixColumn[],
    designs: Map<string, BookletDesign>
  ): MatrixColumn[] {
    const unitRanks = new Map<string, number>();
    Array.from(designs.values()).forEach((design, bookletIndex) => {
      design.units.forEach(position => {
        const rank = bookletIndex * 1_000_000 + position.order;
        const current = unitRanks.get(position.unitId);
        if (current === undefined || rank < current) {
          unitRanks.set(position.unitId, rank);
        }
      });
    });
    return [...columns].sort(
      (left, right) => (unitRanks.get(left.unitId) ?? Number.MAX_SAFE_INTEGER) -
          (unitRanks.get(right.unitId) ?? Number.MAX_SAFE_INTEGER) ||
        left.itemOrder - right.itemOrder ||
        left.itemId.localeCompare(right.itemId)
    );
  }

  private async getBookletDesigns(
    workspaceId: number,
    checkCancellation?: () => Promise<void>
  ): Promise<Map<string, BookletDesign>> {
    if (!this.fileUploadRepository) {
      throw new Error(
        'Booklet-Dateien sind für den Itemdatensatz nicht verfügbar'
      );
    }
    const [files, exclusions] = await Promise.all([
      this.fileUploadRepository.find({
        where: { workspace_id: workspaceId, file_type: 'Booklet' },
        select: ['file_id', 'data'],
        order: { file_id: 'ASC' }
      }),
      this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId)
    ]);
    const result = new Map<string, BookletDesign>();

    for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
      if (this.shouldYieldExportItem(fileIndex)) {
        await checkCancellation?.();
        await this.yieldToEventLoop();
      }
      const file = files[fileIndex];
      const bookletId = normalizeExclusionBookletId(file.file_id);
      try {
        const $ = cheerio.load(file.data, { xmlMode: true });
        const testlets = $('Testlet, testlet').toArray();
        const units = new Map<string, BookletUnitPosition>();
        $('Unit, unit').each((order, element) => {
          const unitId = normalizeExclusionUnitId($(element).attr('id'));
          if (
            !unitId ||
            units.has(unitId) ||
            isExcludedByResolvedExclusions(exclusions, bookletId, unitId)
          ) {
            return;
          }
          const testlet = $(element).closest('Testlet, testlet').get(0);
          const testletIndex = testlet ?
            testlets.indexOf(testlet as (typeof testlets)[number]) :
            -1;
          const testletId = testlet ?
            String($(testlet).attr('id') || testletIndex) :
            'root';
          units.set(unitId, {
            unitId,
            order,
            testletKey: `${testletIndex}:${testletId}`
          });
        });
        result.set(bookletId, { units });
      } catch (error) {
        throw new BadRequestException(
          `Booklet-Struktur '${file.file_id}' konnte nicht gelesen werden: ` +
            `${(error as Error).message}`
        );
      }
    }
    return result;
  }

  private async getDerivedSources(
    workspaceId: number
  ): Promise<Map<string, string[]>> {
    const bySource =
      await this.workspaceFilesService.getDerivedVariablesBySourceMap(
        workspaceId
      );
    const result = new Map<string, string[]>();
    bySource.forEach((derivedVariables, sourceKey) => {
      const separator = sourceKey.indexOf('\u001F');
      if (separator < 0) {
        return;
      }
      const unitName = sourceKey.slice(0, separator);
      const sourceVariable = sourceKey.slice(separator + 1);
      derivedVariables.forEach(derivedVariable => {
        const derivedKey = this.getResponseKey(unitName, derivedVariable);
        const sources = result.get(derivedKey) || [];
        sources.push(this.getResponseKey(unitName, sourceVariable));
        result.set(derivedKey, sources);
      });
    });
    return result;
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

  private async getUnitAliases(
    workspaceId: number,
    checkCancellation?: () => Promise<void>
  ): Promise<Map<string, string>> {
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
    rows.forEach(row => {
      const unitId = normalizeExclusionUnitId(row.unitName);
      const alias = String(row.unitAlias || '').trim();
      if (!unitId || !alias) {
        return;
      }
      const aliases = aliasesByUnit.get(unitId) || new Set<string>();
      aliases.add(alias);
      aliasesByUnit.set(unitId, aliases);
    });
    const stableAliases = new Map<string, string>();
    aliasesByUnit.forEach((aliases, unitId) => {
      if (aliases.size === 1) {
        stableAliases.set(unitId, Array.from(aliases)[0]);
      }
    });
    return stableAliases;
  }

  private async writeRows(
    workspaceId: number,
    context: MatrixContext,
    requestedValue: ItemMatrixValue,
    version: ItemMatrixVersion,
    configuration: ItemMatrixExportConfiguration,
    writeRow: (row: Record<string, string | number>) => Promise<void>,
    progressCallback?: (percentage: number) => Promise<void>,
    checkCancellation?: () => Promise<void>
  ): Promise<void> {
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
        await writeRow(exportRow);
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
    const derivedWithoutResult: boolean[] = [];
    const initialCells: ResolvedCell[] = [];
    for (let index = 0; index < columns.length; index += 1) {
      await this.checkExportCancellationPoint(index, checkCancellation);
      const column = columns[index];
      const value = responseValues.get(column.key);
      derivedWithoutResult.push(
        column.isDerived &&
        (!value || (value.code === null && value.score === null))
      );
      if (!design.units.has(column.unitId)) {
        initialCells.push(this.fromMissing(profile.byId.get('mbd')!));
      } else {
        initialCells.push(
          this.resolveInitialCell(responseValues.get(column.key), profile)
        );
      }
    }
    await checkCancellation?.();
    const sourceColumns = this.getDerivedSourceColumns(columns, derivedSources);
    const sourceCells: ResolvedCell[] = [];
    for (let index = 0; index < sourceColumns.length; index += 1) {
      await this.checkExportCancellationPoint(index, checkCancellation);
      const column = sourceColumns[index];
      if (!design.units.has(column.unitId)) {
        sourceCells.push(this.fromMissing(profile.byId.get('mbd')!));
      } else {
        sourceCells.push(
          this.resolveInitialCell(responseValues.get(column.key), profile)
        );
      }
    }
    const resolutionColumns = [...columns, ...sourceColumns];
    const resolutionCells = [...initialCells, ...sourceCells];
    await checkCancellation?.();
    this.resolveNotReachedCandidates(
      resolutionCells,
      resolutionColumns,
      design,
      profile,
      configuration.notReachedScope || 'unit',
      configuration.recodeTrailingOmissions === true
    );
    const cells = resolutionCells.slice(0, columns.length);

    const cellsByResponseKey = new Map<string, ResolvedCell>();
    for (let index = 0; index < resolutionColumns.length; index += 1) {
      await this.checkExportCancellationPoint(index, checkCancellation);
      const column = resolutionColumns[index];
      const cell = resolutionCells[index];
      cellsByResponseKey.set(column.key, cell);
      const sourceKey = this.getResponseKey(
        column.unitName,
        column.sourceVariableId
      );
      if (!cellsByResponseKey.has(sourceKey)) {
        cellsByResponseKey.set(sourceKey, cell);
      }
    }
    const recursion = new Set<string>();
    for (let index = 0; index < columns.length; index += 1) {
      await this.checkExportCancellationPoint(index, checkCancellation);
      const column = columns[index];
      if (!derivedWithoutResult[index] || !design.units.has(column.unitId)) {
        continue;
      }
      const state = this.resolveDerivedState(
        column.key,
        responseValues,
        derivedSources,
        profile,
        cellsByResponseKey,
        recursion
      );
      if (state !== 'valid' && state !== 'error') {
        cells[index] = this.fromMissing(
          profile.byId.get(state as IqbStandardMissingId)!
        );
      } else {
        cells[index] = this.unresolvedCell();
      }
      cellsByResponseKey.set(column.key, cells[index]);
    }
    return cells;
  }

  private getDerivedSourceColumns(
    columns: MatrixColumn[],
    derivedSources: Map<string, string[]>
  ): MatrixColumn[] {
    const directColumns = new Map<string, MatrixColumn | null>();
    const registerDirectColumn = (
      key: string,
      column: MatrixColumn
    ): void => {
      const existing = directColumns.get(key);
      if (
        existing &&
        this.getSelectionKey(existing.unitId, existing.itemId) !==
          this.getSelectionKey(column.unitId, column.itemId)
      ) {
        directColumns.set(key, null);
      } else if (existing === undefined) {
        directColumns.set(key, column);
      }
    };
    columns.forEach(column => {
      registerDirectColumn(column.key, column);
      registerDirectColumn(
        this.getResponseKey(column.unitName, column.sourceVariableId),
        column
      );
    });

    const sourceAnchors = new Map<string, MatrixColumn | null>();
    const registerSourceAnchor = (
      sourceKey: string,
      anchor: MatrixColumn
    ): void => {
      const existing = sourceAnchors.get(sourceKey);
      if (
        existing &&
        this.getSelectionKey(existing.unitId, existing.itemId) !==
          this.getSelectionKey(anchor.unitId, anchor.itemId)
      ) {
        sourceAnchors.set(sourceKey, null);
      } else if (existing === undefined) {
        sourceAnchors.set(sourceKey, anchor);
      }
    };
    const visitSources = (
      derivedKey: string,
      fallbackAnchor: MatrixColumn,
      path: Set<string>
    ): void => {
      if (path.has(derivedKey)) {
        return;
      }
      const nextPath = new Set(path).add(derivedKey);
      (derivedSources.get(derivedKey) || []).forEach(sourceKey => {
        const directAnchor = directColumns.get(sourceKey);
        const anchor = directAnchor || fallbackAnchor;
        if (directAnchor === undefined) {
          registerSourceAnchor(sourceKey, anchor);
        }
        if (derivedSources.has(sourceKey)) {
          visitSources(sourceKey, anchor, nextPath);
        }
      });
    };
    columns.forEach(column => {
      if (derivedSources.has(column.key)) {
        visitSources(column.key, column, new Set());
      }
    });

    return Array.from(sourceAnchors.entries())
      .filter((entry): entry is [string, MatrixColumn] => entry[1] !== null)
      .map(([sourceKey, anchor]) => ({
        ...anchor,
        key: sourceKey,
        variableId: sourceKey.slice(sourceKey.indexOf('\u001F') + 1),
        sourceVariableId: sourceKey.slice(sourceKey.indexOf('\u001F') + 1),
        isDerived: derivedSources.has(sourceKey)
      }));
  }

  private resolveInitialCell(
    value: ResponseValue | undefined,
    profile: ProfileDefinitions
  ): ResolvedCell {
    if (value && (value.code !== null || value.score !== null)) {
      if (value.code === -3 || value.code === -4) {
        return this.fromMissing(
          profile.byId.get(value.code === -3 ? 'mir' : 'mci')!
        );
      }
      const storedMissing =
        value.code !== null && value.code < 0 ?
          profile.byCode.get(value.code) :
          undefined;
      if (storedMissing) {
        return {
          ...this.fromMissing(storedMissing),
          code: value.code,
          score: value.score ?? storedMissing.score
        };
      }
      return {
        state:
          (value.code !== null && value.code >= 0) ||
          (value.code === null && value.score !== null) ?
            'valid' :
            'error',
        code: value.code,
        score: value.score,
        unresolved: value.code === null,
        activity: true,
        candidate: false,
        omission: false
      };
    }

    const status =
      value?.status === null || value?.status === undefined ?
        null :
        statusNumberToString(value.status);
    if (status === 'INVALID') {
      return this.fromMissing(profile.byId.get('mir')!);
    }
    if (status === 'CODING_ERROR') {
      return this.fromMissing(profile.byId.get('mci')!);
    }
    if (
      status === 'UNSET' ||
      status === 'DISPLAYED' ||
      status === 'PARTLY_DISPLAYED'
    ) {
      return {
        ...this.fromMissing(profile.byId.get('mbi_mbo')!),
        omission: true,
        activity: true
      };
    }
    if (status === 'NOT_REACHED' || !value) {
      return {
        ...this.unresolvedCell(),
        state: 'mnr',
        candidate: true,
        activity: false
      };
    }
    return this.unresolvedCell();
  }

  private resolveNotReachedCandidates(
    cells: ResolvedCell[],
    columns: MatrixColumn[],
    design: BookletDesign,
    profile: ProfileDefinitions,
    scope: ItemDatasetNotReachedScope,
    recodeTrailingOmissions: boolean
  ): void {
    const groups = new Map<string, number[]>();
    columns.forEach((column, index) => {
      const position = design.units.get(column.unitId);
      if (!position) {
        return;
      }
      let group = column.unitId;
      if (scope === 'booklet') {
        group = 'booklet';
      } else if (scope === 'testlet') {
        group = position.testletKey;
      }
      const indexes = groups.get(group) || [];
      indexes.push(index);
      groups.set(group, indexes);
    });

    groups.forEach(indexes => {
      indexes.sort((left, right) => {
        const leftPosition = design.units.get(columns[left].unitId)!;
        const rightPosition = design.units.get(columns[right].unitId)!;
        return (
          leftPosition.order - rightPosition.order ||
          columns[left].itemOrder - columns[right].itemOrder
        );
      });
      let laterActivity = false;
      let position = indexes.length - 1;
      while (position >= 0) {
        const referenceIndex = indexes[position];
        const referencePosition = design.units.get(
          columns[referenceIndex].unitId
        )!;
        const itemOrder = columns[referenceIndex].itemOrder;
        let firstAtPosition = position;
        while (firstAtPosition > 0) {
          const previousIndex = indexes[firstAtPosition - 1];
          const previousPosition = design.units.get(
            columns[previousIndex].unitId
          )!;
          if (
            previousPosition.order !== referencePosition.order ||
            columns[previousIndex].itemOrder !== itemOrder
          ) {
            break;
          }
          firstAtPosition -= 1;
        }
        const positionIndexes = indexes.slice(firstAtPosition, position + 1);
        for (const cellIndex of positionIndexes) {
          const cell = cells[cellIndex];
          if (cell.candidate) {
            cells[cellIndex] = this.fromMissing(
              profile.byId.get(laterActivity ? 'mbi_mbo' : 'mnr')!
            );
          } else if (
            cell.omission &&
            recodeTrailingOmissions &&
            !laterActivity
          ) {
            cells[cellIndex] = this.fromMissing(profile.byId.get('mnr')!);
          }
        }
        for (const cellIndex of positionIndexes) {
          if (cells[cellIndex].activity) {
            laterActivity = true;
            break;
          }
        }
        position = firstAtPosition - 1;
      }
    });
  }

  private resolveDerivedState(
    key: string,
    responseValues: Map<string, ResponseValue>,
    derivedSources: Map<string, string[]>,
    profile: ProfileDefinitions,
    cellsByResponseKey: Map<string, ResolvedCell>,
    recursion: Set<string>
  ): ItemDatasetMissingState {
    if (recursion.has(key)) {
      return 'error';
    }
    const sources = derivedSources.get(key);
    if (!sources || sources.length === 0) {
      return cellsByResponseKey.get(key)?.state || 'error';
    }
    recursion.add(key);
    const states = sources.map(sourceKey => {
      const sourceValue = responseValues.get(sourceKey);
      if (
        sourceValue &&
        (sourceValue.code !== null || sourceValue.score !== null)
      ) {
        return (
          cellsByResponseKey.get(sourceKey)?.state ||
          this.resolveInitialCell(sourceValue, profile).state
        );
      }
      if (derivedSources.has(sourceKey)) {
        return this.resolveDerivedState(
          sourceKey,
          responseValues,
          derivedSources,
          profile,
          cellsByResponseKey,
          recursion
        );
      }
      const resolvedSource = cellsByResponseKey.get(sourceKey);
      if (resolvedSource) {
        return resolvedSource.state;
      }
      return sourceValue ?
        this.resolveInitialCell(sourceValue, profile).state :
        'error';
    });
    recursion.delete(key);
    return aggregateItemDatasetMissingStates(states);
  }

  private fromMissing(missing: ResolvedMissingValue): ResolvedCell {
    return {
      state: this.toItemDatasetMissingState(missing.id),
      code: missing.code,
      score: missing.score,
      unresolved: false,
      activity: missing.id !== 'mnr' && missing.id !== 'mbd',
      candidate: false,
      omission: missing.id === 'mbi_mbo'
    };
  }

  private toItemDatasetMissingState(id: string): ItemDatasetMissingState {
    return requiredMissingIds.includes(id as IqbStandardMissingId) ?
      id as IqbStandardMissingId :
      'error';
  }

  private unresolvedCell(): ResolvedCell {
    return {
      state: 'error',
      code: null,
      score: null,
      unresolved: true,
      activity: true,
      candidate: false,
      omission: false
    };
  }

  private getExportValue(
    cell: ResolvedCell,
    requestedValue: ItemMatrixValue
  ): string | number {
    if (requestedValue === 'score') {
      return cell.score === null ? '' : cell.score;
    }
    return cell.unresolved || cell.code === null ? 'NA' : cell.code;
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
    return `${normalizeExclusionUnitId(unitId)}\u001F${String(itemId).trim()}`;
  }

  private getResponseKey(unitId: string, variableId: string): string {
    return `${normalizeExclusionUnitId(unitId)}\u001F${String(variableId).trim()}`;
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
