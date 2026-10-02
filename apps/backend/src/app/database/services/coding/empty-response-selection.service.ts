import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { ResponseEntity } from '../../entities/response.entity';
import { WorkspaceFilesService } from '../workspace/workspace-files.service';
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
  isAggregatableValue,
  isDerivedAggregationVariable
} from './aggregation-metrics.util';

export interface EmptyResponseSelectionContext {
  metadataAvailable: boolean;
  derivedVariableMap: Map<string, Set<string>>;
  sourceVariablesByDerivedKey: Map<string, Set<string>>;
}

interface DerivedCandidatePlan {
  response: ResponseEntity;
  sourceVariableIds: Set<string>;
}

@Injectable()
export class EmptyResponseSelectionService {
  private readonly logger = new Logger(EmptyResponseSelectionService.name);

  constructor(
    @InjectRepository(ResponseEntity)
    private readonly responseRepository: Repository<ResponseEntity>,
    private readonly workspaceFilesService: WorkspaceFilesService
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

  async filterEffectivelyEmptyResponses(
    responses: ResponseEntity[],
    context: EmptyResponseSelectionContext,
    manager?: EntityManager
  ): Promise<ResponseEntity[]> {
    if (!context.metadataAvailable) {
      return [];
    }

    const selectedById = new Map<number, ResponseEntity>();
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
        if (!isAggregatableValue(response.value)) {
          selectedById.set(response.id, response);
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
      const unitIds = Array.from(new Set(chunk.map(plan => plan.response.unitid)));
      const sourceVariableIds = Array.from(new Set(
        chunk.flatMap(plan => Array.from(plan.sourceVariableIds))
      ));

      const responseRepository = manager?.getRepository(ResponseEntity) ??
        this.responseRepository;
      const sourceResponses = await responseRepository
        .createQueryBuilder('source')
        .where('source.unitid IN (:...unitIds)', { unitIds })
        .andWhere('source.variableid IN (:...sourceVariableIds)', {
          sourceVariableIds
        })
        .getMany();
      const sourceResponsesByKey = new Map<string, ResponseEntity | null>();
      sourceResponses.forEach(sourceResponse => {
        const sourceKey = this.getUnitResponseKey(
          sourceResponse.unitid,
          sourceResponse.variableid
        );
        sourceResponsesByKey.set(
          sourceKey,
          sourceResponsesByKey.has(sourceKey) ? null : sourceResponse
        );
      });

      chunk.forEach(plan => {
        const resolvedSources = Array.from(plan.sourceVariableIds).map(variableId => (
          sourceResponsesByKey.get(
            this.getUnitResponseKey(plan.response.unitid, variableId)
          )
        ));
        const allSourcesExistExactlyOnce = resolvedSources.every(
          (source): source is ResponseEntity => source !== undefined && source !== null
        );

        if (
          allSourcesExistExactlyOnce &&
          this.isDerivedResponseEffectivelyEmpty(plan.response, resolvedSources)
        ) {
          selectedById.set(plan.response.id, plan.response);
        }
      });
    }

    return responses.filter(response => selectedById.has(response.id));
  }

  private isDerivedResponseEffectivelyEmpty(
    target: ResponseEntity,
    sources: ResponseEntity[]
  ): boolean {
    const allSourcesEmpty = sources.every(
      source => !isAggregatableValue(source.value)
    );

    // The MC+reason exception is intentionally limited to the target state
    // specified in #972. Other target states keep the conservative behavior
    // introduced for derived responses in #970.
    if (target.status_v1 !== CODING_INCOMPLETE_STATUS) {
      return allSourcesEmpty;
    }

    const sourceStatuses = sources.map(source => source.status_v1);
    const allSourceStatusesKnown = sourceStatuses.every(status => (
      status !== null && statusNumberToString(status) !== null
    ));
    if (!allSourceStatusesKnown) {
      return false;
    }

    const intendedIncompleteSources = sources.filter(
      source => source.status_v1 === INTENDED_INCOMPLETE_STATUS
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

    return intendedIncompleteSources.every(
      source => !isAggregatableValue(source.value)
    );
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

  private getUnitResponseKey(unitId: number, variableId: string): string {
    return `${unitId}\u001F${variableId}`;
  }
}
