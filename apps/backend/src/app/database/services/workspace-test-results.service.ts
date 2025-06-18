import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Connection, In, Repository } from 'typeorm';
import Persons from '../entities/persons.entity';
import { Unit } from '../entities/unit.entity';
import { Booklet } from '../entities/booklet.entity';
import { ResponseEntity } from '../entities/response.entity';
import { BookletInfo } from '../entities/bookletInfo.entity';
import { BookletLog } from '../entities/bookletLog.entity';
import { UnitLog } from '../entities/unitLog.entity';
import { Session } from '../entities/session.entity';

@Injectable()
export class WorkspaceTestResultsService {
  private readonly logger = new Logger(WorkspaceTestResultsService.name);

  constructor(
    @InjectRepository(Persons)
    private personsRepository: Repository<Persons>,
    @InjectRepository(Unit)
    private unitRepository: Repository<Unit>,
    @InjectRepository(Booklet)
    private bookletRepository: Repository<Booklet>,
    @InjectRepository(ResponseEntity)
    private responseRepository: Repository<ResponseEntity>,
    @InjectRepository(BookletInfo)
    private bookletInfoRepository: Repository<BookletInfo>,
    @InjectRepository(BookletLog)
    private bookletLogRepository: Repository<BookletLog>,
    @InjectRepository(UnitLog)
    private unitLogRepository: Repository<UnitLog>,
    @InjectRepository(Session)
    private sessionRepository: Repository<Session>,
    private readonly connection: Connection
  ) {}

  async findPersonTestResults(personId: number, workspaceId: number): Promise<{
    id: number;
    personid: number;
    name: string;
    size: number;
    logs: { id: number; bookletid: number; ts: string; parameter: string, key: string }[];
    sessions: { id: number; browser: string; os: string; screen: string; ts: string }[];
    units: {
      id: number;
      bookletid: number;
      name: string;
      alias: string | null;
      results: { id: number; unitid: number }[];
      logs: { id: number; unitid: number; ts: string; key: string; parameter: string }[];
    }[];
  }[]> {
    if (!personId || !workspaceId) {
      throw new Error('Both personId and workspaceId are required.');
    }

    try {
      this.logger.log(
        `Fetching booklets, bookletInfo data, units, and test results for personId: ${personId} and workspaceId: ${workspaceId}`
      );

      const booklets = await this.bookletRepository.find({
        where: { personid: personId },
        select: ['id', 'personid', 'infoid']
      });
      if (!booklets || booklets.length === 0) {
        this.logger.log(`No booklets found for personId: ${personId}`);
        return [];
      }

      const bookletIds = booklets.map(booklet => booklet.id);
      const bookletInfoIds = booklets.map(booklet => booklet.infoid);
      const bookletInfoData = await this.bookletInfoRepository.find({
        where: { id: In(bookletInfoIds) },
        select: ['id', 'name', 'size']
      });

      const units = await this.unitRepository.find({
        where: { bookletid: In(bookletIds) },
        select: ['id', 'name', 'alias', 'bookletid']
      });

      const unitIds = units.map(unit => unit.id);

      const responses = await this.responseRepository.find({
        where: { unitid: In(unitIds) }
      });

      const uniqueResponses = Array.from(
        new Map(responses.map(response => [response.id, response])).values()
      );

      const unitResultMap = new Map<number, { id: number; unitid: number }[]>();
      for (const response of uniqueResponses) {
        if (!unitResultMap.has(response.unitid)) {
          unitResultMap.set(response.unitid, []);
        }
        unitResultMap.get(response.unitid)?.push(response);
      }

      const bookletLogs = await this.bookletLogRepository.find({
        where: { bookletid: In(bookletIds) },
        select: ['id', 'bookletid', 'ts', 'parameter', 'key']
      });

      const sessions = await this.sessionRepository.find({
        where: { booklet: { id: In(bookletIds) } },
        relations: ['booklet'],
        select: ['id', 'browser', 'os', 'screen', 'ts']
      });

      const unitLogs = await this.unitLogRepository.find({
        where: { unitid: In(unitIds) },
        select: ['id', 'unitid', 'ts', 'key', 'parameter']
      });

      return booklets.map(booklet => {
        const bookletInfo = bookletInfoData.find(info => info.id === booklet.infoid);
        return {
          id: booklet.id,
          personid: booklet.personid,
          name: bookletInfo.name,
          size: bookletInfo.size,
          logs: bookletLogs.filter(log => log.bookletid === booklet.id).map(log => ({
            id: log.id,
            bookletid: log.bookletid,
            ts: log.ts.toString(),
            key: log.key,
            parameter: log.parameter
          })),
          sessions: sessions.filter(session => session.booklet?.id === booklet.id).map(session => ({
            id: session.id,
            browser: session.browser,
            os: session.os,
            screen: session.screen,
            ts: session.ts?.toString()
          })),
          units: units
            .filter(unit => unit.bookletid === booklet.id)
            .map(unit => ({
              id: unit.id,
              bookletid: unit.bookletid,
              name: unit.name,
              alias: unit.alias,
              results: unitResultMap.get(unit.id) || [],
              logs: unitLogs.filter(log => log.unitid === unit.id).map(log => ({
                id: log.id,
                unitid: log.unitid,
                ts: log.ts.toString(),
                key: log.key,
                parameter: log.parameter
              }))
            }))
        };
      });
    } catch (error) {
      this.logger.error(
        `Failed to fetch booklets, bookletInfo, units, and results for personId: ${personId} and workspaceId: ${workspaceId}`,
        error.stack
      );
      throw new Error('An error occurred while fetching booklets, their info, units, and test results.');
    }
  }

