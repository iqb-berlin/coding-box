import 'reflect-metadata';
import { readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';
import {
  ExecutionContext, RequestMethod, Type, UnauthorizedException
} from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import {
  createSourceFile, Expression, getDecorators, isCallExpression, isClassDeclaration,
  isMethodDeclaration, ScriptTarget
} from 'typescript';
import { JwtOrWorkspaceTokenAuthGuard } from './jwt-or-workspace-token-auth.guard';
import { WorkspaceGuard } from '../admin/workspace/workspace.guard';
import { AccessLevelGuard } from '../admin/workspace/access-level.guard';
import { WorkspaceUsersController } from '../admin/workspace/workspace-users.controller';
import {
  assertWorkspaceApiTokenScopes,
  WORKSPACE_API_TOKEN_TYPE,
  WORKSPACE_TOKEN_SCOPE_REPLAY_READ as R,
  WORKSPACE_TOKEN_SCOPE_REPLAY_STATISTICS_WRITE as S,
  WORKSPACE_TOKEN_SCOPE_CODING_JOB_OPERATE as C,
  WorkspaceTokenScope
} from './workspace-token';
import { WsgCodingJobController } from '../wsg-admin/coding-job/coding-job.controller';
import { WorkspaceCodingController } from '../admin/workspace/workspace-coding.controller';
import { WorkspacePlayerController } from '../admin/workspace/workspace-player.controller';
import { WorkspaceTestResultsResponseController } from '../admin/workspace/workspace-test-results-response.controller';
import { WorkspaceCodingReplayController } from '../admin/workspace/workspace-coding-replay.controller';
import { UnitInfoController } from '../admin/workspace/unit-info.controller';
import { BookletInfoController } from '../admin/workspace/booklet-info.controller';
import { ReplayStatisticsController } from '../admin/replay-statistics/replay-statistics.controller';

type RoutePolicy = {
  id: string;
  controller: Type<unknown>;
  handler: string;
  http: 'GET' | 'POST' | 'PUT';
  path: string;
  scopes: WorkspaceTokenScope[];
  check: string;
};

const policy = (
  id: string, controller: Type<unknown>, handler: string, http: RoutePolicy['http'],
  path: string, scopes: WorkspaceTokenScope[], check: string
): RoutePolicy => ({
  id, controller, handler, http, path, scopes, check
});

// Reviewed permission contract, independent of the decorators being checked.
const policies: RoutePolicy[] = [
  policy('R01', WorkspacePlayerController, 'findPlayer', 'GET', '/api/admin/workspace/:workspace_id/player/:playerName', [R], 'workspace'),
  policy('R02', WorkspacePlayerController, 'findUnitDef', 'GET', '/api/admin/workspace/:workspace_id/:unit/unitDef', [R], 'workspace'),
  policy('R03', WorkspacePlayerController, 'findUnit', 'GET', '/api/admin/workspace/:workspace_id/unit/:unitId', [R], 'workspace'),
  policy('R04', WorkspacePlayerController, 'getBookletUnits', 'GET', '/api/admin/workspace/:workspace_id/booklet/:bookletId/units', [R], 'workspace'),
  policy('R05', WorkspaceTestResultsResponseController, 'findResponse', 'GET', '/api/admin/workspace/:workspace_id/responses/:testPerson/:unitId', [R], 'workspace'),
  policy('R06', WorkspaceCodingReplayController, 'getReplayUrl', 'GET', '/api/admin/workspace/:workspace_id/coding/responses/:responseId/replay-url', [R], 'workspace'),
  policy('R07', WorkspaceCodingReplayController, 'getReplayPayload', 'GET', '/api/admin/workspace/:workspace_id/replay-payload/:testPerson/:unitId', [R], 'workspace'),
  policy('R08', WorkspaceCodingReplayController, 'getReplayAssets', 'GET', '/api/admin/workspace/:workspace_id/replay-assets/:unitId', [R], 'workspace'),
  policy('R09', WorkspaceCodingReplayController, 'getReplayResponse', 'GET', '/api/admin/workspace/:workspace_id/replay-response/:testPerson/:unitId', [R], 'workspace'),
  policy('R10', UnitInfoController, 'getUnitInfo', 'GET', '/api/admin/workspace/:workspaceId/unit/:unitId/info', [R], 'workspace'),
  policy('R11', BookletInfoController, 'getBookletInfo', 'GET', '/api/admin/workspace/:workspaceId/booklet/:bookletId/info', [R], 'workspace'),
  policy('S01', ReplayStatisticsController, 'storeReplayStatistics', 'POST', '/api/admin/workspace/:workspace_id/replay-statistics', [R, S], 'workspace'),
  policy('J01', WsgCodingJobController, 'getCodingJob', 'GET', '/api/wsg-admin/workspace/:workspace_id/coding-job/:id', [C], 'job-access'),
  policy('J02', WsgCodingJobController, 'updateCodingJob', 'PUT', '/api/wsg-admin/workspace/:workspace_id/coding-job/:id', [C], 'manager-job'),
  policy('J03', WsgCodingJobController, 'updateCodingJobStatus', 'PUT', '/api/wsg-admin/workspace/:workspace_id/coding-job/:id/status', [C], 'job-code'),
  policy('J04', WsgCodingJobController, 'updateCodingJobComment', 'PUT', '/api/wsg-admin/workspace/:workspace_id/coding-job/:id/comment', [C], 'job-access'),
  policy('J05', WsgCodingJobController, 'pauseCodingJob', 'POST', '/api/wsg-admin/workspace/:workspace_id/coding-job/:id/pause', [C], 'job-code'),
  policy('J06', WsgCodingJobController, 'resumeCodingJob', 'POST', '/api/wsg-admin/workspace/:workspace_id/coding-job/:id/resume', [C], 'job-code'),
  policy('J07', WsgCodingJobController, 'submitCodingJob', 'POST', '/api/wsg-admin/workspace/:workspace_id/coding-job/:id/submit', [C], 'job-code'),
  policy('J08', WsgCodingJobController, 'saveCodingProgress', 'POST', '/api/wsg-admin/workspace/:workspace_id/coding-job/:id/progress', [C], 'job-code/review'),
  policy('J09', WsgCodingJobController, 'saveCodingNotes', 'POST', '/api/wsg-admin/workspace/:workspace_id/coding-job/:id/notes', [C], 'job-code/review'),
  policy('J10', WsgCodingJobController, 'getCodingProgress', 'GET', '/api/wsg-admin/workspace/:workspace_id/coding-job/:id/progress', [C], 'job-access'),
  policy('J11', WsgCodingJobController, 'getCodingJobReplaySession', 'GET', '/api/wsg-admin/workspace/:workspace_id/coding-job/:id/replay-session', [C], 'job-access'),
  policy('J12', WsgCodingJobController, 'getCodingJobUnits', 'GET', '/api/wsg-admin/workspace/:workspace_id/coding-job/:id/units', [C], 'job-access'),
  policy('J13', WorkspaceCodingController, 'getCodingJobNotes', 'GET', '/api/admin/workspace/:workspace_id/coding-job/:codingJobId/notes', [C], 'job-access')
];

const handlerOf = (row: Pick<RoutePolicy, 'controller' | 'handler'>) => (
  (row.controller.prototype as Record<string, () => unknown>)[row.handler]
);
const contextOf = (row: Pick<RoutePolicy, 'controller' | 'handler'>): ExecutionContext => ({
  getHandler: () => handlerOf(row),
  getClass: () => row.controller
} as unknown as ExecutionContext);
const allScopes: WorkspaceTokenScope[] = [R, S, C];
const scopeCombinations: WorkspaceTokenScope[][] = [[], [R], [S], [C], [R, S], [R, C], [S, C], [R, S, C]];
const combinations = scopeCombinations.map(scopes => ({ scopes }));
const reflector = new Reflector();

function assertScopes(row: Pick<RoutePolicy, 'controller' | 'handler'>, scopes: string[]) {
  assertWorkspaceApiTokenScopes(contextOf(row), reflector, {
    tokenType: WORKSPACE_API_TOKEN_TYPE, scopes
  });
}

describe('Workspace token permission contract (#569)', () => {
  describe.each(policies)('$id $http $path', row => {
    it('keeps the documented route and authentication/workspace guards', () => {
      const handler = handlerOf(row);
      const prefix = Reflect.getMetadata(PATH_METADATA, row.controller) as string;
      const path = Reflect.getMetadata(PATH_METADATA, handler) as string;
      expect(`/api/${[prefix, path].filter(value => value && value !== '/').join('/')}`).toBe(row.path);
      expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod[row.http]);
      const guards = [
        ...(Reflect.getMetadata(GUARDS_METADATA, row.controller) || []),
        ...(Reflect.getMetadata(GUARDS_METADATA, handler) || [])
      ];
      expect(guards).toEqual(expect.arrayContaining([JwtOrWorkspaceTokenAuthGuard, WorkspaceGuard]));
      if (row.check === 'manager-job') {
        expect(guards).toContain(AccessLevelGuard);
        expect(Reflect.getMetadata('accessLevel', handler)).toBe(2);
      }
    });

    it.each(combinations)('enforces the documented scope combination %j', ({ scopes }) => {
      const allowed = row.scopes.some(scope => scopes.includes(scope));
      if (allowed) {
        expect(() => assertScopes(row, scopes)).not.toThrow();
      } else {
        expect(() => assertScopes(row, scopes)).toThrow(UnauthorizedException);
      }
    });

    it('does not grant an unknown scope', () => {
      expect(() => assertScopes(row, ['admin:all'])).toThrow(UnauthorizedException);
    });
  });

  it('covers every explicit workspace permission across all production controllers', () => {
    const controllerFiles = (directory: string): string[] => readdirSync(directory, { withFileTypes: true })
      .flatMap(entry => {
        const path = resolve(directory, entry.name);
        if (entry.isDirectory()) return controllerFiles(path);
        return entry.name.endsWith('.controller.ts') ? [path] : [];
      });
    const actual = controllerFiles(resolve(__dirname, '..')).flatMap(filename => {
      const source = createSourceFile(filename, readFileSync(filename, 'utf8'), ScriptTarget.Latest, true);
      const decoratorName = (expression: Expression) => (
        isCallExpression(expression) ? expression.expression.getText(source) : expression.getText(source)
      );
      const isScope = (name: string) => ['AllowWorkspaceTokenScopes', 'AllowAnyWorkspaceTokenScopes'].includes(name);
      return source.statements.filter(isClassDeclaration).flatMap(controller => {
        const decorators = (getDecorators(controller) || []).map(decorator => decoratorName(decorator.expression));
        if (!decorators.includes('Controller')) return [];
        return controller.members.filter(isMethodDeclaration).filter(method => {
          const names = (getDecorators(method) || []).map(decorator => decoratorName(decorator.expression));
          return names.some(isScope) || (decorators.some(isScope) &&
            names.some(name => ['Get', 'Post', 'Put', 'Patch', 'Delete', 'All', 'Head', 'Options'].includes(name)));
        }).map(method => `${controller.name?.getText(source)}.${method.name.getText(source)}`);
      });
    });
    expect(actual.sort()).toEqual(policies.map(row => `${row.controller.name}.${row.handler}`).sort());
  });

  it.each(['workspace-api-token-rights-de.md', 'workspace-api-token-rights.md'])(
    'keeps %s consistent with the independently reviewed route contract', filename => {
      const content = readFileSync(resolve(__dirname, '../../../../../docs', filename), 'utf8');
      const allowed = filename.endsWith('-de.md') ? 'ja' : 'yes';
      const denied = filename.endsWith('-de.md') ? 'nein' : 'no';
      const rows = content.split('\n').filter(line => /^\| [RSJ]\d{2} \|/.test(line))
        .map(line => line.split('|').slice(1, -1).map(cell => cell.trim().replace(/`/g, '')));
      expect(rows).toHaveLength(policies.length);
      expect(rows).toEqual(policies.map(row => [
        row.id, row.http, row.path,
        ...allScopes.map(scope => (row.scopes.includes(scope) ? allowed : denied)),
        row.check
      ]));
    }
  );

  it.each([
    [WorkspaceUsersController, 'getWorkspaceTokenPolicy'],
    [WorkspaceUsersController, 'createOwnToken'],
    [WorkspaceUsersController, 'createToken'],
    [WorkspaceUsersController, 'findUsers'],
    [WsgCodingJobController, 'createCodingJob'],
    [WsgCodingJobController, 'deleteCodingJob'],
    [WsgCodingJobController, 'restartCodingJobWithOpenUnits'],
    [WsgCodingJobController, 'submitCodingJobForReview'],
    [ReplayStatisticsController, 'getReplayStatistics']
  ] as const)('denies all workspace scopes on %s.%s', (controller, handler) => {
    expect(() => assertScopes({ controller, handler }, allScopes)).toThrow(UnauthorizedException);
  });
});
