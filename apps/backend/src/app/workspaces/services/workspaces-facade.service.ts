import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Repository, In, Brackets, Like, FindOptionsWhere
} from 'typeorm';
import { Unit } from '../entities/unit.entity';
import Persons from '../entities/persons.entity';
import { Booklet } from '../entities/booklet.entity';
import { ResponseEntity } from '../entities/response.entity';
import FileUpload from '../entities/file_upload.entity';
import { Setting } from '../entities/setting.entity';
import { statusStringToNumber } from '../utils/response-status-converter';

@Injectable()
export class WorkspacesFacadeService {
  constructor(
    @InjectRepository(Unit)
    private readonly unitRepository: Repository<Unit>,
    @InjectRepository(Persons)
    private readonly personsRepository: Repository<Persons>,
    @InjectRepository(Booklet)
    private readonly bookletRepository: Repository<Booklet>,
    @InjectRepository(ResponseEntity)
    private readonly responseRepository: Repository<ResponseEntity>,
    @InjectRepository(FileUpload)
    private readonly fileUploadRepository: Repository<FileUpload>,
    @InjectRepository(Setting)
    private readonly settingRepository: Repository<Setting>
  ) {}

  // --- Persons ---

  async findPersonsByIds(workspaceId: number, personIds: string[]): Promise<Persons[]> {
    return this.personsRepository.find({
      where: { workspace_id: workspaceId, id: In(personIds) },
      select: ['id', 'group', 'login', 'code', 'uploaded_at']
    });
  }

  async findPersonsByGroup(workspaceId: number, groups: string[]): Promise<Persons[]> {
    return this.personsRepository.find({
      where: {
        workspace_id: workspaceId,
        group: In(groups),
        consider: true
      },
      select: ['id']
    });
  }

  async findConsideringPersons(workspaceId: number): Promise<Persons[]> {
    return this.personsRepository.find({
      where: { workspace_id: workspaceId, consider: true }
    });
  }

  // --- Booklets ---

  async findBookletsByPersonIds(personIds: number[]): Promise<Booklet[]> {
    return this.bookletRepository.find({
      where: { personid: In(personIds) },
      select: ['id', 'personid']
    });
  }

  // --- Responses ---

