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
import { UnitTagService } from './unit-tag.service';

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
    private readonly connection: Connection,
    private readonly unitTagService: UnitTagService
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
      tags: { id: number; unitId: number; tag: string; color?: string; createdAt: Date }[];
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

      const allUnitTags = await Promise.all(
        unitIds.map(unitId => this.unitTagService.findAllByUnitId(unitId))
      );

      const unitTagsMap = new Map<number, { id: number; unitId: number; tag: string; color?: string; createdAt: Date }[]>();
      unitIds.forEach((unitId, index) => {
        unitTagsMap.set(unitId, allUnitTags[index]);
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
              })),
              tags: unitTagsMap.get(unit.id) || []
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

  async findTestResults(workspace_id: number, options: { page: number; limit: number; searchText?: string }): Promise<[Persons[], number]> {
    const { page, limit, searchText } = options;

    if (!workspace_id || workspace_id <= 0) {
      throw new Error('Invalid workspace_id provided');
    }

    const MAX_LIMIT = 500;
    const validPage = Math.max(1, page); // minimum 1
    const validLimit = Math.min(Math.max(1, limit), MAX_LIMIT); // Between 1 and MAX_LIMIT

    try {
      const queryBuilder = this.personsRepository.createQueryBuilder('person')
        .where('person.workspace_id = :workspace_id', { workspace_id })
        .select([
          'person.id',
          'person.group',
          'person.login',
          'person.code',
          'person.uploaded_at'
        ]);

      // Add search condition if searchText is provided
      if (searchText && searchText.trim() !== '') {
        queryBuilder.andWhere(
          '(person.code ILIKE :searchText OR person.group ILIKE :searchText OR person.login ILIKE :searchText)',
          { searchText: `%${searchText.trim()}%` }
        );
      }

      // Add pagination
      queryBuilder
        .skip((validPage - 1) * validLimit)
        .take(validLimit)
        .orderBy('person.code', 'ASC');

      // Execute query
      const [results, total] = await queryBuilder.getManyAndCount();

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
    const [login, code, bookletId] = connector.split('@');
    const person = await this.personsRepository.findOne({
      where: {
        code, login, workspace_id: workspaceId
      }
    });
    if (!person) {
      throw new Error(`Person mit ID ${person.id} wurde nicht gefunden.`);
    }

    const bookletInfo = await this.bookletInfoRepository.findOne({
      where: { name: bookletId }
    });

    if (!bookletInfo) {
      throw new Error(`Kein Booklet mit der ID ${bookletId} gefunden.`);
    }

    const booklet = await this.bookletRepository.findOne({
      where: {
        personid: person.id,
        infoid: bookletInfo.id
      }
    });

    if (!booklet) {
      throw new Error(`Kein Booklet für die Person mit ID ${person.id} und Booklet ID ${bookletId} gefunden.`);
    }

    const booklets = [booklet];
    const unit = await this.unitRepository.findOne({
      where: {
        bookletid: In(booklets.map(b => b.id)),
        alias: unitId
      },
      relations: ['responses']
    });
    const mappedResponses = unit.responses
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
        .leftJoinAndSelect('booklet.bookletinfo', 'bookletinfo')
        .where('response.status = :constStatus', { constStatus: 'VALUE_CHANGED' })
        .andWhere('person.workspace_id = :workspace_id_param', { workspace_id_param: workspace_id })
        .orderBy('response.id', 'ASC');

      if (status === 'null') {
        queryBuilder.andWhere('response.codedStatus IS NULL');
      } else {
        queryBuilder.andWhere('response.codedStatus = :statusParam', { statusParam: status });
      }

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

  /**
   * Delete a unit and all its associated responses
   * @param workspaceId The ID of the workspace
   * @param unitId The ID of the unit to delete
   * @returns A success flag and a report with deleted unit and warnings
   */
  async deleteUnit(
    workspaceId: number,
    unitId: number
  ): Promise<{
      success: boolean;
      report: {
        deletedUnit: number | null;
        warnings: string[];
      };
    }> {
    return this.connection.transaction(async manager => {
      const report = {
        deletedUnit: null,
        warnings: []
      };

      // Check if the unit exists and belongs to the workspace
      const unit = await manager
        .createQueryBuilder(Unit, 'unit')
        .leftJoinAndSelect('unit.booklet', 'booklet')
        .leftJoinAndSelect('booklet.person', 'person')
        .where('unit.id = :unitId', { unitId })
        .andWhere('person.workspace_id = :workspaceId', { workspaceId })
        .getOne();

      if (!unit) {
        const warningMessage = `Keine Unit mit ID ${unitId} im Workspace ${workspaceId} gefunden`;
        this.logger.warn(warningMessage);
        report.warnings.push(warningMessage);
        return { success: false, report };
      }

      // Delete the unit (cascade will delete associated responses)
      await manager
        .createQueryBuilder()
        .delete()
        .from(Unit)
        .where('id = :unitId', { unitId })
        .execute();

      report.deletedUnit = unitId;

      return { success: true, report };
    });
  }

  /**
   * Delete a response
   * @param workspaceId The ID of the workspace
   * @param responseId The ID of the response to delete
   * @returns A success flag and a report with deleted response and warnings
   */
  async deleteResponse(
    workspaceId: number,
    responseId: number
  ): Promise<{
      success: boolean;
      report: {
        deletedResponse: number | null;
        warnings: string[];
      };
    }> {
    return this.connection.transaction(async manager => {
      const report = {
        deletedResponse: null,
        warnings: []
      };

      // Check if the response exists and belongs to the workspace
      const response = await manager
        .createQueryBuilder(ResponseEntity, 'response')
        .leftJoinAndSelect('response.unit', 'unit')
        .leftJoinAndSelect('unit.booklet', 'booklet')
        .leftJoinAndSelect('booklet.person', 'person')
        .where('response.id = :responseId', { responseId })
        .andWhere('person.workspace_id = :workspaceId', { workspaceId })
        .getOne();

      if (!response) {
        const warningMessage = `Keine Antwort mit ID ${responseId} im Workspace ${workspaceId} gefunden`;
        this.logger.warn(warningMessage);
        report.warnings.push(warningMessage);
        return { success: false, report };
      }

      // Delete the response
      await manager
        .createQueryBuilder()
        .delete()
        .from(ResponseEntity)
        .where('id = :responseId', { responseId })
        .execute();

      report.deletedResponse = responseId;

      return { success: true, report };
    });
  }

  /**
   * Delete a booklet and all its associated units and responses
   * @param workspaceId The ID of the workspace
   * @param bookletId The ID of the booklet to delete
   * @returns A success flag and a report with deleted booklet and warnings
   */
  async deleteBooklet(
    workspaceId: number,
    bookletId: number
  ): Promise<{
      success: boolean;
      report: {
        deletedBooklet: number | null;
        warnings: string[];
      };
    }> {
    return this.connection.transaction(async manager => {
      const report = {
        deletedBooklet: null,
        warnings: []
      };

      // Check if the booklet exists and belongs to the workspace
      const booklet = await manager
        .createQueryBuilder(Booklet, 'booklet')
        .leftJoinAndSelect('booklet.person', 'person')
        .where('booklet.id = :bookletId', { bookletId })
        .andWhere('person.workspace_id = :workspaceId', { workspaceId })
        .getOne();

      if (!booklet) {
        const warningMessage = `Kein Booklet mit ID ${bookletId} im Workspace ${workspaceId} gefunden`;
        this.logger.warn(warningMessage);
        report.warnings.push(warningMessage);
        return { success: false, report };
      }

      // Delete the booklet (cascade will delete associated units and responses)
      await manager
        .createQueryBuilder()
        .delete()
        .from(Booklet)
        .where('id = :bookletId', { bookletId })
        .execute();

      report.deletedBooklet = bookletId;

      return { success: true, report };
    });
  }

  /**
   * Search for responses across all test persons in a workspace
   * @param workspaceId The ID of the workspace
   * @param searchParams Search parameters (value, variableId, unitName)
   * @param options Pagination options
   * @returns An array of responses matching the search criteria and total count
   */
  async searchResponses(
    workspaceId: number,
    searchParams: { value?: string; variableId?: string; unitName?: string; status?: string; codedStatus?: string; group?: string; code?: string },
    options: { page?: number; limit?: number } = {}
  ): Promise<{
      data: {
        responseId: number;
        variableId: string;
        value: string;
        status: string;
        code?: number;
        score?: number;
        codedStatus?: string;
        unitId: number;
        unitName: string;
        unitAlias: string | null;
        bookletId: number;
        bookletName: string;
        personId: number;
        personLogin: string;
        personCode: string;
        personGroup: string;
      }[];
      total: number;
    }> {
    if (!workspaceId) {
      throw new Error('workspaceId is required.');
    }

    const page = options.page || 1;
    const limit = options.limit || 10;
    const skip = (page - 1) * limit;

    try {
      this.logger.log(
        `Searching for responses in workspace: ${workspaceId} with params: ${JSON.stringify(searchParams)} (page: ${page}, limit: ${limit})`
      );

      // Create a query to find responses matching the search criteria
      const query = this.responseRepository.createQueryBuilder('response')
        .innerJoinAndSelect('response.unit', 'unit')
        .innerJoinAndSelect('unit.booklet', 'booklet')
        .innerJoinAndSelect('booklet.person', 'person')
        .innerJoinAndSelect('booklet.bookletinfo', 'bookletinfo')
        .where('person.workspace_id = :workspaceId', { workspaceId });

      // Add search conditions based on provided parameters
      if (searchParams.value) {
        query.andWhere('response.value ILIKE :value', { value: `%${searchParams.value}%` });
      }

      if (searchParams.variableId) {
        query.andWhere('response.variableid ILIKE :variableId', { variableId: `%${searchParams.variableId}%` });
      }

      if (searchParams.unitName) {
        query.andWhere('unit.name ILIKE :unitName', { unitName: `%${searchParams.unitName}%` });
      }

      if (searchParams.status) {
        query.andWhere('response.status = :status', { status: searchParams.status });
      }

      if (searchParams.codedStatus) {
        query.andWhere('response.codedstatus = :codedStatus', { codedStatus: searchParams.codedStatus });
      }

      if (searchParams.group) {
        query.andWhere('person.group = :group', { group: searchParams.group });
      }

      if (searchParams.code) {
        query.andWhere('person.code = :code', { code: searchParams.code });
      }

      // Get total count
      const total = await query.getCount();

      if (total === 0) {
        this.logger.log(`No responses found matching the criteria in workspace: ${workspaceId}`);
        return { data: [], total: 0 };
      }

      // Apply pagination
      query.skip(skip).take(limit);

      const responses = await query.getMany();

      this.logger.log(`Found ${total} responses matching the criteria in workspace: ${workspaceId}, returning ${responses.length} for page ${page}`);

      // Map the results to the desired format
      const data = responses.map(response => ({
        responseId: response.id,
        variableId: response.variableid,
        value: response.value || '',
        status: response.status,
        code: response.code,
        score: response.score,
        codedStatus: response.codedstatus,
        unitId: response.unit.id,
        unitName: response.unit.name,
        unitAlias: response.unit.alias,
        bookletId: response.unit.booklet.id,
        bookletName: response.unit.booklet.bookletinfo.name,
        personId: response.unit.booklet.person.id,
        personLogin: response.unit.booklet.person.login,
        personCode: response.unit.booklet.person.code,
        personGroup: response.unit.booklet.person.group
      }));

      return { data, total };
    } catch (error) {
      this.logger.error(
        `Failed to search for responses in workspace: ${workspaceId}`,
        error.stack
      );
      throw new Error(`An error occurred while searching for responses: ${error.message}`);
    }
  }

  /**
   * Find units by name across all test persons in a workspace
   * @param workspaceId The ID of the workspace
   * @param unitName The name of the unit to search for
   * @param options Pagination options
   * @returns An array of units with the same name across different test persons and total count
   */
  async findUnitsByName(
    workspaceId: number,
    unitName: string,
    options: { page?: number; limit?: number } = {}
  ): Promise<{
      data: {
        unitId: number;
        unitName: string;
        unitAlias: string | null;
        bookletId: number;
        bookletName: string;
        personId: number;
        personLogin: string;
        personCode: string;
        personGroup: string;
        tags: { id: number; unitId: number; tag: string; color?: string; createdAt: Date }[];
        responses: { variableId: string; value: string; status: string; code?: number; score?: number; codedStatus?: string }[];
      }[];
      total: number;
    }> {
    if (!workspaceId || !unitName) {
      throw new Error('Both workspaceId and unitName are required.');
    }

    const page = options.page || 1;
    const limit = options.limit || 10;
    const skip = (page - 1) * limit;

    try {
      this.logger.log(
        `Searching for units with name: ${unitName} in workspace: ${workspaceId} (page: ${page}, limit: ${limit})`
      );

      // Create a query to find all units with the given name
      const query = this.unitRepository.createQueryBuilder('unit')
        .innerJoinAndSelect('unit.booklet', 'booklet')
        .innerJoinAndSelect('booklet.person', 'person')
        .innerJoinAndSelect('booklet.bookletinfo', 'bookletinfo')
        .leftJoinAndSelect('unit.responses', 'response')
        .where('unit.name = :unitName', { unitName })
        .andWhere('person.workspace_id = :workspaceId', { workspaceId });

      // Get total count
      const total = await query.getCount();

      if (total === 0) {
        this.logger.log(`No units found with name: ${unitName} in workspace: ${workspaceId}`);
        return { data: [], total: 0 };
      }

      // Apply pagination
      query.skip(skip).take(limit);

      const units = await query.getMany();

      this.logger.log(`Found ${total} units with name: ${unitName} in workspace: ${workspaceId}, returning ${units.length} for page ${page}`);

      // Get tags for all units
      const unitIds = units.map(unit => unit.id);
      const allUnitTags = await Promise.all(
        unitIds.map(unitId => this.unitTagService.findAllByUnitId(unitId))
      );

      // Create a map of unit ID to tags
      const unitTagsMap = new Map<number, { id: number; unitId: number; tag: string; color?: string; createdAt: Date }[]>();
      unitIds.forEach((unitId, index) => {
        unitTagsMap.set(unitId, allUnitTags[index]);
      });

      // Map the results to the desired format
      const data = units.map(unit => ({
        unitId: unit.id,
        unitName: unit.name,
        unitAlias: unit.alias,
        bookletId: unit.booklet.id,
        bookletName: unit.booklet.bookletinfo.name,
        personId: unit.booklet.person.id,
        personLogin: unit.booklet.person.login,
        personCode: unit.booklet.person.code,
        personGroup: unit.booklet.person.group,
        tags: unitTagsMap.get(unit.id) || [],
        responses: unit.responses ? unit.responses.map(response => ({
          variableId: response.variableid,
          value: response.value || '',
          status: response.status,
          code: response.code,
          score: response.score,
          codedStatus: response.codedstatus
        })) : []
      }));

      return { data, total };
    } catch (error) {
      this.logger.error(
        `Failed to search for units with name: ${unitName} in workspace: ${workspaceId}`,
        error.stack
      );
      throw new Error(`An error occurred while searching for units with name: ${unitName}: ${error.message}`);
    }
  }
}