  async findTestResults(workspace_id: number, options: { page: number; limit: number }): Promise<[Persons[], number]> {
    const { page, limit } = options;

    if (!workspace_id || workspace_id <= 0) {
      throw new Error('Invalid workspace_id provided');
    }

    const MAX_LIMIT = 500;
    const validPage = Math.max(1, page); // minimum 1
    const validLimit = Math.min(Math.max(1, limit), MAX_LIMIT); // Between 1 and MAX_LIMIT

    try {
      const personIdsQuery = this.personsRepository.createQueryBuilder('person')
        .select('person.id')
        .innerJoin('person.booklets_relation', 'booklet')
        .innerJoin('booklet.units', 'unit')
        .innerJoin('unit.responses', 'response')
        .where('person.workspace_id = :workspace_id', { workspace_id })
        .distinct(true);

      const personIds = (await personIdsQuery.getRawMany()).map(p => p.person_id);

      if (personIds.length === 0) {
        return [[], 0];
      }

      const [results, total] = await this.personsRepository.findAndCount({
        where: { id: In(personIds) },
        select: [
          'id',
          'group',
          'login',
          'code',
          'uploaded_at'
        ],
        skip: (validPage - 1) * validLimit,
        take: validLimit,
        order: { code: 'ASC' }
      });
      return [results, total];
    } catch (error) {
      this.logger.error(`Failed to fetch test results for workspace_id ${workspace_id}: ${error.message}`, error.stack);
      throw new Error('An error occurred while fetching test results');
    }
  }

  async findWorkspaceResponses(workspace_id: number, options?: { page: number; limit: number }): Promise<[ResponseEntity[], number]> {
    this.logger.log('Returning responses for workspace', workspace_id);

    if (options) {
      const { page, limit } = options;
      const MAX_LIMIT = 500;
      const validPage = Math.max(1, page);
      const validLimit = Math.min(Math.max(1, limit), MAX_LIMIT);

      const [responses, total] = await this.responseRepository.findAndCount({
        skip: (validPage - 1) * validLimit,
        take: validLimit,
        order: { id: 'ASC' }
      });

      this.logger.log(`Found ${responses.length} responses (page ${validPage}, limit ${validLimit}, total ${total}) for workspace ${workspace_id}`);
      return [responses, total];
    }

    const responses = await this.responseRepository.find({
      order: { id: 'ASC' }
    });

    this.logger.log(`Found ${responses.length} responses for workspace ${workspace_id}`);
    return [responses, responses.length];
  }