  async findResponsesByUnitIds(unitIds: number[]): Promise<ResponseEntity[]> {
    return this.responseRepository
      .createQueryBuilder('ResponseEntity')
      .select([
        'ResponseEntity.id',
        'ResponseEntity.unitid',
        'ResponseEntity.variableid',
        'ResponseEntity.value',
        'ResponseEntity.status',
        'ResponseEntity.status_v1',
        'ResponseEntity.status_v2'
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
      )
      .getMany();
  }

  // Specific query for CodingJobService.getResponsesForCodingJob
  async findResponsesForVariables(variables: { unitName: string; variableId: string }[]): Promise<ResponseEntity[]> {
    const queryBuilder = this.responseRepository.createQueryBuilder('response')
      .leftJoinAndSelect('response.unit', 'unit')
      .leftJoinAndSelect('unit.booklet', 'booklet')
      .leftJoinAndSelect('booklet.bookletinfo', 'bookletinfo')
      .leftJoinAndSelect('booklet.person', 'person');

    const conditions: string[] = [];
    const parameters: Record<string, string> = {};

    variables.forEach((variable, index) => {
      const unitParam = `unitName${index}`;
      const variableParam = `variableId${index}`;
      conditions.push(`(unit.name = :${unitParam} AND response.variableid = :${variableParam})`);
      parameters[unitParam] = variable.unitName;
      parameters[variableParam] = variable.variableId;
    });

    if (conditions.length > 0) {
      queryBuilder.where(`(${conditions.join(' OR ')})`, parameters);
    }

    return queryBuilder
      .orderBy('response.id', 'ASC')
      .getMany();
  }

  // --- Test Files ---
  // Currently used in WorkspaceCodingService but it delegates to codingFileCache which delegates to workspaceFilesService.
  // wait, WorkspaceCodingService uses fileUploadRepository indirectly?
  // Ah, it injects it but maybe doesn't use it directly?
  // `private fileUploadRepository: Repository<FileUpload>` is injected.
  // Is it used?
  // I don't see direct usages in `codeTestPersons`.
  // It uses `workspaceFilesService` mostly.
  // Let's assume we might need it.

  // --- Test Files ---

  async findFilesByIds(fileIds: number[]): Promise<FileUpload[]> {
    return this.fileUploadRepository.findBy({
      id: In(fileIds)
    });
  }

  async findFilesByFileIds(workspaceId: number | undefined, fileIds: string[]): Promise<FileUpload[]> {
    const where: FindOptionsWhere<FileUpload> = {
      file_id: In(fileIds)
    };
    if (workspaceId !== undefined) {
      where.workspace_id = workspaceId;
    }
    return this.fileUploadRepository.find({
      where,
      select: ['file_id', 'data', 'filename']
    });
  }

  // --- Queries for CodingListService ---

  async findCodingIncompleteResponses(
    workspaceId: number,
    lastId: number,
    batchSize: number
  ): Promise<ResponseEntity[]> {
    return this.responseRepository
      .createQueryBuilder('response')
      .leftJoinAndSelect('response.unit', 'unit')
      .leftJoinAndSelect('unit.booklet', 'booklet')
      .leftJoinAndSelect('booklet.person', 'person')
      .leftJoinAndSelect('booklet.bookletinfo', 'bookletinfo')
      .where('response.status_v1 = :status', {
        status: statusStringToNumber('CODING_INCOMPLETE')
      })
      .andWhere('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true })
      .andWhere('response.id > :lastId', { lastId })
      .orderBy('response.id', 'ASC')
      .take(batchSize)
      .getMany();
  }

  async findCodingIncompleteResponsesAndCount(
    workspaceId: number
  ): Promise<[ResponseEntity[], number]> {
    return this.responseRepository
      .createQueryBuilder('response')
      .leftJoinAndSelect('response.unit', 'unit')
      .leftJoinAndSelect('unit.booklet', 'booklet')
      .leftJoinAndSelect('booklet.person', 'person')
      .leftJoinAndSelect('booklet.bookletinfo', 'bookletinfo')
      .where('response.status_v1 = :status', {
        status: statusStringToNumber('CODING_INCOMPLETE')
      })
      .andWhere('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true })
      .orderBy('response.id', 'ASC')
      .getManyAndCount();
  }

  async findCodingIncompleteVariables(workspaceId: number): Promise<{ unitName: string; variableId: string }[]> {
    return this.responseRepository
      .createQueryBuilder('response')
      .innerJoin('response.unit', 'unit')
      .innerJoin('unit.booklet', 'booklet')
      .innerJoin('booklet.person', 'person')
      .select('unit.name', 'unitName')
      .addSelect('response.variableid', 'variableId')
      .distinct(true)
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true })
      .andWhere('response.status_v1 = :status', {
        status: statusStringToNumber('CODING_INCOMPLETE')
      })
      // Excluding media variables
      .andWhere(
        `response.variableid NOT LIKE 'image%'
         AND response.variableid NOT LIKE 'text%'
         AND response.variableid NOT LIKE 'audio%'
         AND response.variableid NOT LIKE 'frame%'
         AND response.variableid NOT LIKE 'video%'
         AND response.variableid NOT LIKE '%_0' ESCAPE '\\'`
      )
      .andWhere(
        "(response.value IS NOT NULL AND response.value != '')"
      )
      .getRawMany();
  }

  async findResponsesByVersion(
    workspaceId: number,
    version: 'v1' | 'v2' | 'v3',
    lastId: number,
    batchSize: number
  ): Promise<ResponseEntity[]> {
    return this.responseRepository
      .createQueryBuilder('response')
      .leftJoinAndSelect('response.unit', 'unit')
      .leftJoinAndSelect('unit.booklet', 'booklet')
      .leftJoinAndSelect('booklet.person', 'person')
      .leftJoinAndSelect('booklet.bookletinfo', 'bookletinfo')
      .where(`response.status_${version} IS NOT NULL`)
      .andWhere('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('response.id > :lastId', { lastId })
      .orderBy('response.id', 'ASC')
      .take(batchSize)
      .getMany();
  }

  // --- Settings ---
  // Used somewhere? Maybe not in CodingModule directly but CodingJobService injects Setting.
  // Actually CodingJobService doesn't seem to use Setting in the visible code, maybe it was a leftover.
  // search for settingRepository in CodingJobService

  async findBookletsWithInfoByPersonIds(personIds: number[]): Promise<Booklet[]> {
    return this.bookletRepository.find({
      where: { personid: In(personIds) },
      relations: ['bookletinfo']
    });
  }

  async findResponsesByUnitIdsAndStatus(
    unitIds: number[],
    status: number
  ): Promise<ResponseEntity[]> {
    return this.responseRepository.find({
      where: {
        unitid: In(unitIds),
        status_v1: status
      }
    });
  }

  async findResponseIdsForReset(
    workspaceId: number,
    unitNames: string[] | undefined,
    variableIds: string[] | undefined
  ): Promise<number[]> {
    const queryBuilder = this.responseRepository
      .createQueryBuilder('response')
      .select('response.id')
      .leftJoin('response.unit', 'unit')
      .leftJoin('unit.booklet', 'booklet')
      .leftJoin('booklet.person', 'person')
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true });

    if (unitNames && unitNames.length > 0) {
      queryBuilder.andWhere('unit.name IN (:...unitNames)', { unitNames });
    }

    if (variableIds && variableIds.length > 0) {
      queryBuilder.andWhere('response.variableid IN (:...variableIds)', { variableIds });
    }

    const results = await queryBuilder.getMany();
    return results.map(r => r.id);
  }

