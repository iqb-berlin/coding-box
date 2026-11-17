import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Brackets, EntityManager, In, Repository
} from 'typeorm';
import Persons from '../../entities/persons.entity';
import { Booklet } from '../../entities/booklet.entity';
import { Unit } from '../../entities/unit.entity';
import { ResponseEntity } from '../../entities/response.entity';
import { applyResolvedExclusionsToQuery, WorkspaceExclusionService } from '../workspace/workspace-exclusion.service';
import { getOpenManualCodingPlaceholderCondition } from '../../utils/effective-coding-status-expression.util';
import { statusStringToNumber } from '../../utils/response-status-converter';
import { uniquePositiveIds } from './autocoder-response.util';

const CODING_INCOMPLETE_STATUS = statusStringToNumber('CODING_INCOMPLETE');

/** Reads the coding scope and effective response placeholders, using the preflight manager when supplied. */
@Injectable()
export class AutocoderBatchDataService {
  constructor(
    @InjectRepository(Persons) private readonly personsRepository: Repository<Persons>,
    @InjectRepository(Booklet) private readonly bookletRepository: Repository<Booklet>,
    @InjectRepository(Unit) private readonly unitRepository: Repository<Unit>,
    @InjectRepository(ResponseEntity) private readonly responseRepository: Repository<ResponseEntity>,
    private readonly workspaceExclusionService: WorkspaceExclusionService
  ) {}

  async fetchPersons(
    workspaceId: number,
    personIds: string[],
    manager?: EntityManager
  ): Promise<Persons[]> {
    const repository = manager?.getRepository(Persons) || this.personsRepository;
    return repository.find({
      where: { workspace_id: workspaceId, id: In(personIds) },
      select: ['id', 'group', 'login', 'code', 'uploaded_at']
    });
  }

  async fetchBooklets(
    personIds: number[],
    manager?: EntityManager
  ): Promise<Booklet[]> {
    const repository = manager?.getRepository(Booklet) || this.bookletRepository;
    return repository.createQueryBuilder('booklet')
      .where('booklet.personid = ANY(:personIds)', { personIds })
      .select(['booklet.id', 'booklet.personid'])
      .getMany();
  }

  async fetchUnits(
    workspace_id: number,
    bookletIds: number[],
    unitIds?: number[],
    manager?: EntityManager
  ): Promise<Unit[]> {
    const { globalIgnoredUnits, ignoredBooklets, testletIgnoredUnits } =
      await this.workspaceExclusionService.resolveExclusionsForQueries(
        workspace_id,
        manager
      );
    const repository = manager?.getRepository(Unit) || this.unitRepository;
    const query = repository.createQueryBuilder('unit')
      .leftJoin('unit.booklet', 'booklet')
      .leftJoin('booklet.bookletinfo', 'bookletinfo')
      .where('unit.bookletid = ANY(:bookletIds)', { bookletIds })
      .select(['unit.id', 'unit.bookletid', 'unit.name', 'unit.alias']);

    const ids = uniquePositiveIds(unitIds || []);
    if (ids.length > 0) {
      query.andWhere('unit.id = ANY(:unitIds)', { unitIds: ids });
    }

    applyResolvedExclusionsToQuery(query, { globalIgnoredUnits, ignoredBooklets, testletIgnoredUnits });

    return query.getMany();
  }

  private async markEffectiveV2Placeholders(
    responses: ResponseEntity[],
    manager: EntityManager | undefined,
    repository: Repository<ResponseEntity>
  ): Promise<void> {
    const candidateIds = responses
      .filter(response => (
        response.status_v2 === CODING_INCOMPLETE_STATUS &&
        response.code_v2 === null &&
        response.score_v2 === null
      ))
      .map(response => response.id);

    responses.forEach(response => {
      response.inherits_v1_for_v2 = false;
    });

    if (candidateIds.length === 0) {
      return;
    }

    const executeQuery = manager ?
      manager.query.bind(manager) :
      repository.query.bind(repository);
    const placeholderCondition = getOpenManualCodingPlaceholderCondition(
      'candidate_response'
    );
    const rows: Array<{ id: number | string }> = await executeQuery(
      `
        SELECT candidate_response.id
        FROM response candidate_response
        WHERE candidate_response.id = ANY($1::int[])
          AND ${placeholderCondition}
      `,
      [candidateIds]
    );
    const placeholderIds = new Set(rows.map(row => Number(row.id)));
    responses.forEach(response => {
      response.inherits_v1_for_v2 = placeholderIds.has(response.id);
    });
  }

  async fetchResponses(
    unitIds: number[],
    autoCoderRun: number,
    manager?: EntityManager
  ): Promise<ResponseEntity[]> {
    const repository = manager?.getRepository(ResponseEntity) ||
      this.responseRepository;
    const query = repository
      .createQueryBuilder('ResponseEntity')
      .select([
        'ResponseEntity.id',
        'ResponseEntity.unitid',
        'ResponseEntity.variableid',
        'ResponseEntity.value',
        'ResponseEntity.status',
        'ResponseEntity.subform',
        'ResponseEntity.is_autocoder_generated',
        'ResponseEntity.autocoder_invalidated_version',
        'ResponseEntity.status_v1',
        'ResponseEntity.code_v1',
        'ResponseEntity.score_v1',
        'ResponseEntity.status_v2',
        'ResponseEntity.code_v2',
        'ResponseEntity.score_v2',
        'ResponseEntity.status_v3',
        'ResponseEntity.code_v3',
        'ResponseEntity.score_v3'
      ])
      .where('ResponseEntity.unitid = ANY(:unitIds)', {
        unitIds
      })
      .andWhere(
        new Brackets(qb => {
          qb.where('ResponseEntity.status IN (:...statuses)', {
            statuses: [3, 2, 1]
          }).orWhere('ResponseEntity.status_v1 = :derivePending', {
            derivePending: statusStringToNumber('DERIVE_PENDING') as number
          });
        })
      );

    if (autoCoderRun === 1) {
      query.andWhere(
        '(ResponseEntity.is_autocoder_generated = :isAutocoderGenerated OR ResponseEntity.is_autocoder_generated IS NULL)',
        { isAutocoderGenerated: false }
      );
    } else {
      query.andWhere(
        new Brackets(qb => {
          qb.where(
            '(ResponseEntity.is_autocoder_generated = :isAutocoderGenerated OR ResponseEntity.is_autocoder_generated IS NULL)',
            { isAutocoderGenerated: false }
          ).orWhere(
            `ResponseEntity.is_autocoder_generated = :generatedWithSourceCoding
              AND (
                ResponseEntity.status_v1 IS NOT NULL
                OR ResponseEntity.status_v2 IS NOT NULL
              )`,
            { generatedWithSourceCoding: true }
          );
        })
      );
    }

    const responses = await query.getMany();
    await this.markEffectiveV2Placeholders(responses, manager, repository);
    return responses;
  }
}
