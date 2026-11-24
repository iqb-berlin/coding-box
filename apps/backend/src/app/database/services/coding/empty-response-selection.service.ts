import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository, WhereExpressionBuilder } from 'typeorm';
import { ResponseEntity } from '../../entities/response.entity';
import { readEntityBatchesById } from '../shared/postgres-query-batches.util';
import { WORKSPACE_FILE_METADATA_READER, type WorkspaceFileMetadataReader } from '../workspace/workspace-file-metadata-reader.token';
import {
  getManualCodingScopeKey,
  splitManualCodingScopeKey
} from '../../utils/manual-coding-scope.util';
import {
  CODING_COMPLETE_STATUS,
  CODING_INCOMPLETE_STATUS,
  INTENDED_INCOMPLETE_STATUS
} from '../../utils/manual-coding-candidate.util';
import { statusNumberToString } from '../../utils/response-status-converter';
import {
  isAggregatableResponse,
  isDerivedAggregationVariable
} from './aggregation-metrics.util';
import { displayedResponseStatus } from './geogebra-response.util';

export function addEmptyResponseCandidateValueConditions(
  query: WhereExpressionBuilder,
  derivedVariableMap: Map<string, Set<string>>
): void {
  query.where(
    '(response.value IS NULL OR TRIM(BOTH :whitespaces FROM response.value) = :emptyString OR response.value = :emptyArrayString)',
    { whitespaces: ' \r\n\t', emptyString: '', emptyArrayString: '[]' }
  );
  // The decoder checks the prefix, whitespace and ZIP entry. Every accepted encoding contains this signature.
  query.orWhere("response.status = :displayedResponseStatus AND response.value LIKE '%UEsD%'", { displayedResponseStatus });

  Array.from(derivedVariableMap).forEach(([unitName, variableIds], index) => {
    if (variableIds.size === 0) return;
    query.orWhere(
      `(UPPER(unit.name) = :derivedUnit${index} AND response.variableid IN (:...derivedVariables${index}))`,
      { [`derivedUnit${index}`]: unitName.toUpperCase(), [`derivedVariables${index}`]: Array.from(variableIds) }
    );
  });
}

export interface EmptyResponseSelectionContext {
  metadataAvailable: boolean;
  derivedVariableMap: Map<string, Set<string>>;
  sourceVariablesByDerivedKey: Map<string, Set<string>>;
}

type EmptyResponseCandidate = Pick<ResponseEntity, 'id' | 'unitid' | 'variableid' | 'subform' | 'status' | 'status_v1' | 'value'> & {
  unit?: { name: string };
};

interface DerivedCandidatePlan {
  response: EmptyResponseCandidate;
  sourceVariableIds: Set<string>;
}

interface EmptyResponseSource {
  isEmpty: boolean;
  statusV1: number | null;
}

@Injectable()
export class EmptyResponseSelectionService {
  private readonly logger = new Logger(EmptyResponseSelectionService.name);

  constructor(
    @InjectRepository(ResponseEntity)
    private readonly responseRepository: Repository<ResponseEntity>,
    @Inject(WORKSPACE_FILE_METADATA_READER) private readonly workspaceFilesService: WorkspaceFileMetadataReader
  ) { }

