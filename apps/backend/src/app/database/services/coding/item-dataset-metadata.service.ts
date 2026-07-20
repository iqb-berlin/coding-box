import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as cheerio from 'cheerio';
import { Repository } from 'typeorm';
import {
  ItemDatasetMappingIssueDto,
  ItemDatasetSelection
} from '../../../../../../../api-dto/coding/export-request.dto';
import {
  ItemDatasetResponseKey,
  ItemDatasetSelectionKey,
  normalizeItemDatasetUnitId
} from '../../../../../../../api-dto/coding/item-dataset-key';
import FileUpload from '../../entities/file_upload.entity';
import { Unit } from '../../entities/unit.entity';
import {
  ItemDatasetBookletDesign,
  ItemDatasetBookletUnitPosition,
  ItemDatasetColumn
} from './item-dataset-cell-resolver';
import {
  isExcludedByResolvedExclusions,
  normalizeExclusionBookletId,
  WorkspaceExclusionService
} from '../workspace/workspace-exclusion.service';
import { WorkspaceFilesService } from '../workspace/workspace-files.service';
import { PsychometricMetadataResolver } from './psychometric-metadata-resolver.service';

const fixedHeaders = [
  'person_login',
  'person_code',
  'person_group',
  'booklet_name'
] as const;

export interface ItemDatasetColumnResolution {
  columns: ItemDatasetColumn[];
  issues: ItemDatasetMappingIssueDto[];
}

@Injectable()
export class ItemDatasetMetadataService {
  private static readonly yieldEveryItems = 50;

  constructor(
    @InjectRepository(Unit)
    private readonly unitRepository: Repository<Unit>,
    @InjectRepository(FileUpload)
    private readonly fileUploadRepository: Repository<FileUpload>,
    private readonly workspaceFilesService: WorkspaceFilesService,
    private readonly workspaceExclusionService: WorkspaceExclusionService,
    private readonly metadataResolver: PsychometricMetadataResolver
  ) {}

  async buildColumns(
    workspaceId: number,
    selection?: ItemDatasetSelection[],
    checkCancellation?: () => Promise<void>
  ): Promise<ItemDatasetColumnResolution> {
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
    const issues: ItemDatasetMappingIssueDto[] = [
      ...mapping.issues.map(message => ({
        code: 'vomd-mapping' as const,
        message
      })),
      ...mapping.fallbacks.map(message => ({
        code: 'ambiguous-vomd-fallback' as const,
        message: `Nicht eindeutige VOMD-Fallback-Zuordnung: ${message}`
      }))
    ];
    const requested = selection ?
      new Set(
        selection.map(item => ItemDatasetSelectionKey
          .from(item.unitId, item.itemId)
          .toString())
      ) :
      null;
    const matched = new Set<string>();
    const headers = new Map<string, string>(
      fixedHeaders.map(header => [header, 'feste Identifikationsspalte'])
    );
    const columns: ItemDatasetColumn[] = [];

    mapping.items.forEach((item, itemOrder) => {
      const unitId = normalizeItemDatasetUnitId(item.unitName);
      const selectionKey = ItemDatasetSelectionKey
        .from(unitId, item.itemId)
        .toString();
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
        issues.push({
          code: 'column-name-collision',
          message:
            `Spaltenname '${header}' kollidiert für ${existing} und ` +
            `${selectionKey}`,
          unitId,
          itemId: item.itemId,
          columnName: header
        });
        return;
      }
      headers.set(header, selectionKey);
      columns.push({
        key: ItemDatasetResponseKey
          .from(item.unitName, item.variableId)
          .toString(),
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
        const selected = selection?.find(item => (
          ItemDatasetSelectionKey.from(item.unitId, item.itemId).toString() ===
          key
        ));
        issues.push({
          code: 'unknown-selection',
          message:
            `Ausgewähltes Item '${key}' konnte nicht eindeutig zugeordnet werden`,
          unitId: selected ?
            normalizeItemDatasetUnitId(selected.unitId) :
            undefined,
          itemId: selected?.itemId
        });
      }
    });
    return { columns, issues: this.uniqueIssues(issues) };
  }

