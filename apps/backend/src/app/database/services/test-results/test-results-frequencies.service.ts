import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CacheService } from '../../../cache/cache.service';
import { ResponseEntity } from '../../entities/response.entity';
import { FLAT_FREQUENCIES_CACHE_PREFIX } from '../workspace/workspace-constants';
import { WorkspaceExclusionService } from '../workspace/workspace-exclusion.service';
import { applyExclusionsToQuery, excludeAutocoderGeneratedResponses } from './test-results.util';
import { FlatFrequenciesResult } from './workspace-test-results.types';

@Injectable()
export class TestResultsFrequenciesService {
  constructor(
    @InjectRepository(ResponseEntity) private readonly responseRepository: Repository<ResponseEntity>,
    private readonly cacheService: CacheService,
    @Inject(WorkspaceExclusionService) private readonly workspaceExclusionService: WorkspaceExclusionService
  ) {}

  async findFlatResponseFrequencies(
    workspaceId: number,
    combos: Array<{ unitKey: string; variableId: string; values: string[] }>
  ): Promise<
    Record<
      string,
      {
        total: number;
        values: Array<{ value: string; count: number; p: number }>;
      }
    >
  > {
    if (!workspaceId || workspaceId <= 0) {
      throw new Error('Invalid workspaceId provided');
    }

    const normalized = (combos || [])
      .map(c => ({
        unitKey: String(c.unitKey || '').trim(),
        variableId: String(c.variableId || '').trim(),
        values: Array.isArray(c.values) ?
          c.values.map(v => String(v ?? '')) :
          []
      }))
      .filter(c => !!c.unitKey && !!c.variableId);

    if (normalized.length === 0) {
      return {};
    }

    // Sort combos for consistent cache key
    const sortedCombos = [...normalized].sort((a, b) => {
      const keyA = `${a.unitKey}:${a.variableId}`;
      const keyB = `${b.unitKey}:${b.variableId}`;
      return keyA.localeCompare(keyB);
    });

    const cacheKey = `${FLAT_FREQUENCIES_CACHE_PREFIX}${workspaceId}-${JSON.stringify(sortedCombos)}`;
    const cached = await this.cacheService.get<FlatFrequenciesResult>(cacheKey);
    if (cached) {
      return cached;
    }

    const uniqueMap = new Map<
      string,
      { unitKey: string; variableId: string; values: string[] }
    >();
    normalized.forEach(c => {
      const key = `${encodeURIComponent(c.unitKey)}:${encodeURIComponent(
        c.variableId
      )}`;
      const prev = uniqueMap.get(key);
      if (prev) {
        prev.values = Array.from(
          new Set([...(prev.values || []), ...(c.values || [])])
        );
      } else {
        uniqueMap.set(key, {
          unitKey: c.unitKey,
          variableId: c.variableId,
          values: Array.from(new Set(c.values || []))
        });
      }
    });
    const uniqueCombos = Array.from(uniqueMap.values());

    const qb = this.responseRepository
      .createQueryBuilder('response')
      .innerJoin('response.unit', 'unit')
      .innerJoin('unit.booklet', 'bookletEntity')
      .innerJoin('bookletEntity.bookletinfo', 'bookletinfo')
      .innerJoin('bookletEntity.person', 'person')
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true });
    const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
    applyExclusionsToQuery(qb, exclusions, {
      bookletInfoAlias: 'bookletinfo'
    });
    excludeAutocoderGeneratedResponses(qb);

    const params: Record<string, unknown> = {};
    const orParts = uniqueCombos.map((c, idx) => {
      const uk = `uk${idx}`;
      const v = `v${idx}`;
      params[uk] = c.unitKey;
      params[v] = c.variableId;
      return `(COALESCE(unit.alias, unit.name) = :${uk} AND response.variableid = :${v})`;
    });
    qb.andWhere(`(${orParts.join(' OR ')})`, params);

    const allRequestedValues = Array.from(
      new Set(
        uniqueCombos.flatMap(c => (c.values || []).map(v => String(v ?? ''))
        )
      )
    );

    const totalsRaw = await qb
      .clone()
      .select([
        'COALESCE(unit.alias, unit.name) AS "unitKey"',
        'response.variableid AS "variableId"',
        'COUNT(*)::int AS "total"'
      ])
      .groupBy('COALESCE(unit.alias, unit.name)')
      .addGroupBy('response.variableid')
      .getRawMany<{
      unitKey: string;
      variableId: string;
      total: number | string;
    }>();

    const totalByKey = new Map<string, number>();
    totalsRaw.forEach(r => {
      const unitKey = String(r.unitKey || '').trim();
      const variableId = String(r.variableId || '').trim();
      totalByKey.set(
        `${encodeURIComponent(unitKey)}:${encodeURIComponent(variableId)}`,
        Number(r.total || 0)
      );
    });

    const countsQb = qb.clone();
    if (allRequestedValues.length > 0) {
      countsQb.andWhere(
        "SUBSTRING(COALESCE(response.value, ''), 1, 2000) IN (:...values)",
        { values: allRequestedValues }
      );
    }

    const countsRaw = await countsQb
      .select([
        'COALESCE(unit.alias, unit.name) AS "unitKey"',
        'response.variableid AS "variableId"',
        'SUBSTRING(COALESCE(response.value, \'\'), 1, 2000) AS "value"',
        'COUNT(*)::int AS "count"'
      ])
      .groupBy('COALESCE(unit.alias, unit.name)')
      .addGroupBy('response.variableid')
      .addGroupBy("SUBSTRING(COALESCE(response.value, ''), 1, 2000)")
      .getRawMany<{
      unitKey: string;
      variableId: string;
      value: string;
      count: number | string;
    }>();

    const countByKeyAndValue = new Map<string, number>();
    countsRaw.forEach(r => {
      const unitKey = String(r.unitKey || '').trim();
      const variableId = String(r.variableId || '').trim();
      const comboKey = `${encodeURIComponent(unitKey)}:${encodeURIComponent(
        variableId
      )}`;
      const value = String(r.value ?? '');
      countByKeyAndValue.set(`${comboKey}@@${value}`, Number(r.count || 0));
    });

    const result: Record<
      string,
      {
        total: number;
        values: Array<{ value: string; count: number; p: number }>;
      }
    > = {};
    uniqueCombos.forEach(c => {
      const key = `${encodeURIComponent(c.unitKey)}:${encodeURIComponent(
        c.variableId
      )}`;
      const total = totalByKey.get(key) || 0;
      const values = Array.from(new Set(c.values || []));

      const rows = values.map(v => {
        const count = countByKeyAndValue.get(`${key}@@${v}`) || 0;
        return {
          value: v,
          count,
          p: total > 0 ? count / total : 0
        };
      });
      result[key] = { total, values: rows };
    });

    await this.cacheService.set(cacheKey, result, 300); // 5 minutes cache
    return result;
  }
}
