import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { ResponseEntity } from '../../entities/response.entity';
import { ResetCodingPreviewResult, ResetCodingScope } from '../../../../../../../api-dto/coding/reset-coding-preview.dto';
import { codingResetCleanupCondition, codingResetConditions, codingResetScopeQuery } from './coding-reset-scope.util';

@Injectable()
export class CodingResetPreviewService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) { }

  async preview(workspaceId: number, scope: ResetCodingScope): Promise<ResetCodingPreviewResult> {
    return this.dataSource.transaction('REPEATABLE READ', async manager => {
      await manager.query('SET TRANSACTION READ ONLY');
      await manager.query("SET LOCAL statement_timeout = '120s'");
      const unknownUnits = await this.unknownFilters(manager, workspaceId, scope, 'unit');
      const unknownVariables = unknownUnits.length ? [] : await this.unknownFilters(manager, workspaceId, scope, 'variable');
      if (unknownUnits.length || unknownVariables.length) {
        return {
          status: 'invalid-filters',
          unknownUnits,
          unknownVariables,
          affectedResponseCount: null,
          resetResponseCount: null,
          deletedGeneratedResponseCount: null,
          checkedAt: new Date().toISOString()
        };
      }
      const target = codingResetConditions(scope.version).join(' AND ');
      const cleanup = codingResetCleanupCondition(scope.version);
      const counts = await codingResetScopeQuery(manager.getRepository(ResponseEntity), workspaceId, scope.unitFilters, scope.variableFilters)
        .andWhere(`((${target}) OR ${cleanup})`)
        .select('COUNT(*)', 'affected')
        .addSelect(`COUNT(*) FILTER (WHERE ${target})`, 'reset')
        .addSelect(`COUNT(*) FILTER (WHERE ${cleanup})`, 'deleted')
        .getRawOne<{ affected: string; reset: string; deleted: string }>();
      return {
        status: 'valid',
        unknownUnits: [],
        unknownVariables: [],
        affectedResponseCount: Number(counts?.affected ?? 0),
        resetResponseCount: Number(counts?.reset ?? 0),
        deletedGeneratedResponseCount: Number(counts?.deleted ?? 0),
        checkedAt: new Date().toISOString()
      };
    });
  }

  private async unknownFilters(manager: EntityManager, workspaceId: number, scope: ResetCodingScope,
                               kind: 'unit' | 'variable'): Promise<string[]> {
    const filters = kind === 'unit' ? scope.unitFilters : scope.variableFilters;
    if (!filters.length) return [];
    const responseJoin = kind === 'variable' ? 'JOIN response r ON r.unitid = u.id' : '';
    const match = kind === 'unit' ? 'u.name = candidate.value' : 'r.variableid = candidate.value';
    const unitScope = kind === 'variable' && scope.unitFilters.length ? 'AND u.name = ANY($3::text[])' : '';
    const rows = await manager.query<{ value: string }[]>(`
      SELECT candidate.value FROM unnest($2::text[]) AS candidate(value)
      WHERE NOT EXISTS (
        SELECT 1 FROM unit u JOIN booklet b ON b.id = u.bookletid
        JOIN persons p ON p.id = b.personid ${responseJoin}
        WHERE p.workspace_id = $1 AND ${match} ${unitScope}
      )`, unitScope ? [workspaceId, filters, scope.unitFilters] : [workspaceId, filters]);
    return rows.map(row => row.value);
  }
}
