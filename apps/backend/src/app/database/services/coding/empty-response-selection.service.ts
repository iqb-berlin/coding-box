import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ResponseEntity } from '../../entities/response.entity';
import { WorkspaceFilesService } from '../workspace/workspace-files.service';
import {
  getManualCodingScopeKey,
  splitManualCodingScopeKey
} from '../../utils/manual-coding-scope.util';
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

  async createContext(workspaceId: number): Promise<EmptyResponseSelectionContext> {
    try {
      const metadata =
        await this.workspaceFilesService.getDerivedVariableMetadata(workspaceId);

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

      return {
        metadataAvailable: true,
        derivedVariableMap: metadata.derivedVariableMap,
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
    context: EmptyResponseSelectionContext
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

      const sourceResponses = await this.responseRepository
        .createQueryBuilder('source')
        .where('source.unitid IN (:...unitIds)', { unitIds })
        .andWhere('source.variableid IN (:...sourceVariableIds)', {
          sourceVariableIds
        })
        .getMany();
      const sourceResponsesByKey = new Map(
        sourceResponses.map(response => [
          this.getUnitResponseKey(response.unitid, response.variableid),
          response
        ])
      );

      chunk.forEach(plan => {
        const resolvedSources = Array.from(plan.sourceVariableIds).map(variableId => (
          sourceResponsesByKey.get(
            this.getUnitResponseKey(plan.response.unitid, variableId)
          )
        ));
        const allSourcesExist = resolvedSources.every(source => source !== undefined);
        const allSourcesEmpty = resolvedSources.every(source => (
          source !== undefined && !isAggregatableValue(source.value)
        ));

        if (allSourcesExist && allSourcesEmpty) {
          selectedById.set(plan.response.id, plan.response);
        }
      });
    }

    return responses.filter(response => selectedById.has(response.id));
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
