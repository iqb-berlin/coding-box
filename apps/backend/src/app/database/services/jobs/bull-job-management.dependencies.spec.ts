import 'reflect-metadata';
import {
  ForwardReference, InjectionToken, Provider, Type
} from '@nestjs/common';
import {
  PARAMTYPES_METADATA,
  SELF_DECLARED_DEPS_METADATA
} from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { BullJobManagementService } from './bull-job-management.service';
import { CodingFreshnessService } from '../coding/coding-freshness.service';
import { CodingReadinessService } from '../coding/coding-readiness.service';
import { CodingStatisticsService } from '../coding/coding-statistics.service';
import { WorkspaceFilesService } from '../workspace/workspace-files.service';
import { WorkspaceExclusionService } from '../workspace/workspace-exclusion.service';
import { WorkspaceCoreService } from '../workspace/workspace-core.service';
import { WorkspaceTestResultsService } from '../test-results/workspace-test-results.service';

function resolveInjectionToken(token: unknown, service: Type<unknown>, index: number): InjectionToken {
  if (token && typeof token === 'object' && 'forwardRef' in token) {
    return resolveInjectionToken((token as ForwardReference).forwardRef(), service, index);
  }
  if (token === undefined || token === null) {
    throw new Error(`${service.name} constructor dependency at index ${index} has an unresolved token`);
  }
  return token as InjectionToken;
}

function getConstructorTokens(service: Type<unknown>): InjectionToken[] {
  const dependencies: unknown[] = [
    ...(Reflect.getMetadata(PARAMTYPES_METADATA, service) || [])
  ];
  const injectionOverrides = (Reflect.getMetadata(
    SELF_DECLARED_DEPS_METADATA,
    service
  ) || []) as { index: number; param: unknown }[];
  injectionOverrides.forEach(({ index, param }) => {
    dependencies[index] = param;
  });
  return dependencies.map((token, index) => resolveInjectionToken(token, service, index));
}

describe('Bull job management production dependency graph', () => {
  it('resolves the real readiness and freshness cycles through Nest injection', async () => {
    const productionServices: Type<unknown>[] = [
      BullJobManagementService,
      CodingFreshnessService,
      CodingReadinessService,
      WorkspaceFilesService,
      CodingStatisticsService,
      WorkspaceExclusionService,
      WorkspaceCoreService,
      WorkspaceTestResultsService
    ];
    const productionTokens = new Set<InjectionToken>(productionServices);
    const externalTokens = new Set(
      productionServices.flatMap(getConstructorTokens)
        .filter(token => !productionTokens.has(token))
    );
    const externalMocks: Provider[] = Array.from(externalTokens, token => ({
      provide: token,
      useValue: {}
    }));
    const module = await Test.createTestingModule({
      providers: [...productionServices, ...externalMocks]
    }).compile();

    try {
      productionServices.forEach(service => {
        expect(module.get(service)).toBeInstanceOf(service);
      });

      const productionEdges: [Type<unknown>, string, Type<unknown>][] = [
        [BullJobManagementService, 'codingReadinessService', CodingReadinessService],
        [CodingReadinessService, 'workspaceFilesService', WorkspaceFilesService],
        [WorkspaceFilesService, 'codingStatisticsService', CodingStatisticsService],
        [CodingStatisticsService, 'bullJobManagementService', BullJobManagementService],
        [BullJobManagementService, 'codingFreshnessService', CodingFreshnessService],
        [CodingFreshnessService, 'workspaceExclusionService', WorkspaceExclusionService],
        [WorkspaceExclusionService, 'workspaceCoreService', WorkspaceCoreService],
        [WorkspaceCoreService, 'workspaceTestResultsService', WorkspaceTestResultsService],
        [WorkspaceTestResultsService, 'codingStatisticsService', CodingStatisticsService]
      ];
      productionEdges.forEach(([source, property, dependency]) => {
        expect(Reflect.get(module.get(source) as object, property)).toBe(module.get(dependency));
      });
    } finally {
      await module.close();
    }
  });
});
