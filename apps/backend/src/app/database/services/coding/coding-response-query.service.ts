import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { statusStringToNumber } from '../../utils/response-status-converter';
import { ResponseEntity } from '../../entities/response.entity';
import { Unit } from '../../entities/unit.entity';
import { Booklet } from '../../entities/booklet.entity';
import Persons from '../../entities/persons.entity';

@Injectable()
export class CodingResponseQueryService {
  private readonly logger = new Logger(CodingResponseQueryService.name);

  constructor(
    @InjectRepository(ResponseEntity)
    private responseRepository: Repository<ResponseEntity>,
    @InjectRepository(Unit)
    private unitRepository: Repository<Unit>,
    @InjectRepository(Booklet)
    private bookletRepository: Repository<Booklet>,
    @InjectRepository(Persons)
    private personsRepository: Repository<Persons>
  ) { }

  async getResponsesByStatus(
    workspaceId: number,
    status: string,
    version: 'v1' | 'v2' | 'v3' = 'v1',
    page: number = 1,
    limit: number = 100
  ): Promise<{
      data: ResponseEntity[];
      total: number;
      page: number;
      limit: number;
    }> {
    try {
      const statusNumber = statusStringToNumber(status);
      if (statusNumber === null) {
        this.logger.warn(`Invalid status string: ${status}`);
        return {
          data: [],
          total: 0,
          page,
          limit
        };
      }

      const offset = (page - 1) * limit;

      const selectFields = [
        'response.id',
        'response.unitId',
        'response.variableid',
        'response.value',
        'response.status',
        'response.codedstatus'
      ];

      selectFields.push('response.code_v1', 'response.score_v1');
      selectFields.push('response.code_v2', 'response.score_v2');
      selectFields.push('response.code_v3', 'response.score_v3');
      selectFields.push(
        'response.status_v1',
        'response.status_v2',
        'response.status_v3'
      );

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
          queryBuilder.andWhere('response.status_v1 = :status', {
            status: statusNumber
          });
          break;
        case 'v2':
          queryBuilder.andWhere('response.status_v2 = :status', {
            status: statusNumber
          });
          break;
        case 'v3':
          queryBuilder.andWhere('response.status_v3 = :status', {
            status: statusNumber
          });
          break;
        default:
          queryBuilder.andWhere('response.status_v1 = :status', {
            status: statusNumber
          });
          break;
      }

      const total = await queryBuilder.getCount();
      const data = await queryBuilder
        .orderBy('response.id', 'ASC')
        .skip(offset)
        .take(limit)
        .getMany();

      this.logger.log(
        `Retrieved ${data.length} responses with status ${status} for version ${version} in workspace ${workspaceId}`
      );

      return {
        data,
        total,
        page,
        limit
      };
    } catch (error) {
      this.logger.error(
        `Error getting responses by status: ${error.message}`,
        error.stack
      );
      throw new Error(
        'Could not retrieve responses. Please check the database connection or query.'
      );
    }
  }

  async getManualTestPersons(
    workspaceId: number,
    personIds?: string
  ): Promise<Array<ResponseEntity & { unitname: string }>> {
    this.logger.log(
      `Fetching responses for workspaceId = ${workspaceId} ${personIds ? `and personIds = ${personIds}` : ''
      }.`
    );

    try {
      const persons = await this.personsRepository.find({
        where: { workspace_id: workspaceId, consider: true }
      });

      if (!persons.length) {
        this.logger.log(`No persons found for workspace_id = ${workspaceId}.`);
        return [];
      }

      const filteredPersons = personIds ?
        persons.filter(person => personIds.split(',').includes(String(person.id))
        ) :
        persons;

      if (!filteredPersons.length) {
        this.logger.log(
          `No persons match the personIds in workspace_id = ${workspaceId}.`
        );
        return [];
      }

      const personIdsArray = filteredPersons.map(person => person.id);

      const booklets = await this.bookletRepository.find({
        where: { personid: In(personIdsArray) },
        select: ['id']
      });

      const bookletIds = booklets.map(booklet => booklet.id);

      if (!bookletIds.length) {
        this.logger.log(
          `No booklets found for persons = [${personIdsArray.join(
            ', '
          )}] in workspace_id = ${workspaceId}.`
        );
        return [];
      }

      const units = await this.unitRepository.find({
        where: { bookletid: In(bookletIds) },
        select: ['id', 'name']
      });

      const unitIdToNameMap = new Map(
        units.map(unit => [unit.id, unit.name])
      );
      const unitIds = Array.from(unitIdToNameMap.keys());

      if (!unitIds.length) {
        this.logger.log(
          `No units found for booklets = [${bookletIds.join(
            ', '
          )}] in workspace_id = ${workspaceId}.`
        );
        return [];
      }

      const responses = await this.responseRepository.find({
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

      const enrichedResponses = responses.map(response => ({
        ...response,
        unitname: unitIdToNameMap.get(response.unitid) || 'Unknown Unit'
      }));

      this.logger.log(
        `Fetched ${responses.length} responses for the given criteria in workspace_id = ${workspaceId}.`
      );

      return enrichedResponses;
    } catch (error) {
      this.logger.error(
        `Failed to fetch responses: ${error.message}`,
        error.stack
      );
      throw new Error(
        'Could not retrieve responses. Please check the database connection or query.'
      );
    }
  }
}