  filterColumns(
    columns: ItemDatasetColumn[],
    selection?: ItemDatasetSelection[]
  ): ItemDatasetColumnResolution {
    if (!selection) {
      return { columns, issues: [] };
    }
    const requested = new Set(
      selection.map(item => ItemDatasetSelectionKey
        .from(item.unitId, item.itemId)
        .toString())
    );
    const filtered = columns.filter(item => requested.has(
      ItemDatasetSelectionKey.from(item.unitId, item.itemId).toString()
    ));
    const matched = new Set(
      filtered.map(item => ItemDatasetSelectionKey
        .from(item.unitId, item.itemId)
        .toString())
    );
    return {
      columns: filtered,
      issues: Array.from(requested)
        .filter(key => !matched.has(key))
        .map(key => {
          const selected = selection.find(item => (
            ItemDatasetSelectionKey.from(item.unitId, item.itemId).toString() ===
            key
          ));
          return {
            code: 'unknown-selection' as const,
            message:
              `Ausgewähltes Item '${key}' konnte nicht eindeutig zugeordnet werden`,
            unitId: selected ?
              normalizeItemDatasetUnitId(selected.unitId) :
              undefined,
            itemId: selected?.itemId
          };
        })
    };
  }

  sortColumnsByBookletDesigns(
    columns: ItemDatasetColumn[],
    designs: Map<string, ItemDatasetBookletDesign>
  ): ItemDatasetColumn[] {
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

  async getBookletDesigns(
    workspaceId: number,
    checkCancellation?: () => Promise<void>
  ): Promise<Map<string, ItemDatasetBookletDesign>> {
    const [files, exclusions] = await Promise.all([
      this.fileUploadRepository.find({
        where: { workspace_id: workspaceId, file_type: 'Booklet' },
        select: ['file_id', 'data'],
        order: { file_id: 'ASC' }
      }),
      this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId)
    ]);
    const result = new Map<string, ItemDatasetBookletDesign>();

    for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
      if (
        fileIndex > 0 &&
        fileIndex % ItemDatasetMetadataService.yieldEveryItems === 0
      ) {
        await checkCancellation?.();
        await this.yieldToEventLoop();
      }
      const file = files[fileIndex];
      const bookletId = normalizeExclusionBookletId(file.file_id);
      try {
        const $ = cheerio.load(file.data, { xmlMode: true });
        const testlets = $('Testlet, testlet').toArray();
        const units = new Map<string, ItemDatasetBookletUnitPosition>();
        $('Unit, unit').each((order, element) => {
          const unitId = normalizeItemDatasetUnitId($(element).attr('id'));
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

  async getDerivedSources(
    workspaceId: number
  ): Promise<Map<string, string[]>> {
    const bySource =
      await this.workspaceFilesService.getDerivedVariablesBySourceMap(
        workspaceId
      );
    const result = new Map<string, string[]>();
    bySource.forEach((derivedVariables, sourceKey) => {
      const source = ItemDatasetResponseKey.parse(sourceKey);
      if (!source) {
        return;
      }
      derivedVariables.forEach(derivedVariable => {
        const derivedKey = ItemDatasetResponseKey
          .from(source.unitId, derivedVariable)
          .toString();
        const sources = result.get(derivedKey) || [];
        sources.push(source.toString());
        result.set(derivedKey, sources);
      });
    });
    return result;
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
      const unitId = normalizeItemDatasetUnitId(row.unitName);
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

  private uniqueIssues(
    issues: ItemDatasetMappingIssueDto[]
  ): ItemDatasetMappingIssueDto[] {
    const unique = new Map<string, ItemDatasetMappingIssueDto>();
    issues.forEach(issue => {
      unique.set(`${issue.code}\u001F${issue.message}`, issue);
    });
    return Array.from(unique.values());
  }

  private async yieldToEventLoop(): Promise<void> {
    await new Promise<void>(resolve => {
      setImmediate(resolve);
    });
  }
}