  async resetResponseValues(
    responseIds: number[],
    fieldsToReset: Record<string, null>
  ): Promise<void> {
    if (responseIds.length === 0) return;
    await this.responseRepository.update(
      { id: In(responseIds) },
      fieldsToReset
    );
  }

  async checkResponseExists(
    unitKey: string,
    loginName: string,
    loginCode: string,
    bookletId: string,
    variableId: string
  ): Promise<boolean> {
    const count = await this.responseRepository
      .createQueryBuilder('response')
      .innerJoin('response.unit', 'unit')
      .innerJoin('unit.booklet', 'booklet')
      .innerJoin('booklet.person', 'person')
      .innerJoin('booklet.bookletinfo', 'bookletinfo')
      .where('unit.alias = :unitKey', { unitKey })
      .andWhere('person.login = :loginName', { loginName })
      .andWhere('person.code = :loginCode', { loginCode })
      .andWhere('bookletinfo.name = :bookletId', { bookletId })
      .andWhere('response.variableid = :variableId', { variableId })
      .andWhere('response.value IS NOT NULL')
      .andWhere('response.value != :empty', { empty: '' })
      .getCount();

    return count > 0;
  }

  async findCodingIncompleteVariablesWithCounts(
    workspaceId: number,
    unitName?: string
  ): Promise<
    { unitName: string; variableId: string; responseCount: string }[]
    > {
    const queryBuilder = this.responseRepository
      .createQueryBuilder('response')
      .select('unit.name', 'unitName')
      .addSelect('response.variableid', 'variableId')
      .addSelect('COUNT(response.id)', 'responseCount')
      .leftJoin('response.unit', 'unit')
      .leftJoin('unit.booklet', 'booklet')
      .leftJoin('booklet.person', 'person')
      .where('response.status_v1 = :status', {
        status: statusStringToNumber('CODING_INCOMPLETE')
      })
      .andWhere('person.workspace_id = :workspaceId', {
        workspaceId
      })
      .andWhere('person.consider = :consider', { consider: true });

    if (unitName) {
      queryBuilder.andWhere('unit.name = :unitName', { unitName });
    }

    queryBuilder.groupBy('unit.name').addGroupBy('response.variableid');

    return queryBuilder.getRawMany();
  }