  async findUnitResponse(workspaceId: number, connector: string, unitId: string): Promise<{ responses: { id: string, content: { id: string; value: string; status: string }[] }[] }> {
    const [login, code, group] = connector.split('@');
    const person = await this.personsRepository.findOne({
      where: {
        code, login, group, workspace_id: workspaceId
      }
    });
    if (!person) {
      throw new Error(`Person mit ID ${person.id} wurde nicht gefunden.`);
    }

    const booklets = await this.bookletRepository.find({
      where: { personid: person.id }
    });

    if (!booklets || booklets.length === 0) {
      throw new Error(`Keine Booklets für die Person mit ID ${person.id} gefunden.`);
    }
    const unit = await this.unitRepository.findOne({
      where: {
        bookletid: In(booklets.map(booklet => booklet.id)),
        alias: unitId
      },
      relations: ['responses']
    });
    const mappedResponses = unit.responses// Filter für subform = 'elementCodes'
      .filter(response => response.subform === 'elementCodes')
      .map(response => ({
        id: response.variableid,
        value: response.value,
        status: response.status
      }));

    const uniqueResponses = mappedResponses.filter(
      (response, index, self) => index === self.findIndex(r => r.id === response.id)
    );
    return {
      responses: [{
        id: 'elementCodes',
        content: uniqueResponses
      }]
    };
  }

  async getResponsesByStatus(workspace_id: number, status: string, options?: { page: number; limit: number }): Promise<[ResponseEntity[], number]> {
    this.logger.log(`Getting responses with status ${status} for workspace ${workspace_id}`);
    try {
      const queryBuilder = this.responseRepository.createQueryBuilder('response')
        .leftJoinAndSelect('response.unit', 'unit')
        .leftJoinAndSelect('unit.booklet', 'booklet')
        .leftJoinAndSelect('booklet.person', 'person')
        .leftJoinAndSelect('booklet.bookletinfo', 'bookletinfo') // Diese Relation wird geladen, wie im Originalcode
        .where('response.status = :constStatus', { constStatus: 'VALUE_CHANGED' })
        .andWhere('response.codedStatus = :statusParam', { statusParam: status })
        .andWhere('person.workspace_id = :workspace_id_param', { workspace_id_param: workspace_id })
        .orderBy('response.id', 'ASC');

      if (options) {
        const { page, limit } = options;
        const MAX_LIMIT = 500;
        const validPage = Math.max(1, page); // minimum 1
        const validLimit = Math.min(Math.max(1, limit), MAX_LIMIT); // Between 1 and MAX_LIMIT

        queryBuilder
          .skip((validPage - 1) * validLimit)
          .take(validLimit);

        const [responses, total] = await queryBuilder.getManyAndCount();
        this.logger.log(`Found ${responses.length} responses with status ${status} (page ${validPage}, limit ${validLimit}, total ${total}) for workspace ${workspace_id}`);
        return [responses, total];
      }

      const responses = await queryBuilder.getMany();
      const total = await queryBuilder.getCount();
      this.logger.log(`Found ${responses.length} responses with status ${status} for workspace ${workspace_id}`);
      return [responses, total];
    } catch (error) {
      this.logger.error(`Error getting responses by status: ${error.message}`);
      return [[], 0];
    }
  }

  async deleteTestPersons(
    workspaceId: number,
    testPersonIds: string
  ): Promise<{
      success: boolean;
      report: {
        deletedPersons: string[];
        warnings: string[];
      };
    }> {
    return this.connection.transaction(async manager => {
      const ids = testPersonIds.split(',').map(id => id.trim());
      const report = {
        deletedPersons: [],
        warnings: []
      };

      const existingPersons = await manager
        .createQueryBuilder(Persons, 'persons')
        .select('persons.id')
        .where('persons.id IN (:...ids)', { ids })
        .getMany();

      if (!existingPersons.length) {
        const warningMessage = `Keine Personen gefunden für die angegebenen IDs: ${testPersonIds}`;
        this.logger.warn(warningMessage);
        report.warnings.push(warningMessage);
        return { success: false, report };
      }

      const existingIds = existingPersons.map(person => person.id);

      await manager
        .createQueryBuilder()
        .delete()
        .from(Persons)
        .where('id IN (:...ids)', { ids: existingIds })
        .execute();

      report.deletedPersons = existingIds;

      return { success: true, report };
    });
  }
}