  async createContext(
    workspaceId: number,
    manager?: EntityManager
  ): Promise<EmptyResponseSelectionContext> {
    try {
      const metadata =
        await this.workspaceFilesService.getDerivedVariableMetadata(
          workspaceId,
          manager
        );

      if (!metadata.metadataAvailable) {
        this.logger.warn(
          `Derived-variable metadata is incomplete for workspace ${workspaceId}`
        );
        return {
          metadataAvailable: false,
          derivedVariableMap: new Map(),
          sourceVariablesByDerivedKey: new Map()
        };
      }

      const derivedVariableMap = new Map<string, Set<string>>();
      metadata.derivedVariableMap.forEach((variableIds, unitName) => {
        derivedVariableMap.set(unitName.trim().toUpperCase(), variableIds);
      });

      return {
        metadataAvailable: true,
        derivedVariableMap,
        sourceVariablesByDerivedKey: this.invertDerivedSourceMap(
          metadata.derivedVariablesBySourceMap
        )
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Could not load derived-variable metadata for workspace ${workspaceId}: ${message}`
      );
      return {
        metadataAvailable: false,
        derivedVariableMap: new Map(),
        sourceVariablesByDerivedKey: new Map()
      };
    }
  }

  async filterEffectivelyEmptyResponses<T extends EmptyResponseCandidate>(
    responses: T[],
    context: EmptyResponseSelectionContext,
    manager?: EntityManager
  ): Promise<T[]> {
    if (!context.metadataAvailable) {
      return [];
    }

    const selectedIds = new Set<number>();
    const derivedPlans: DerivedCandidatePlan[] = [];

    responses.forEach(response => {
      const unitName = response.unit?.name;
      if (!unitName) {
        return;
      }

      if (!isDerivedAggregationVariable(
        context.derivedVariableMap,
        unitName,
        response.variableid
      )) {
        if (!isAggregatableResponse(response)) {
          selectedIds.add(response.id);
        }
        return;
      }

      const sourceVariableIds = this.resolveLeafSourceVariableIds(
        context,
        unitName,
        response.variableid
      );
      if (sourceVariableIds && sourceVariableIds.size > 0) {
        derivedPlans.push({ response, sourceVariableIds });
      }
    });

    const chunkSize = 500;
    for (let index = 0; index < derivedPlans.length; index += chunkSize) {
      const chunk = derivedPlans.slice(index, index + chunkSize);
      const sourceResponsesByKey = await this.readDerivedSources(chunk, manager);

      chunk.forEach(plan => {
        const { unitid, subform } = plan.response;
        let hasLocalSource = !subform;
        const resolvedSources = Array.from(plan.sourceVariableIds, variableId => {
          const local = sourceResponsesByKey.get(this.getUnitResponseKey(unitid, variableId, subform));
          const global = sourceResponsesByKey.get(this.getUnitResponseKey(unitid, variableId, null));
          if (local !== undefined) {
            hasLocalSource = true;
            if (subform && global !== undefined &&
                (local?.isEmpty !== global?.isEmpty || local?.statusV1 !== global?.statusV1)) return null;
            return local;
          }
          return global;
        });
        // A named target needs at least one local source to acquire its subform in the autocoder.
        const allSourcesExistExactlyOnce = hasLocalSource && resolvedSources.every(
          (source): source is EmptyResponseSource => source != null
        );

        if (
          allSourcesExistExactlyOnce &&
          this.isDerivedResponseEffectivelyEmpty(plan.response, resolvedSources)
        ) {
          selectedIds.add(plan.response.id);
        }
      });
    }

    return responses.filter(response => selectedIds.has(response.id));
  }

  private async readDerivedSources(
    plans: DerivedCandidatePlan[],
    manager?: EntityManager
  ): Promise<Map<string, EmptyResponseSource | null>> {
    const sourcesToRead = plans.flatMap(plan => Array.from(plan.sourceVariableIds, variableId => ({
      unitId: plan.response.unitid,
      variableId,
      subform: plan.response.subform ?? ''
    })));
    const repository = manager?.getRepository(ResponseEntity) ?? this.responseRepository;
    const query = repository.createQueryBuilder('source')
      .select(['source.id', 'source.unitid', 'source.variableid', 'source.subform', 'source.value', 'source.status', 'source.status_v1'])
      .where(`EXISTS (
        SELECT 1 FROM unnest(
          CAST(:sourceUnitIds AS int[]), CAST(:sourceVariableIds AS text[]), CAST(:sourceSubforms AS text[])
        ) requested(unitid, variableid, subform)
        WHERE requested.unitid = source.unitid AND requested.variableid = source.variableid
          AND (requested.subform = source.subform OR COALESCE(source.subform, '') = '')
      )`, {
        sourceUnitIds: sourcesToRead.map(source => source.unitId),
        sourceVariableIds: sourcesToRead.map(source => source.variableId),
        sourceSubforms: sourcesToRead.map(source => source.subform)
      });
    const sources = new Map<string, EmptyResponseSource | null>();
    for await (const rows of readEntityBatchesById(query, 500)) {
      for (const row of rows) {
        const key = this.getUnitResponseKey(row.unitid, row.variableid, row.subform);
        sources.set(key, sources.has(key) ? null : { isEmpty: !isAggregatableResponse(row), statusV1: row.status_v1 });
      }
    }
    return sources;
  }

  private isDerivedResponseEffectivelyEmpty(
    target: EmptyResponseCandidate,
    sources: EmptyResponseSource[]
  ): boolean {
    const allSourcesEmpty = sources.every(source => source.isEmpty);

    // The MC+reason exception is intentionally limited to the target state
    // specified in #972. Other target states keep the conservative behavior
    // introduced for derived responses in #970.
    if (target.status_v1 !== CODING_INCOMPLETE_STATUS) {
      return allSourcesEmpty;
    }

    const sourceStatuses = sources.map(source => source.statusV1);
    const allSourceStatusesKnown = sourceStatuses.every(status => (
      status !== null && statusNumberToString(status) !== null
    ));
    if (!allSourceStatusesKnown) {
      return false;
    }

    const intendedIncompleteSources = sources.filter(
      source => source.statusV1 === INTENDED_INCOMPLETE_STATUS
    );
    if (intendedIncompleteSources.length === 0) {
      return allSourcesEmpty;
    }

    // A mixed MC+reason response is unambiguous only when all leaf sources
    // belong to the automatic or manually intended status groups. Any third
    // status fails closed instead of applying a potentially wrong MIR result.
    const sourceStatusSet = new Set(sourceStatuses);
    const isUnambiguousMcReasonCombination =
      sourceStatusSet.size === 2 &&
      sourceStatusSet.has(CODING_COMPLETE_STATUS) &&
      sourceStatusSet.has(INTENDED_INCOMPLETE_STATUS);
    if (!isUnambiguousMcReasonCombination) {
      return false;
    }

    return intendedIncompleteSources.every(source => source.isEmpty);
  }

  private invertDerivedSourceMap(
    derivedVariablesBySourceMap: Map<string, Set<string>>
  ): Map<string, Set<string>> {
    const sourceVariablesByDerivedKey = new Map<string, Set<string>>();

    derivedVariablesBySourceMap.forEach((derivedVariableIds, sourceKey) => {
      const { unitName, variableId: sourceVariableId } =
        splitManualCodingScopeKey(sourceKey);
      derivedVariableIds.forEach(derivedVariableId => {
        const derivedKey = getManualCodingScopeKey(unitName, derivedVariableId);
        const sourceVariableIds = sourceVariablesByDerivedKey.get(derivedKey) ||
          new Set<string>();
        sourceVariableIds.add(sourceVariableId);
        sourceVariablesByDerivedKey.set(derivedKey, sourceVariableIds);
      });
    });

    return sourceVariablesByDerivedKey;
  }

  private resolveLeafSourceVariableIds(
    context: EmptyResponseSelectionContext,
    unitName: string,
    variableId: string,
    path = new Set<string>()
  ): Set<string> | null {
    const variableKey = getManualCodingScopeKey(unitName, variableId);
    if (path.has(variableKey)) {
      return null;
    }

    const directSourceVariableIds =
      context.sourceVariablesByDerivedKey.get(variableKey);
    if (!directSourceVariableIds || directSourceVariableIds.size === 0) {
      return isDerivedAggregationVariable(
        context.derivedVariableMap,
        unitName,
        variableId
      ) ? null : new Set([variableId]);
    }

    const nextPath = new Set(path).add(variableKey);
    const leafSourceVariableIds = new Set<string>();
    for (const sourceVariableId of directSourceVariableIds) {
      const nestedSources = this.resolveLeafSourceVariableIds(
        context,
        unitName,
        sourceVariableId,
        nextPath
      );
      if (!nestedSources) {
        return null;
      }
      nestedSources.forEach(source => leafSourceVariableIds.add(source));
    }

    return leafSourceVariableIds;
  }

  private getUnitResponseKey(unitId: number, variableId: string, subform: string | null): string {
    return JSON.stringify([unitId, variableId, subform ?? '']);
  }
}