  async findResponsesByStatus(
    workspaceId: number,
    statusNumber: number,
    version: 'v1' | 'v2' | 'v3',
    offset: number,
    limit: number
  ): Promise<{ data: ResponseEntity[]; total: number }> {
    const selectFields = [
      'response.id',
      'response.unitId',
      'response.variableid',
      'response.value',
      'response.status',
      'response.codedstatus',
      'response.code_v1', 'response.score_v1',
      'response.code_v2', 'response.score_v2',
      'response.code_v3', 'response.score_v3',
      'response.status_v1',
      'response.status_v2',
      'response.status_v3'
    ];

    const queryBuilder = this.responseRepository
      .createQueryBuilder('response')
      .leftJoinAndSelect('response.unit', 'unit')
      .leftJoinAndSelect('unit.booklet', 'booklet')
      .leftJoinAndSelect('booklet.person', 'person')
      .leftJoinAndSelect('booklet.bookletinfo', 'bookletinfo')
      .select(selectFields)
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true });

    switch (version) {
      case 'v1':
        queryBuilder.andWhere('response.status_v1 = :status', { status: statusNumber });
        break;
      case 'v2':
        queryBuilder.andWhere('response.status_v2 = :status', { status: statusNumber });
        break;
      case 'v3':
        queryBuilder.andWhere('response.status_v3 = :status', { status: statusNumber });
        break;
      default:
        queryBuilder.andWhere('response.status_v1 = :status', { status: statusNumber });
        break;
    }

    const total = await queryBuilder.getCount();
    const data = await queryBuilder
      .orderBy('response.id', 'ASC')
      .skip(offset)
      .take(limit)
      .getMany();

    return { data, total };
  }

  async findResponseByIdWithRelations(responseId: number): Promise<ResponseEntity | null> {
    return this.responseRepository.findOne({
      where: { id: responseId },
      relations: [
        'unit',
        'unit.booklet',
        'unit.booklet.person',
        'unit.booklet.bookletinfo'
      ]
    });
  }

  async findResponsesForImport(
    workspaceId: number,
    unitIdentifier: string,
    isUnitKey: boolean,
    variableId: string,
    criteria: {
      personCode?: string;
      personLogin?: string;
      personGroup?: string;
      bookletName?: string;
    }
  ): Promise<ResponseEntity[]> {
    const queryBuilder = this.responseRepository
      .createQueryBuilder('response')
      .leftJoinAndSelect('response.unit', 'unit')
      .leftJoinAndSelect('unit.booklet', 'booklet')
      .leftJoinAndSelect('booklet.person', 'person')
      .leftJoinAndSelect('booklet.bookletinfo', 'bookletinfo');

    if (isUnitKey) {
      queryBuilder.andWhere('unit.name = :unitIdentifier', { unitIdentifier });
    } else {
      queryBuilder.andWhere('unit.alias = :unitIdentifier', { unitIdentifier });
    }

    queryBuilder
      .andWhere('response.variableid = :variableId', { variableId })
      .andWhere('person.workspace_id = :workspaceId', { workspaceId });

    if (criteria.personCode) {
      queryBuilder.andWhere('person.code = :personCode', { personCode: criteria.personCode });
    }
    if (criteria.personLogin) {
      queryBuilder.andWhere('person.login = :personLogin', { personLogin: criteria.personLogin });
    }
    if (criteria.personGroup) {
      queryBuilder.andWhere('person.group = :personGroup', { personGroup: criteria.personGroup });
    }
    if (criteria.bookletName) {
      queryBuilder.andWhere('bookletinfo.name = :bookletName', { bookletName: criteria.bookletName });
    }

    return queryBuilder.getMany();
  }

  async updateResponseStatus(
    responseId: number,
    updateData: {
      status_v2?: number | null;
      code_v2?: number | null;
      score_v2?: number | null;
    }
  ): Promise<void> {
    await this.responseRepository
      .createQueryBuilder()
      .update(ResponseEntity)
      .set(updateData)
      .where('id = :responseId', { responseId })
      .execute();
  }

  async findCodingIncompleteResponsesForVariables(
    workspaceId: number,
    variables: { unitName: string; variableId: string }[]
  ): Promise<ResponseEntity[]> {
    if (variables.length === 0) return [];

    const queryBuilder = this.responseRepository.createQueryBuilder('response')
      .leftJoinAndSelect('response.unit', 'unit')
      .leftJoinAndSelect('unit.booklet', 'booklet')
      .leftJoinAndSelect('booklet.bookletinfo', 'bookletinfo')
      .leftJoinAndSelect('booklet.person', 'person')
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true })
      .andWhere('response.status_v1 = :status', { status: statusStringToNumber('CODING_INCOMPLETE') });

    const conditions: string[] = [];
    const parameters: Record<string, string> = {};

    variables.forEach((variable, index) => {
      const unitParam = `unitName${index}`;
      const variableParam = `variableId${index}`;
      conditions.push(`(unit.name = :${unitParam} AND response.variableid = :${variableParam})`);
      parameters[unitParam] = variable.unitName;
      parameters[variableParam] = variable.variableId;
    });

    if (conditions.length > 0) {
      queryBuilder.andWhere(`(${conditions.join(' OR ')})`, parameters);
    }

    return queryBuilder
      .orderBy('response.id', 'ASC')
      .getMany();
  }

  async findSettingByKey(key: string): Promise<Setting | null> {
    return this.settingRepository.findOne({ where: { key } });
  }

  async findResponsesByIdsWithRelations(ids: number[]): Promise<ResponseEntity[]> {
    return this.responseRepository.find({
      where: { id: In(ids) },
      relations: ['unit', 'unit.booklet', 'unit.booklet.bookletinfo', 'unit.booklet.person']
    });
  }

  async findResponsesByUnitsAndVariables(
    unitIds: number[],
    variableIds: string[]
  ): Promise<ResponseEntity[]> {
    return this.responseRepository.find({
      where: {
        unitid: In(unitIds),
        variableid: In(variableIds)
      },
      relations: ['unit', 'unit.booklet', 'unit.booklet.person'],
      select: {
        id: true,
        variableid: true,
        code_v1: true,
        score_v1: true,
        code_v2: true,
        score_v2: true,
        code_v3: true,
        score_v3: true,
        unit: {
          id: true,
          name: true,
          booklet: {
            id: true,
            person: {
              id: true,
              login: true,
              code: true,
              group: true
            }
          }
        }
      }
    });
  }

  async findIncompleteResponsesForVariableConfig(
    variableId: string
  ): Promise<ResponseEntity[]> {
    return this.responseRepository.find({
      where: {
        status_v1: statusStringToNumber('CODING_INCOMPLETE'),
        variableid: variableId
      },
      relations: ['unit', 'unit.booklet', 'unit.booklet.person', 'unit.booklet.bookletinfo'],
      select: {
        id: true,
        value: true,
        variableid: true,
        status_v1: true,
        code_v1: true,
        score_v1: true,
        unit: {
          id: true,
          name: true,
          alias: true,
          booklet: {
            id: true,
            person: {
              id: true,
              login: true,
              code: true,
              group: true
            },
            bookletinfo: {
              id: true,
              name: true
            }
          }
        }
      }
    });
  }

  async updateResponsesV2(
    updates: {
      responseId: number;
      code_v2: number | null;
      score_v2: number | null;
      status_v2: number;
    }[]
  ): Promise<void> {
    await this.responseRepository.manager.transaction(async manager => {
      const batchSize = 500;
      for (let i = 0; i < updates.length; i += batchSize) {
        const batch = updates.slice(i, i + batchSize);
        await Promise.all(
          batch.map(update => manager.update(ResponseEntity, update.responseId, {
            code_v2: update.code_v2,
            score_v2: update.score_v2,
            status_v2: update.status_v2
          })
          )
        );
      }
    });
  }

  async getWorkspaceIdsWithResponses(codedStatuses: number[]): Promise<number[]> {
    const result = await this.responseRepository.createQueryBuilder('response')
      .select('DISTINCT person.workspace_id', 'workspace_id')
      .innerJoin('response.unit', 'unit')
      .innerJoin('unit.booklet', 'booklet')
      .innerJoin('booklet.person', 'person')
      .where('response.status = ANY(:codedStatuses)', { codedStatuses })
      .andWhere('person.consider = :consider', { consider: true })
      .getRawMany();

    return result.map(row => parseInt(row.workspace_id, 10)).filter(id => !Number.isNaN(id));
  }

  async getResponseStatusCounts(
    workspaceId: number,
    codedStatuses: number[],
    statusColumn: string,
    whereCondition: string,
    unitNames: string[]
  ): Promise<{ statusValue: number; count: string }[]> {
    return this.responseRepository.query(`
      SELECT
        ${statusColumn} as "statusValue",
        COUNT(response.id) as count
      FROM response
      INNER JOIN unit ON response.unitid = unit.id
      INNER JOIN booklet ON unit.bookletid = booklet.id
      INNER JOIN persons person ON booklet.personid = person.id
      WHERE response.status = ANY($1)
        AND ${whereCondition}
        AND person.workspace_id = $2
        AND person.consider = $3
        AND unit.name = ANY($4)
      GROUP BY ${statusColumn}
    `, [codedStatuses, workspaceId, true, unitNames]);
  }

  async findFilesByType(workspaceId: number, fileType: string): Promise<FileUpload[]> {
    return this.fileUploadRepository.find({
      where: { workspace_id: workspaceId, file_type: fileType }
    });
  }

  async findUnitsByBookletIds(bookletIds: number[]): Promise<Unit[]> {
    return this.unitRepository.find({
      where: { bookletid: In(bookletIds) },
      select: ['id', 'name']
    });
  }

  async findIncompleteResponsesByUnitIds(unitIds: number[]): Promise<ResponseEntity[]> {
    return this.responseRepository.find({
      where: {
        unitid: In(unitIds),
        status_v1: In([
          statusStringToNumber('CODING_INCOMPLETE'),
          statusStringToNumber('INTENDED_INCOMPLETE'),
          statusStringToNumber('CODE_SELECTION_PENDING'),
          statusStringToNumber('CODING_ERROR')
        ])
      }
    });
  }

  async saveResponse(response: ResponseEntity): Promise<ResponseEntity> {
    return this.responseRepository.save(response);
  }

  async queryResponses(query: string, parameters: unknown[]): Promise<unknown> {
    return this.responseRepository.query(query, parameters);
  }

  async getVariableFrequencies(
    workspaceId: number,
    unitId?: number,
    variableId?: string
  ): Promise<Record<string, unknown>[]> {
    const query = this.responseRepository
      .createQueryBuilder('response')
      .innerJoin('response.unit', 'unit')
      .innerJoin('unit.booklet', 'booklet')
      .innerJoin('booklet.person', 'person')
      .innerJoin('booklet.bookletinfo', 'bookletinfo')
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true });

    if (unitId) {
      query.andWhere('unit.id = :unitId', { unitId });
    }

    if (variableId) {
      query.andWhere('response.variableid LIKE :variableId', { variableId: `%${variableId}%` });
    }

    const variableCombosQuery = query.clone()
      .select('unit.id', 'unitId')
      .addSelect('unit.name', 'unitName')
      .addSelect('response.variableid', 'variableId')
      .distinct(true)
      .orderBy('unit.name', 'ASC')
      .addOrderBy('response.variableid', 'ASC');

    const variableCombosResult = await variableCombosQuery.getRawMany();

    const results = [];
    for (const combo of variableCombosResult) {
      const valuesQuery = query.clone()
        .select('response.value', 'value')
        .addSelect('COUNT(*)', 'count')
        .andWhere('unit.id = :uId', { uId: combo.unitId })
        .andWhere('response.variableid = :vId', { vId: combo.variableId })
        .groupBy('response.value')
        .orderBy('count', 'DESC');

      const valuesResult = await valuesQuery.getRawMany();
      results.push({
        ...combo,
        values: valuesResult
      });
    }

    return results;
  }

  async findFileSpecific(workspaceId: number, fileType: string, fileId: string): Promise<FileUpload | null> {
    return this.fileUploadRepository.findOne({
      where: {
        workspace_id: workspaceId,
        file_type: fileType,
        file_id: fileId
      }
    });
  }

  async findFilesByPattern(workspaceId: number, fileType: string, pattern: string): Promise<FileUpload[]> {
    return this.fileUploadRepository.find({
      where: {
        workspace_id: workspaceId,
        file_type: fileType,
        file_id: Like(pattern)
      },
      select: ['file_id', 'data']
    });
  }

  async countCodingIncompleteResponses(workspaceId: number): Promise<number> {
    return this.responseRepository
      .createQueryBuilder('response')
      .leftJoin('response.unit', 'unit')
      .leftJoin('unit.booklet', 'booklet')
      .leftJoin('booklet.person', 'person')
      .where('response.status_v1 = :status', {
        status: statusStringToNumber('CODING_INCOMPLETE')
      })
      .andWhere('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true })
      .getCount();
  }

  async getVariableAnalysisCount(
    workspaceId: number,
    unitIdFilter?: string,
    variableIdFilter?: string
  ): Promise<number> {
    const queryBuilder = this.responseRepository.createQueryBuilder('response')
      .select('COUNT(DISTINCT CONCAT(unit.name, response.variableid, response.code_v1))', 'count')
      .leftJoin('response.unit', 'unit')
      .leftJoin('unit.booklet', 'booklet')
      .leftJoin('booklet.person', 'person')
      .where('person.workspace_id = :workspaceId', { workspaceId });

    if (unitIdFilter) {
      queryBuilder.andWhere('unit.name LIKE :unitId', { unitId: `%${unitIdFilter}%` });
    }

    if (variableIdFilter) {
      queryBuilder.andWhere('response.variableid LIKE :variableId', { variableId: `%${variableIdFilter}%` });
    }

    const result = await queryBuilder.getRawOne();
    return parseInt(result?.count || '0', 10);
  }

  async getVariableAnalysisAggregated(
    workspaceId: number,
    page: number,
    limit: number,
    unitIdFilter?: string,
    variableIdFilter?: string
  ): Promise<Record<string, unknown>[]> {
    const queryBuilder = this.responseRepository.createQueryBuilder('response')
      .select('unit.name', 'unitId')
      .addSelect('response.variableid', 'variableId')
      .addSelect('response.code_v1', 'code_v1')
      .addSelect('COUNT(response.id)', 'occurrenceCount')
      .addSelect('MAX(response.score_v1)', 'score_V1')
      .leftJoin('response.unit', 'unit')
      .leftJoin('unit.booklet', 'booklet')
      .leftJoin('booklet.person', 'person')
      .leftJoin('booklet.bookletinfo', 'bookletinfo')
      .where('person.workspace_id = :workspaceId', { workspaceId });

    if (unitIdFilter) {
      queryBuilder.andWhere('unit.name LIKE :unitId', { unitId: `%${unitIdFilter}%` });
    }

    if (variableIdFilter) {
      queryBuilder.andWhere('response.variableid LIKE :variableId', { variableId: `%${variableIdFilter}%` });
    }

    queryBuilder
      .groupBy('unit.name')
      .addGroupBy('response.variableid')
      .addGroupBy('response.code_v1')
      .orderBy('unit.name', 'ASC')
      .addOrderBy('response.variableid', 'ASC')
      .addOrderBy('response.code_v1', 'ASC')
      .offset((page - 1) * limit)
      .limit(limit);

    return queryBuilder.getRawMany();
  }

  async getVariableAnalysisTotalCounts(
    workspaceId: number,
    combinations: { unitId: string; variableId: string }[],
    unitIdFilter?: string,
    variableIdFilter?: string
  ): Promise<Record<string, unknown>[]> {
    const queryBuilder = this.responseRepository.createQueryBuilder('response')
      .select('unit.name', 'unitId')
      .addSelect('response.variableid', 'variableId')
      .addSelect('COUNT(response.id)', 'totalCount')
      .leftJoin('response.unit', 'unit')
      .leftJoin('unit.booklet', 'booklet')
      .leftJoin('booklet.person', 'person')
      .where('person.workspace_id = :workspaceId', { workspaceId });

    if (unitIdFilter) {
      queryBuilder.andWhere('unit.name LIKE :unitId', { unitId: `%${unitIdFilter}%` });
    }

    if (variableIdFilter) {
      queryBuilder.andWhere('response.variableid LIKE :variableId', { variableId: `%${variableIdFilter}%` });
    }

    if (combinations.length > 0) {
      queryBuilder.andWhere(new Brackets(qb => {
        combinations.forEach((combo, index) => {
          qb.orWhere(
            `(unit.name = :unitId${index} AND response.variableid = :variableId${index})`,
            {
              [`unitId${index}`]: combo.unitId,
              [`variableId${index}`]: combo.variableId
            }
          );
        });
      }));
    }

    queryBuilder.groupBy('unit.name')
      .addGroupBy('response.variableid');

    return queryBuilder.getRawMany();
  }

  async getVariableAnalysisSampleInfo(
    workspaceId: number,
    combinations: { unitId: string; variableId: string }[]
  ): Promise<Record<string, unknown>[]> {
    const queryBuilder = this.responseRepository.createQueryBuilder('response')
      .select('unit.name', 'unitId')
      .addSelect('response.variableid', 'variableId')
      .addSelect('person.login', 'loginName')
      .addSelect('person.code', 'loginCode')
      .addSelect('person.group', 'loginGroup')
      .addSelect('bookletinfo.name', 'bookletId')
      .leftJoin('response.unit', 'unit')
      .leftJoin('unit.booklet', 'booklet')
      .leftJoin('booklet.person', 'person')
      .leftJoin('booklet.bookletinfo', 'bookletinfo')
      .where('person.workspace_id = :workspaceId', { workspaceId });

    if (combinations.length > 0) {
      queryBuilder.andWhere(new Brackets(qb => {
        combinations.forEach((combo, index) => {
          qb.orWhere(
            `(unit.name = :unitId${index} AND response.variableid = :variableId${index})`,
            {
              [`unitId${index}`]: combo.unitId,
              [`variableId${index}`]: combo.variableId
            }
          );
        });
      }));
    }

    queryBuilder.groupBy('unit.name')
      .addGroupBy('response.variableid')
      .addGroupBy('person.login')
      .addGroupBy('person.code')
      .addGroupBy('person.group')
      .addGroupBy('bookletinfo.name');

    return queryBuilder.getRawMany();
  }
}
