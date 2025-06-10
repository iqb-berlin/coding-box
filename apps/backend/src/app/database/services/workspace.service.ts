/* eslint-disable guard-for-in, no-return-assign, consistent-return */
import * as Autocoder from '@iqb/responses';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Connection, In, Repository } from 'typeorm';
import Ajv, { JSONSchemaType } from 'ajv';
import * as cheerio from 'cheerio';
import AdmZip = require('adm-zip');
import * as util from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as libxmljs from 'libxmljs2';
import { ResponseStatusType } from '@iqb/responses';
import Workspace from '../entities/workspace.entity';
import { WorkspaceInListDto } from '../../../../../../api-dto/workspaces/workspace-in-list-dto';
import { WorkspaceFullDto } from '../../../../../../api-dto/workspaces/workspace-full-dto';
import { CreateWorkspaceDto } from '../../../../../../api-dto/workspaces/create-workspace-dto';
import { AdminWorkspaceNotFoundException } from '../../exceptions/admin-workspace-not-found.exception';
import FileUpload from '../entities/file_upload.entity';
import { FilesDto } from '../../../../../../api-dto/files/files.dto';
import Responses from '../entities/responses.entity';
import WorkspaceUser from '../entities/workspace_user.entity';
import { FileIo } from '../../admin/workspace/file-io.interface';
import ResourcePackage from '../entities/resource-package.entity';
import User from '../entities/user.entity';
import { TestGroupsInListDto } from '../../../../../../api-dto/test-groups/testgroups-in-list.dto';
import { ResponseDto } from '../../../../../../api-dto/responses/response-dto';
import { FileValidationResultDto } from '../../../../../../api-dto/files/file-validation-result.dto';
// eslint-disable-next-line import/no-cycle
import Persons from '../entities/persons.entity';
import { Unit } from '../entities/unit.entity';
import { Booklet } from '../entities/booklet.entity';
import { ResponseEntity } from '../entities/response.entity';
import { BookletInfo } from '../entities/bookletInfo.entity';
import { FileDownloadDto } from '../../../../../../api-dto/files/file-download.dto';
import { BookletLog } from '../entities/bookletLog.entity';
import { UnitLog } from '../entities/unitLog.entity';
import { Session } from '../entities/session.entity';

export interface CodingStatistics {
  totalResponses: number;
  statusCounts: {
    [key: string]: number;
  };
}

function sanitizePath(filePath: string): string {
  const normalizedPath = path.normalize(filePath); // System-basiertes Normalisieren
  if (normalizedPath.startsWith('..')) {
    throw new Error('Invalid file path: Path cannot navigate outside root.');
  }
  return normalizedPath.replace(/\\/g, '/'); // Einheitliche Darstellung für Pfade
}

export type Response = {
  groupname:string,
  loginname : string,
  code : string,
  bookletname : string,
  unitname : string,
  originalUnitId: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  responses : any,
  laststate : string,

};

export type Log = {
  groupname:string,
  loginname : string,
  code : string,
  bookletname : string,
  unitname : string,
  originalUnitId:string,
  timestamp : string,
  logentry : string,
};

export type File = {
  filename: string,
  file_id: string,
  file_type: string,
  file_size: number,
  workspace_id: string,
  data: string
};

export type Person = {
  workspace_id: number,
  group: string,
  login: string,
  code: string,
  booklets: TcMergeBooklet[],
};

export type TcMergeBooklet = {
  id:string,
  logs: TcMergeLog[],
  units: TcMergeUnit[],
  sessions: TcMergeSession[]
};

export type TcMergeLog = {
  ts:string,
  key:string,
  parameter:string
};

export type TcMergeSession = {
  browser:string,
  os:string,
  screen:string,
  ts:string,
  loadCompleteMS:number,
};

export type TcMergeUnit = {
  id:string,
  alias:string,
  laststate: TcMergeLastState[],
  subforms:TcMergeSubForms[],
  chunks:TcMergeChunk[],
  logs:TcMergeLog[],
};

export type TcMergeChunk = {
  id:string,
  type:string,
  ts:number,
  variables:string[]
};

export type Chunk = {
  id:string,
  content:string,
  ts:number,
  responseType:string
};

export type TcMergeSubForms = {
  id:string,
  responses: TcMergeResponse[],
};

export type TcMergeResponse = {
  id:string,
  status:string,
  value:string,
  subform?:string,
  code?:string,
  score?:string,
};

export type TcMergeLastState = {
  key:string,
  value:string,
};

type FileStatus = {
  filename: string;
  exists: boolean;
};

type DataValidation = {
  complete: boolean;
  missing: string[];
  files: FileStatus[];
};

type ValidationData = {
  testTaker: string;
  booklets: DataValidation;
  units: DataValidation;
  schemes: DataValidation;
  definitions: DataValidation;
  player: DataValidation;
};

export type ValidationResult = {
  allUnitsExist: boolean;
  missingUnits: string[];
  unitFiles: FileStatus[];
  allCodingSchemesExist: boolean;
  allCodingDefinitionsExist: boolean;
  missingCodingSchemeRefs: string[];
  missingDefinitionRefs: string[];
  schemeFiles: FileStatus[];
  definitionFiles: FileStatus[];
  allPlayerRefsExist: boolean;
  missingPlayerRefs: string[];
  playerFiles: FileStatus[];
};

@Injectable()
export class WorkspaceService {
  private readonly logger = new Logger(WorkspaceService.name);

  constructor(
    @InjectRepository(Workspace)
    private workspaceRepository: Repository<Workspace>,
    @InjectRepository(FileUpload)
    private fileUploadRepository: Repository<FileUpload>,
    @InjectRepository(Responses)
    private responsesRepository:Repository<Responses>,
    @InjectRepository(WorkspaceUser)
    private workspaceUsersRepository:Repository<WorkspaceUser>,
    @InjectRepository(ResourcePackage)
    private resourcePackageRepository:Repository<ResourcePackage>,
    @InjectRepository(User)
    private usersRepository:Repository<User>,
    @InjectRepository(Persons)
    private personsRepository:Repository<Persons>,
    @InjectRepository(Unit)
    private unitRepository:Repository<Unit>,
    @InjectRepository(Booklet)
    private bookletRepository:Repository<Booklet>,
    @InjectRepository(ResponseEntity)
    private responseRepository:Repository<ResponseEntity>,
    @InjectRepository(BookletInfo)
    private bookletInfoRepository:Repository<BookletInfo>,
    @InjectRepository(BookletLog)
    private bookletLogRepository:Repository<BookletLog>,
    @InjectRepository(UnitLog)
    private unitLogRepository:Repository<UnitLog>,
    @InjectRepository(Session)
    private sessionRepository:Repository<Session>,
    private readonly connection: Connection

  ) {
  }

  async findAll(options?: { page: number; limit: number }): Promise<[WorkspaceInListDto[], number]> {
    this.logger.log('Fetching all workspaces from the repository.');

    if (options) {
      const { page, limit } = options;
      const MAX_LIMIT = 10000;
      const validPage = Math.max(1, page);
      const validLimit = Math.min(Math.max(1, limit), MAX_LIMIT);
      const [workspaces, total] = await this.workspaceRepository.findAndCount({
        select: ['id', 'name'],
        skip: (validPage - 1) * validLimit,
        take: validLimit
      });

      this.logger.log(`Found ${workspaces.length} workspaces (page ${validPage}, limit ${validLimit}, total ${total}).`);
      return [workspaces.map(({ id, name }) => ({ id, name })), total];
    }

    const workspaces = await this.workspaceRepository.find({
      select: ['id', 'name']
    });
    this.logger.log(`Found ${workspaces.length} workspaces.`);
    return [workspaces.map(({ id, name }) => ({ id, name })), workspaces.length];
  }

  async findAllUserWorkspaces(identity: string): Promise<WorkspaceFullDto[]> {
    this.logger.log('Returning all workspaces for user', identity);
    const user = await this.usersRepository.findOne({ where: { identity: identity } });
    const workspaces = await this.workspaceUsersRepository.find({
      where: { userId: user.id }
    });
    if (workspaces.length > 0) {
      const mappedWorkspaces = workspaces.map(workspace => ({ id: workspace.workspaceId }));
      return this.workspaceRepository.find({ where: mappedWorkspaces });
    }
    return [];
  }

  async setWorkspaceUsers(workspaceId: number, userIds: number[]): Promise<boolean> {
    this.logger.log(`Setting users for workspace with id: ${workspaceId}`);
    const entries = userIds.map(user => ({ userId: user, workspaceId: workspaceId }));
    const hasRights = this.workspaceUsersRepository.find({ where: { workspaceId: workspaceId } });
    if (hasRights) {
      await this.workspaceUsersRepository.delete({ workspaceId: workspaceId });
    }
    const saved = await this.workspaceUsersRepository.save(entries);
    return !!saved;
  }

  async findFiles(workspaceId: number, options?: { page: number; limit: number }): Promise<[FilesDto[], number]> {
    this.logger.log(`Fetching test files for workspace: ${workspaceId}`);

    if (options) {
      const { page, limit } = options;
      const MAX_LIMIT = 10000;
      const validPage = Math.max(1, page);
      const validLimit = Math.min(Math.max(1, limit), MAX_LIMIT);

      const [files, total] = await this.fileUploadRepository.findAndCount({
        where: { workspace_id: workspaceId },
        select: ['id', 'filename', 'file_id', 'file_size', 'file_type', 'created_at'],
        skip: (validPage - 1) * validLimit,
        take: validLimit,
        order: { created_at: 'DESC' }
      });

      this.logger.log(`Found ${files.length} files (page ${validPage}, limit ${validLimit}, total ${total}).`);
      return [files, total];
    }

    const files = await this.fileUploadRepository.find({
      where: { workspace_id: workspaceId },
      select: ['id', 'filename', 'file_id', 'file_size', 'file_type', 'created_at'],
      order: { created_at: 'DESC' }
    });

    this.logger.log(`Found ${files.length} files.`);
    return [files, files.length];
  }

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
      const [results, total] = await this.personsRepository.findAndCount({
        where: { workspace_id: workspace_id },
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

  async findUsers(workspaceId: number, options?: { page: number; limit: number }): Promise<[WorkspaceUser[], number]> {
    this.logger.log(`Retrieving users for workspace ID: ${workspaceId}`);

    try {
      if (options) {
        const { page, limit } = options;
        const MAX_LIMIT = 500;
        const validPage = Math.max(1, page); // minimum 1
        const validLimit = Math.min(Math.max(1, limit), MAX_LIMIT); // Between 1 and MAX_LIMIT

        const [users, total] = await this.workspaceUsersRepository.findAndCount({
          where: { workspaceId },
          skip: (validPage - 1) * validLimit,
          take: validLimit,
          order: { userId: 'ASC' }
        });

        this.logger.log(`Found ${users.length} user(s) (page ${validPage}, limit ${validLimit}, total ${total}) for workspace ID: ${workspaceId}`);
        return [users, total];
      }

      const users = await this.workspaceUsersRepository.find({
        where: { workspaceId },
        order: { userId: 'ASC' }
      });

      this.logger.log(`Found ${users.length} user(s) for workspace ID: ${workspaceId}`);
      return [users, users.length];
    } catch (error) {
      this.logger.error(`Failed to retrieve users for workspace ID: ${workspaceId}`, error.stack);
      throw new Error('Could not retrieve workspace users');
    }
  }

  async deleteTestFiles(workspace_id:number, fileIds: string[]): Promise<boolean> {
    this.logger.log(`Delete test files for workspace ${workspace_id}`);
    const res = await this.fileUploadRepository.delete(fileIds);
    return !!res;
  }

  async codeTestPersons(workspace_id: number, testPersonIds: string): Promise<CodingStatistics> {
    const ids = testPersonIds.split(',');
    this.logger.log(`Verarbeite Personen ${testPersonIds} für Workspace ${workspace_id}`);

    const statistics: CodingStatistics = {
      totalResponses: 0,
      statusCounts: {}
    };

    try {
      const persons = await this.personsRepository.find({
        where: { workspace_id, id: In(ids) }, select: ['id', 'group', 'login', 'code', 'uploaded_at']
      });

      if (!persons || persons.length === 0) {
        this.logger.warn('Keine Personen gefunden mit den angegebenen IDs.');
        return statistics;
      }

      const personIds = persons.map(person => person.id);

      const booklets = await this.bookletRepository.find({
        where: { personid: In(personIds) }
      });

      if (!booklets || booklets.length === 0) {
        this.logger.log('Keine Booklets für die angegebenen Personen gefunden.');
        return statistics;
      }

      const bookletIds = booklets.map(booklet => booklet.id);

      const units = await this.unitRepository.find({
        where: { bookletid: In(bookletIds) }
      });

      if (!units || units.length === 0) {
        this.logger.log('Keine Einheiten für die angegebenen Booklets gefunden.');
        return statistics;
      }

      const bookletToUnitsMap = new Map();
      units.forEach(unit => {
        if (!bookletToUnitsMap.has(unit.bookletid)) {
          bookletToUnitsMap.set(unit.bookletid, []);
        }
        bookletToUnitsMap.get(unit.bookletid).push(unit);
      });

      const unitIds = units.map(unit => unit.id);
      const unitAliases = units.map(unit => unit.alias.toUpperCase());

      const allResponses = await this.responseRepository.find({
        where: { unitid: In(unitIds), status: In(['VALUE_CHANGED']) }
      });

      const unitToResponsesMap = new Map();
      allResponses.forEach(response => {
        if (!unitToResponsesMap.has(response.unitid)) {
          unitToResponsesMap.set(response.unitid, []);
        }
        unitToResponsesMap.get(response.unitid).push(response);
      });
      const testFiles = await this.fileUploadRepository.find({
        where: { workspace_id: workspace_id, file_id: In(unitAliases) }
      });

      const fileIdToTestFileMap = new Map();
      testFiles.forEach(file => {
        fileIdToTestFileMap.set(file.file_id, file);
      });

      const codingSchemeRefs = new Set<string>();
      const unitToCodingSchemeRefMap = new Map();
      for (const unit of units) {
        const testFile = fileIdToTestFileMap.get(unit.alias.toUpperCase());
        if (!testFile) continue;

        try {
          const $ = cheerio.load(testFile.data);
          const codingSchemeRefText = $('codingSchemeRef').text();
          if (codingSchemeRefText) {
            codingSchemeRefs.add(codingSchemeRefText.toUpperCase());
            unitToCodingSchemeRefMap.set(unit.id, codingSchemeRefText.toUpperCase());
          }
        } catch (error) {
          this.logger.error(`--- Fehler beim Verarbeiten der Datei ${testFile.filename}: ${error.message}`);
        }
      }
      const codingSchemeFiles = await this.fileUploadRepository.find({
        where: { file_id: In([...codingSchemeRefs]) },
        select: ['file_id', 'data', 'filename']
      });

      const fileIdToCodingSchemeMap = new Map();
      codingSchemeFiles.forEach(file => {
        try {
          const scheme = new Autocoder.CodingScheme(JSON.parse(JSON.stringify(file.data)));
          fileIdToCodingSchemeMap.set(file.file_id, scheme);
        } catch (error) {
          this.logger.error(`--- Fehler beim Verarbeiten des Kodierschemas ${file.filename}: ${error.message}`);
        }
      });

      const allCodedResponses = [];

      for (const unit of units) {
        const responses = unitToResponsesMap.get(unit.id) || [];
        if (responses.length === 0) continue;

        statistics.totalResponses += responses.length;

        let scheme = new Autocoder.CodingScheme({});
        const codingSchemeRef = unitToCodingSchemeRefMap.get(unit.id);
        if (codingSchemeRef) {
          scheme = fileIdToCodingSchemeMap.get(codingSchemeRef) || scheme;
        }

        const codedResponses = responses.map(response => {
          const codedResult = scheme.code([{
            id: response.variableid,
            value: response.value,
            status: response.status as ResponseStatusType
          }]);

          const codedStatus = codedResult[0]?.status;
          if (!statistics.statusCounts[codedStatus]) {
            statistics.statusCounts[codedStatus] = 0;
          }
          statistics.statusCounts[codedStatus] += 1;

          return {
            ...response, // Enthält die ursprüngliche 'id' und andere Felder der Response
            code: codedResult[0]?.code,
            codedstatus: codedStatus,
            score: codedResult[0]?.score
          };
        });

        allCodedResponses.push(...codedResponses);
      }
      if (allCodedResponses.length > 0) {
        try {
          const batchSize = 10000;
          const batches = [];
          for (let i = 0; i < allCodedResponses.length; i += batchSize) {
            batches.push(allCodedResponses.slice(i, i + batchSize));
          }

          this.logger.log(`Starte die Aktualisierung von ${allCodedResponses.length} Responses in ${batches.length} Batches (concurrent).`);

          const updateBatchPromises = batches.map(async (batch, index) => {
            this.logger.log(`Starte Aktualisierung für Batch #${index + 1} (Größe: ${batch.length}).`);
            const individualUpdatePromises = batch.map(codedResponse => this.responseRepository.update(
              codedResponse.id,
              {
                code: codedResponse.code,
                codedstatus: codedResponse.codedstatus,
                score: codedResponse.score
              }
            )
            );
            try {
              await Promise.all(individualUpdatePromises);
              this.logger.log(`Batch #${index + 1} (Größe: ${batch.length}) erfolgreich aktualisiert.`);
            } catch (error) {
              this.logger.error(`Fehler beim Aktualisieren von Batch #${index + 1} (Größe: ${batch.length}):`, error.message);
              throw error;
            }
          });

          await Promise.all(updateBatchPromises);

          this.logger.log(`${allCodedResponses.length} Responses wurden erfolgreich aktualisiert.`);
        } catch (error) {
          this.logger.error('Fehler beim Aktualisieren der Responses:', error.message);
        }
      }

      return statistics;
    } catch (error) {
      this.logger.error('Fehler beim Verarbeiten der Personen:', error);
      return statistics;
    }
  }

  async getManualTestPersons(workspace_id: number, personIds?: string): Promise<unknown> {
    this.logger.log(
      `Fetching responses for workspace_id = ${workspace_id} ${
        personIds ? `and personIds = ${personIds}` : ''
      }.`
    );

    try {
      const persons = await this.personsRepository.find({
        where: { workspace_id: workspace_id }
      });

      if (!persons.length) {
        this.logger.log(`No persons found for workspace_id = ${workspace_id}.`);
        return [];
      }

      const filteredPersons = personIds ?
        persons.filter(person => personIds.split(',').includes(String(person.id))) :
        persons;

      if (!filteredPersons.length) {
        this.logger.log(`No persons match the personIds in workspace_id = ${workspace_id}.`);
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
          `No booklets found for persons = [${personIdsArray.join(', ')}] in workspace_id = ${workspace_id}.`
        );
        return [];
      }

      const units = await this.unitRepository.find({
        where: { bookletid: In(bookletIds) },
        select: ['id', 'name']
      });

      const unitIdToNameMap = new Map(units.map(unit => [unit.id, unit.name]));
      const unitIds = Array.from(unitIdToNameMap.keys());

      if (!unitIds.length) {
        this.logger.log(
          `No units found for booklets = [${bookletIds.join(', ')}] in workspace_id = ${workspace_id}.`
        );
        return [];
      }

      const responses = await this.responseRepository.find({
        where: {
          unitid: In(unitIds),
          codedstatus: In(['CODING_INCOMPLETE', 'INTENDED_INCOMPLETE', 'CODE_SELECTION_PENDING'])
        }
      });

      const enrichedResponses = responses.map(response => ({
        ...response,
        unitname: unitIdToNameMap.get(response.unitid) || 'Unknown Unit'
      }));

      this.logger.log(
        `Fetched ${responses.length} responses for the given criteria in workspace_id = ${workspace_id}.`
      );

      return enrichedResponses;
    } catch (error) {
      this.logger.error(`Failed to fetch responses: ${error.message}`, error.stack);
      throw new Error('Could not retrieve responses. Please check the database connection or query.');
    }
  }

  async findPlayer(workspaceId: number, playerName: string): Promise<FilesDto[]> {
    if (!workspaceId || typeof workspaceId !== 'number') {
      this.logger.error(`Invalid workspaceId provided: ${workspaceId}`);
      throw new Error('Invalid workspaceId parameter');
    }

    if (!playerName || typeof playerName !== 'string') {
      this.logger.error(`Invalid playerName provided: ${playerName}`);
      throw new Error('Invalid playerName parameter');
    }

    this.logger.log(`Attempting to retrieve files for player '${playerName}' in workspace ${workspaceId}`);

    try {
      const files = await this.fileUploadRepository.find({
        where: {
          file_id: playerName.toUpperCase(),
          workspace_id: workspaceId
        }
      });

      if (files.length === 0) {
        this.logger.warn(`No files found for player '${playerName}' in workspace ${workspaceId}`);
      } else {
        this.logger.log(`Found ${files.length} file(s) for player '${playerName}' in workspace ${workspaceId}`);
      }

      return files;
    } catch (error) {
      this.logger.error(
        `Failed to retrieve files for player '${playerName}' in workspace ${workspaceId}`,
        error.stack
      );
      throw new Error(`An error occurred while fetching files for player '${playerName}': ${error.message}`);
    }
  }

  async findUnitDef(workspaceId: number, unitId: string): Promise<FilesDto[]> {
    this.logger.log(`Fetching unit definition for unit: ${unitId} in workspace: ${workspaceId}`);
    try {
      const files = await this.fileUploadRepository.find({
        select: ['file_id', 'filename', 'data'],
        where: {
          file_id: `${unitId}.VOUD`,
          workspace_id: workspaceId
        }
      });

      if (files.length === 0) {
        this.logger.warn(`No unit definition found for unit: ${unitId} in workspace: ${workspaceId}`);
      } else {
        this.logger.log(`Successfully retrieved ${files.length} file(s) for unit: ${unitId}`);
      }
      return files;
    } catch (error) {
      this.logger.error(
        `Error retrieving unit definition for unit: ${unitId} in workspace: ${workspaceId}`,
        error.stack
      );
      throw new Error(`Could not retrieve unit definition for unit: ${unitId}`);
    }
  }

  async findUnitResponse(workspaceId:number, connector: string, unitId: string): Promise<{ responses: { id: string, content: { id: string; value: string; status: string }[] }[] }> {
    const [group, code] = connector.split('@');
    const person = await this.personsRepository.findOne({ where: { code, group } });
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

  async findWorkspaceResponses(workspace_id: number, options?: { page: number; limit: number }): Promise<[ResponseDto[], number]> {
    this.logger.log('Returning responses for workspace', workspace_id);

    if (options) {
      const { page, limit } = options;
      const MAX_LIMIT = 500;
      const validPage = Math.max(1, page);
      const validLimit = Math.min(Math.max(1, limit), MAX_LIMIT);

      const [responses, total] = await this.responsesRepository.findAndCount({
        where: { workspace_id: workspace_id },
        skip: (validPage - 1) * validLimit,
        take: validLimit,
        order: { id: 'ASC' }
      });

      this.logger.log(`Found ${responses.length} responses (page ${validPage}, limit ${validLimit}, total ${total}) for workspace ${workspace_id}`);
      return [responses, total];
    }

    const responses = await this.responsesRepository.find({
      where: { workspace_id: workspace_id },
      order: { id: 'ASC' }
    });

    this.logger.log(`Found ${responses.length} responses for workspace ${workspace_id}`);
    return [responses, responses.length];
  }

  async getCodingList(options?: { page: number; limit: number }): Promise<[{
    unit_key: string;
    unit_alias: string;
    login_name: string;
    login_code: string;
    booklet_id: string;
    variable_id: string;
    variable_page: string;
    variable_anchor: string;
    url: string;
  }[], number]> {
    try {
      if (options) {
        const { page, limit } = options;
        const MAX_LIMIT = 500;
        const validPage = Math.max(1, page); // minimum 1
        const validLimit = Math.min(Math.max(1, limit), MAX_LIMIT); // Between 1 and MAX_LIMIT

        const queryBuilder = this.responseRepository.createQueryBuilder('response')
          .leftJoinAndSelect('response.unit', 'unit')
          .leftJoinAndSelect('unit.booklet', 'booklet')
          .leftJoinAndSelect('booklet.person', 'person')
          .leftJoinAndSelect('booklet.bookletinfo', 'bookletinfo')
          .where('response.codedStatus = :status', { status: 'CODING_INCOMPLETE' })
          .skip((validPage - 1) * validLimit)
          .take(validLimit)
          .orderBy('response.id', 'ASC');

        const [responses, total] = await queryBuilder.getManyAndCount();

        const result = responses.map(response => {
          const unit = response.unit;
          const booklet = unit?.booklet;
          const person = booklet?.person;
          const bookletInfo = booklet?.bookletinfo;
          const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjEsInVzZXJuYW1lIjoicmVpY2hsZWpAZ214LmRlIiwic3ViIjp7ImlkIjoxLCJ1c2VybmFtZSI6InJlaWNobGVqQGdteC5kZSIsImlzQWRtaW4iOnRydWV9LCJ3b3Jrc3BhY2UiOiIzNCIsImlhdCI6MTc0OTAzNzUzMywiZXhwIjoxNzU0MjIxNTMzfQ.4FVfq10u_SbhXCCNXb2edh_SYupW-LZPj09Opb08CS4';

          const loginName = person?.login || '';
          const loginCode = person?.code || '';
          const bookletId = bookletInfo?.name || '';
          const unitKey = unit?.name || '';
          const variablePage = '0';

          // Generate URL in the format: https://www.iqb-kodierbox.de/#/replay/{login_name}@{login_code}@{booklet_id}/{unit_key}/{variable_page}?auth={token}
          const url = `https://www.iqb-kodierbox.de/#/replay/${loginName}@${loginCode}@${bookletId}/${unitKey}/${variablePage}?auth=${token}`;

          return {
            unit_key: unitKey,
            unit_alias: unit?.alias || '',
            login_name: loginName,
            login_code: loginCode,
            booklet_id: bookletId,
            variable_id: response.variableid || '',
            variable_page: variablePage,
            variable_anchor: '',
            url
          };
        });

        this.logger.log(`Found ${result.length} coding items (page ${validPage}, limit ${validLimit}, total ${total})`);
        return [result, total];
      }

      const responses = await this.responseRepository.find({
        where: { codedstatus: 'CODING_INCOMPLETE' },
        relations: ['unit', 'unit.booklet', 'unit.booklet.person', 'unit.booklet.bookletinfo'],
        order: { id: 'ASC' }
      });

      const result = responses.map(response => {
        const unit = response.unit;
        const booklet = unit?.booklet;
        const person = booklet?.person;
        const bookletInfo = booklet?.bookletinfo;
        const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjEsInVzZXJuYW1lIjoicmVpY2hsZWpAZ214LmRlIiwic3ViIjp7ImlkIjoxLCJ1c2VybmFtZSI6InJlaWNobGVqQGdteC5kZSIsImlzQWRtaW4iOnRydWV9LCJ3b3Jrc3BhY2UiOiIzNCIsImlhdCI6MTc0OTAzNzUzMywiZXhwIjoxNzU0MjIxNTMzfQ.4FVfq10u_SbhXCCNXb2edh_SYupW-LZPj09Opb08CS4';

        const loginName = person?.login || '';
        const loginCode = person?.code || '';
        const bookletId = bookletInfo?.name || '';
        const unitKey = unit?.name || '';
        const variablePage = '0';

        // Generate URL in the format: https://www.iqb-kodierbox.de/#/replay/{login_name}@{login_code}@{booklet_id}/{unit_key}/{variable_page}?auth={token}
        const url = `https://www.iqb-kodierbox.de/#/replay/${loginName}@${loginCode}@${bookletId}/${unitKey}/${variablePage}?auth=${token}`;

        return {
          unit_key: unitKey,
          unit_alias: unit?.alias || '',
          login_name: loginName,
          login_code: loginCode,
          booklet_id: bookletId,
          variable_id: response.variableid || '',
          variable_page: variablePage,
          variable_anchor: '',
          url
        };
      });

      this.logger.log(`Found ${result.length} coding items`);
      return [result, result.length];
    } catch (error) {
      this.logger.error(`Error fetching coding list: ${error.message}`);
      return [[], 0];
    }
  }

  async getCodingStatistics(workspace_id: number): Promise<CodingStatistics> {
    this.logger.log(`Getting coding statistics for workspace ${workspace_id}`);

    const statistics: CodingStatistics = {
      totalResponses: 0,
      statusCounts: {}
    };

    try {
      const queryBuilder = this.responseRepository.createQueryBuilder('response')
        .innerJoin('response.unit', 'unit')
        .innerJoin('unit.booklet', 'booklet')
        .innerJoin('booklet.person', 'person')
        .where('response.status = :status', { status: 'VALUE_CHANGED' })
        .andWhere('person.workspace_id = :workspace_id', { workspace_id });

      statistics.totalResponses = await queryBuilder.getCount();

      const statusCountResults = await queryBuilder
        .select('COALESCE(response.codedstatus, null)', 'statusValue')
        .addSelect('COUNT(response.id)', 'count')
        .groupBy('COALESCE(response.codedstatus, null)')
        .getRawMany();

      statusCountResults.forEach(result => {
        statistics.statusCounts[result.statusValue] = parseInt(result.count, 10);
      });

      return statistics;
    } catch (error) {
      this.logger.error(`Error getting coding statistics: ${error.message}`);

      return statistics;
    }
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

  async validateTestFiles(workspaceId: number): Promise<FileValidationResultDto> {
    try {
      const testTakers = await this.fileUploadRepository.find({
        where: { workspace_id: workspaceId, file_type: In(['TestTakers', 'Testtakers']) }
      });

      if (!testTakers || testTakers.length === 0) {
        this.logger.warn(`No TestTakers found in workspace with ID ${workspaceId}.`);
        return {
          testTakersFound: false,
          validationResults: this.createEmptyValidationData()
        };
      }

      const validationResultsPromises = testTakers.map(testTaker => this.processTestTaker(testTaker));
      const validationResults = (await Promise.all(validationResultsPromises)).filter(Boolean);

      if (validationResults.length > 0) {
        return {
          testTakersFound: true,
          validationResults
        };
      }

      const booklets = await this.fileUploadRepository.find({
        where: { workspace_id: workspaceId, file_type: 'Booklet' }
      });

      if (!booklets || booklets.length === 0) {
        this.logger.warn(`No booklets found in workspace with ID ${workspaceId}.`);
        return {
          testTakersFound: true,
          validationResults: this.createEmptyValidationData()
        };
      }

      return {
        testTakersFound: true,
        validationResults: this.createEmptyValidationData()
      };
    } catch (error) {
      this.logger.error(`Error during test file validation for workspace ID ${workspaceId}: ${error.message}`, error.stack);
      throw error;
    }
  }

  private createEmptyValidationData(): ValidationData[] {
    return [{
      testTaker: '',
      booklets: { complete: false, missing: [], files: [] },
      units: { complete: false, missing: [], files: [] },
      schemes: { complete: false, missing: [], files: [] },
      definitions: { complete: false, missing: [], files: [] },
      player: { complete: false, missing: [], files: [] }
    }];
  }

  private async processTestTaker(testTaker: FileUpload): Promise<ValidationData | null> {
    const xmlDocument = cheerio.load(testTaker.data, { xmlMode: true, recognizeSelfClosing: true });
    const bookletTags = xmlDocument('Booklet');
    const unitTags = xmlDocument('Unit');

    if (bookletTags.length === 0) {
      this.logger.warn('No <Booklet> elements found in the XML document.');
      return null;
    }

    this.logger.log(`Found ${bookletTags.length} <Booklet> elements.`);

    const {
      uniqueBooklets
    } = this.extractXmlData(bookletTags, unitTags);

    const { allBookletsExist, missingBooklets, bookletFiles } = await this.checkMissingBooklets(Array.from(uniqueBooklets));
    const {
      allUnitsExist,
      missingUnits,
      unitFiles,
      missingCodingSchemeRefs,
      missingDefinitionRefs,
      schemeFiles,
      definitionFiles,
      allCodingSchemesExist,
      allCodingDefinitionsExist,
      allPlayerRefsExist,
      missingPlayerRefs,
      playerFiles
    } = await this.checkMissingUnits(Array.from(uniqueBooklets));

    // If booklets are incomplete, all other categories should also be marked as incomplete
    const bookletComplete = allBookletsExist;

    // If units are incomplete, coding schemes, definitions, and player should also be marked as incomplete
    const unitComplete = bookletComplete && allUnitsExist;

    return {
      testTaker: testTaker.file_id,
      booklets: {
        complete: bookletComplete,
        missing: missingBooklets,
        files: bookletFiles
      },
      units: {
        complete: bookletComplete ? allUnitsExist : false,
        missing: missingUnits,
        files: unitFiles
      },
      schemes: {
        complete: unitComplete ? allCodingSchemesExist : false,
        missing: missingCodingSchemeRefs,
        files: schemeFiles
      },
      definitions: {
        complete: unitComplete ? allCodingDefinitionsExist : false,
        missing: missingDefinitionRefs,
        files: definitionFiles
      },
      player: {
        complete: unitComplete ? allPlayerRefsExist : false,
        missing: missingPlayerRefs,
        files: playerFiles
      }
    };
  }

  private extractXmlData(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    bookletTags: cheerio.Cheerio<any>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    unitTags: cheerio.Cheerio<any>
  ): {
      uniqueBooklets: Set<string>;
      uniqueUnits: Set<string>;
      codingSchemeRefs: string[];
      definitionRefs: string[];
    } {
    const uniqueBooklets = new Set<string>();
    const uniqueUnits = new Set<string>();
    const codingSchemeRefs: string[] = [];
    const definitionRefs: string[] = [];

    bookletTags.each((_, booklet) => {
      const bookletValue = cheerio.load(booklet).text().trim();
      uniqueBooklets.add(bookletValue);
    });

    unitTags.each((_, unit) => {
      const $ = cheerio.load(unit);

      $('unit').each((__, codingScheme) => {
        const value = $(codingScheme).text().trim();
        if (value) codingSchemeRefs.push(value);
      });

      $('DefinitionRef').each((__, definition) => {
        const value = $(definition).text().trim();
        if (value) definitionRefs.push(value);
      });

      const unitId = $('unit').attr('id');
      if (unitId) {
        uniqueUnits.add(unitId.trim());
      }
    });

    return {
      uniqueBooklets, uniqueUnits, codingSchemeRefs, definitionRefs
    };
  }

  async findUnit(workspace_id: number, testPerson:string, unitId:string): Promise<FileUpload[]> {
    this.logger.log('Returning unit for test person', testPerson);
    return this.fileUploadRepository.find(
      { where: { file_id: `${unitId}`, workspace_id: workspace_id } });
  }

  async findTestGroups(workspace_id: number): Promise<TestGroupsInListDto[]> {
    this.logger.log('Returning all test groups for workspace ', workspace_id);
    const data = await this.responsesRepository
      .find({
        select: ['test_group', 'created_at'],
        where: { workspace_id: workspace_id },
        order: { test_group: 'ASC' }
      });
    const testGroups = [];
    const uniqueObject = {};
    for (const i in data) {
      const objTitle = data[i].test_group;
      uniqueObject[objTitle] = data[i];
    }
    for (const i in uniqueObject) {
      testGroups.push(uniqueObject[i]);
    }
    return testGroups;
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

  async findTestPersons(id: number): Promise<number[]> {
    this.logger.log('Returning all test persons for workspace ', id);
    const persons = await this.personsRepository
      .find({
        select: ['id'],
        where: { workspace_id: id },
        order: { id: 'ASC' }
      });

    return persons.map(person => person.id);
  }

  async findTestPersonUnits(id: number, testPerson:string): Promise<ResponseDto[]> {
    this.logger.log('Returning all unit Ids for testperson ', testPerson);
    const res = this.responsesRepository
      .find({
        select: ['unit_id'],
        where: { test_person: testPerson },
        order: { unit_id: 'ASC' }
      });
    if (res) {
      return res;
    }
    return [];
  }

  async findOne(id: number): Promise<WorkspaceFullDto> {
    this.logger.log(`Returning workspace with id: ${id}`);
    const workspace = await this.workspaceRepository.findOne({
      where: { id: id },
      select: { id: true, name: true, settings: true }
    });
    if (workspace) {
      return <WorkspaceFullDto>{
        id: workspace.id,
        name: workspace.name,
        settings: workspace.settings
      };
    }
    throw new AdminWorkspaceNotFoundException(id, 'GET');
  }

  async create(workspace: CreateWorkspaceDto): Promise<number> {
    this.logger.log(`Creating workspace with name: ${workspace.name}`);
    const newWorkspace = this.workspaceRepository.create({ ...workspace });
    try {
      const savedWorkspace = await this.workspaceRepository.save(newWorkspace);
      this.logger.log(`Workspace created successfully with ID: ${savedWorkspace.id}`);
      return savedWorkspace.id;
    } catch (error) {
      this.logger.error(
        `Failed to create workspace with name: ${workspace.name}`,
        error.stack
      );
      throw new Error('Workspace creation failed');
    }
  }

  async patch(workspaceData: WorkspaceFullDto): Promise<void> {
    this.logger.log(`Updating workspace with id: ${workspaceData.id}`);
    if (workspaceData.id) {
      const workspaceGroupToUpdate = await this.workspaceRepository.findOne({
        where: { id: workspaceData.id }
      });
      if (workspaceData.name) workspaceGroupToUpdate.name = workspaceData.name;
      if (workspaceData.settings) workspaceGroupToUpdate.settings = workspaceData.settings;
      await this.workspaceRepository.save(workspaceGroupToUpdate);
    }
  }

  async remove(ids: number[]): Promise<void> {
    if (!ids || ids.length === 0) {
      this.logger.warn('No IDs provided for workspace deletion.');
      return;
    }
    this.logger.log(`Attempting to delete workspaces with IDs: ${ids.join(', ')}`);
    try {
      const result = await this.workspaceRepository.delete(ids);

      if (result.affected && result.affected > 0) {
        this.logger.log(`Successfully deleted ${result.affected} workspace(s) with IDs: ${ids.join(', ')}`);
      } else {
        this.logger.warn(`No workspaces found with the specified IDs: ${ids.join(', ')}`);
      }
    } catch (error) {
      this.logger.error(`Failed to delete workspaces with IDs: ${ids.join(', ')}. Error: ${error.message}`, error.stack);
      throw error;
    }
  }

  async uploadTestFiles(workspace_id: number, originalFiles: FileIo[]): Promise<boolean> {
    this.logger.log(`Uploading test files for workspace ${workspace_id}`);

    const MAX_CONCURRENT_UPLOADS = 5;
    const processInBatches = async (files: FileIo[], batchSize: number): Promise<PromiseSettledResult<void>[]> => {
      const results: PromiseSettledResult<void>[] = [];
      const batches = [];
      for (let i = 0; i < files.length; i += batchSize) {
        const batch = files.slice(i, i + batchSize);
        batches.push(
          Promise.allSettled(batch.flatMap(file => this.handleFile(workspace_id, file)))
        );
      }
      const batchResults = await Promise.all(batches);
      batchResults.forEach(batch => results.push(...batch as PromiseSettledResult<void>[]));
      return results;
    };

    try {
      const results = await processInBatches(originalFiles, MAX_CONCURRENT_UPLOADS);
      const failedFiles = results
        .filter(result => result.status === 'rejected')
        .map((result, index) => ({
          file: originalFiles[index],
          reason: (result as PromiseRejectedResult).reason
        }));

      if (failedFiles.length > 0) {
        this.logger.warn(`Some files failed to upload for workspace ${workspace_id}:`);
        failedFiles.forEach(({ file, reason }) => this.logger.warn(`File: ${JSON.stringify(file)}, Reason: ${reason}`)
        );
      }
      return failedFiles.length === 0;
    } catch (error) {
      this.logger.error(`Unexpected error while uploading files for workspace ${workspace_id}:`, error);
    }
  }

  async downloadTestFile(workspace_id: number, fileId: number): Promise<FileDownloadDto> {
    this.logger.log(`Downloading file with ID ${fileId} for workspace ${workspace_id}`);

    const file = await this.fileUploadRepository.findOne({
      where: { id: fileId, workspace_id: workspace_id }
    });

    if (!file) {
      this.logger.warn(`File with ID ${fileId} not found in workspace ${workspace_id}`);
      throw new Error('File not found');
    }
    this.logger.log(`File ${file.filename} found. Preparing to convert to Base64.`);
    const base64Data = Buffer.from(file.data, 'binary').toString('base64');
    this.logger.log(`File ${file.filename} successfully converted to Base64.`);

    return {
      filename: file.filename,
      base64Data,
      mimeType: 'application/xml'
    };
  }

  handleFile(workspaceId: number, file: FileIo): Array<Promise<unknown>> {
    const filePromises: Array<Promise<unknown>> = [];

    switch (file.mimetype) {
      case 'text/xml':
        filePromises.push(this.handleXmlFile(workspaceId, file));
        break;
      case 'text/html':
        filePromises.push(this.handleHtmlFile(workspaceId, file));
        break;
      case 'application/octet-stream':
        filePromises.push(this.handleOctetStreamFile(workspaceId, file));
        break;
      case 'application/zip':
      case 'application/x-zip-compressed':
      case 'application/x-zip':
        filePromises.push(...this.handleZipFile(workspaceId, file));
        break;
      default:
        this.logger.warn(`Unsupported file type: ${file.mimetype}`);
    }

    return filePromises;
  }

  private unsupportedFile(message: string): Promise<unknown> {
    this.logger.warn(message);
    return Promise.resolve();
  }

  private async validateXmlAgainstSchema(xml: string, xsdPath: string): Promise<void> {
    const xsd = fs.readFileSync(xsdPath, 'utf8');
    const xsdDoc = libxmljs.parseXml(xsd);

    const xmlDoc = libxmljs.parseXml(xml);

    if (!xmlDoc.validate(xsdDoc)) {
      const validationErrors = xmlDoc.validationErrors.map(err => err.message).join(', ');
      throw new Error(`XML-Validierung fehlgeschlagen: ${validationErrors}`);
    }

    this.logger.log('XML-Validierung erfolgreich!');
  }

  private async handleXmlFile(workspaceId: number, file: FileIo): Promise<unknown> {
    try {
      if (!file.buffer || !file.buffer.length) {
        this.logger.warn('Empty file buffer');
        return await Promise.resolve();
      }

      const xmlContent = file.buffer.toString('utf8');
      const xmlDocument = cheerio.load(file.buffer.toString('utf8'), { xmlMode: true, recognizeSelfClosing: true });
      const firstChild = xmlDocument.root().children().first();
      const rootTagName = firstChild ? firstChild.prop('tagName') : null;

      if (!rootTagName) {
        return await this.unsupportedFile('Invalid XML: No root tag found');
      }

      const fileTypeMapping: Record<string, string> = {
        UNIT: 'Unit',
        BOOKLET: 'Booklet',
        TESTTAKERS: 'TestTakers'
      };

      const fileType = fileTypeMapping[rootTagName];
      if (!fileType) {
        return await this.unsupportedFile(`Unsupported root tag: ${rootTagName}`);
      }

      const schemaPaths: Record<string, string> = {
        UNIT: path.resolve(__dirname, 'schemas/unit.xsd'),
        BOOKLET: path.resolve(__dirname, 'schemas/booklet.xsd'),
        TESTTAKERS: path.resolve(__dirname, 'schemas/testtakers.xsd')
      };
      const xsdPath = schemaPaths[rootTagName];
      if (!xsdPath || !fs.existsSync(xsdPath)) {
        return await this.unsupportedFile(`No XSD schema found for root tag: ${rootTagName}`);
      }

      await this.validateXmlAgainstSchema(xmlContent, xsdPath);

      const metadata = xmlDocument('Metadata');
      const idElement = metadata.find('Id');
      const fileId = idElement.length ? idElement.text().toUpperCase().trim() : null;
      const resolvedFileId = fileType === 'TestTakers' ? fileId || file.originalname : fileId;

      const existingFile = await this.fileUploadRepository.findOne({
        where: { file_id: resolvedFileId, workspace_id: workspaceId }
      });
      if (existingFile) {
        this.logger.warn(
          `File with ID ${resolvedFileId} in Workspace ${workspaceId} already exists.`
        );
        return {
          message: `File with ID ${resolvedFileId} already exists`,
          fileId: resolvedFileId,
          filename: file.originalname
        };
      }

      return await this.fileUploadRepository.upsert({
        workspace_id: workspaceId,
        filename: file.originalname,
        file_type: fileType,
        file_size: file.size,
        data: file.buffer.toString(),
        file_id: resolvedFileId
      }, ['file_id']);
    } catch (error) {
      this.logger.error(`Error processing XML file: ${error.message}`);
      throw error;
    }
  }

  private async handleHtmlFile(workspaceId: number, file: FileIo): Promise<unknown> {
    const resourceFileId = WorkspaceService.getPlayerId(file);

    return this.fileUploadRepository.upsert({
      filename: file.originalname,
      workspace_id: workspaceId,
      file_type: 'Resource',
      file_size: file.size,
      file_id: resourceFileId,
      data: file.buffer.toString()
    }, ['file_id']);
  }

  private async handleOctetStreamFile(workspaceId: number, file: FileIo): Promise<unknown> {
    const resourceId = WorkspaceService.getResourceId(file);

    if (file.originalname.endsWith('.vocs')) {
      try {
        const parsedData = JSON.parse(file.buffer.toString());
        const schemaPath = './schemas/coding-scheme.schema.json';
        const schemaContent = fs.readFileSync(schemaPath, 'utf-8');
        const schema: JSONSchemaType<unknown> = JSON.parse(schemaContent);
        const ajv = new Ajv();
        const validate = ajv.compile(schema);
        const isValid = validate(parsedData);
        if (!isValid) {
          this.logger.error(`JSON validation failed: ${JSON.stringify(validate.errors)}`);
        }

        return await this.fileUploadRepository.upsert({
          filename: file.originalname,
          workspace_id: workspaceId,
          file_id: resourceId.toUpperCase(),
          file_type: 'Resource',
          file_size: file.size,
          data: file.buffer.toString()
        }, ['file_id']);
      } catch (error) {
        this.logger.error('Error parsing or validating JSON:', error);
        throw new Error('Invalid JSON file or failed validation');
      }
    }

    return this.fileUploadRepository.upsert({
      filename: file.originalname,
      workspace_id: workspaceId,
      file_id: resourceId.toUpperCase(),
      file_type: 'Resource',
      file_size: file.size,
      data: file.buffer.toString()
    }, ['file_id']);
  }

  private handleZipFile(workspaceId: number, file: FileIo): Array<Promise<unknown>> {
    const filePromises: Array<Promise<unknown>> = [];
    const zip = new AdmZip(file.buffer);

    if (file.originalname.endsWith('.itcr.zip')) {
      const packageFiles = zip.getEntries().map(entry => entry.entryName);
      const resourcePackagesPath = './packages';
      const packageName = 'GeoGebra';
      const zipExtractAllToAsync = util.promisify(zip.extractAllToAsync);

      filePromises.push(zipExtractAllToAsync(`${resourcePackagesPath}/${packageName}`, true, true)
        .then(async () => {
          const newResourcePackage = this.resourcePackageRepository.create({
            name: packageName,
            elements: packageFiles,
            createdAt: new Date()
          });
          await this.resourcePackageRepository.save(newResourcePackage);

          const sanitizedFileName = sanitizePath(file.originalname);
          fs.writeFileSync(`${resourcePackagesPath}/${packageName}/${sanitizedFileName}`, file.buffer);

          return newResourcePackage.id;
        }));
    } else {
      const zipEntries = zip.getEntries();
      zipEntries.forEach(zipEntry => {
        const sanitizedEntry = sanitizePath(zipEntry.entryName);

        if (zipEntry.isDirectory) {
          this.logger.debug(`Skipping directory entry: ${sanitizedEntry}`);
          return;
        }

        const fileContent = zipEntry.getData();
        filePromises.push(...this.handleFile(workspaceId, {
          fieldname: file.fieldname,
          originalname: `${sanitizedEntry}`,
          encoding: file.encoding,
          mimetype: WorkspaceService.getMimeType(sanitizedEntry),
          buffer: fileContent,
          size: fileContent.length
        } as FileIo));
      });
    }

    return filePromises;
  }

  async checkMissingBooklets(uniqueBookletsArray: string[]): Promise<{
    allBookletsExist: boolean,
    missingBooklets: string[],
    bookletFiles: FileStatus[]
  }> {
    try {
      const upperCaseBookletsArray = uniqueBookletsArray
        .map(booklet => booklet.toUpperCase());

      const existingBooklets = await this.fileUploadRepository.findBy({
        file_id: In(upperCaseBookletsArray)
      });
      const foundBookletIds = existingBooklets.map(booklet => booklet.file_id);

      const missingBooklets = upperCaseBookletsArray.filter(
        bookletId => !foundBookletIds.includes(bookletId)
      );
      const allBookletsExist = missingBooklets.length === 0;

      // Create a list of all booklets with their match status
      const bookletFiles: FileStatus[] = upperCaseBookletsArray.map(bookletId => ({
        filename: bookletId,
        exists: foundBookletIds.includes(bookletId)
      }));

      return { allBookletsExist, missingBooklets, bookletFiles };
    } catch (error) {
      this.logger.error('Error validating booklets:', error);
      throw error;
    }
  }

  async checkMissingUnits(bookletNames:string[]): Promise<ValidationResult> {
    try {
      // Get all booklets in a single query with uppercase file_id
      const existingBooklets = await this.fileUploadRepository.findBy({
        file_type: 'Booklet',
        file_id: In(bookletNames.map(b => b.toUpperCase()))
      });

      // Extract unit IDs from all booklets in parallel
      const unitIdsPromises = existingBooklets.map(async booklet => {
        try {
          const fileData = booklet.data;
          const $ = cheerio.load(fileData, { xmlMode: true });
          const unitIds: string[] = [];

          $('Unit').each((_, element) => {
            const unitId = $(element).attr('id');
            if (unitId) {
              unitIds.push(unitId.toUpperCase());
            }
          });

          return unitIds;
        } catch (error) {
          this.logger.error(`Fehler beim Verarbeiten von Unit ${booklet.file_id}:`, error);
          return [];
        }
      });

      // Wait for all promises to resolve and flatten the array
      const allUnitIdsArrays = await Promise.all(unitIdsPromises);
      // Use Set to remove duplicates, then convert back to array
      const allUnitIds = Array.from(new Set(allUnitIdsArrays.flat()));

      // Get all units in batches to avoid query size limitations
      const chunkSize = 50;
      const unitBatches = [];

      for (let i = 0; i < allUnitIds.length; i += chunkSize) {
        const chunk = allUnitIds.slice(i, i + chunkSize);
        unitBatches.push(chunk);
      }

      // Execute all batch queries in parallel
      const unitBatchPromises = unitBatches.map(batch => this.fileUploadRepository.find({
        where: { file_id: In(batch) }
      }));

      const unitBatchResults = await Promise.all(unitBatchPromises);
      const existingUnits = unitBatchResults.flat();

      // Extract references from all units in parallel
      const refsPromises = existingUnits.map(async unit => {
        try {
          const fileData = unit.data;
          const $ = cheerio.load(fileData, { xmlMode: true });
          const refs = {
            codingSchemeRefs: [] as string[],
            definitionRefs: [] as string[],
            playerRefs: [] as string[]
          };

          $('Unit').each((_, element) => {
            const codingSchemeRef = $(element).find('CodingSchemeRef').text();
            const definitionRef = $(element).find('DefinitionRef').text();
            const playerRefAttr = $(element).find('DefinitionRef').attr('player');
            const playerRef = playerRefAttr ? playerRefAttr.replace('@', '-') : '';

            if (codingSchemeRef) {
              refs.codingSchemeRefs.push(codingSchemeRef.toUpperCase());
            }

            if (definitionRef) {
              refs.definitionRefs.push(definitionRef.toUpperCase());
            }

            if (playerRef) {
              refs.playerRefs.push(playerRef.toUpperCase());
            }
          });

          return refs;
        } catch (error) {
          this.logger.error(`Fehler beim Verarbeiten von Unit ${unit.file_id}:`, error);
          return { codingSchemeRefs: [], definitionRefs: [], playerRefs: [] };
        }
      });

      // Wait for all promises to resolve
      const allRefs = await Promise.all(refsPromises);

      // Combine all references using Sets to remove duplicates
      const allCodingSchemeRefs = Array.from(new Set(allRefs.flatMap(ref => ref.codingSchemeRefs)));
      const allDefinitionRefs = Array.from(new Set(allRefs.flatMap(ref => ref.definitionRefs)));
      const allPlayerRefs = Array.from(new Set(allRefs.flatMap(ref => ref.playerRefs)));

      // Get all resources in a single query
      const existingResources = await this.fileUploadRepository.findBy({
        file_type: 'Resource'
      });

      const allResourceIds = existingResources.map(resource => resource.file_id);

      // Find missing references
      const missingCodingSchemeRefs = allCodingSchemeRefs.filter(ref => !allResourceIds.includes(ref));
      const missingDefinitionRefs = allDefinitionRefs.filter(ref => !allResourceIds.includes(ref));
      const missingPlayerRefs = allPlayerRefs.filter(ref => !allResourceIds.includes(ref));

      // Check if all references exist
      const allCodingSchemesExist = missingCodingSchemeRefs.length === 0;
      const allCodingDefinitionsExist = missingDefinitionRefs.length === 0;
      const allPlayerRefsExist = missingPlayerRefs.length === 0;

      // Find missing units
      const foundUnitIds = existingUnits.map(unit => unit.file_id.toUpperCase());
      const missingUnits = allUnitIds.filter(unitId => !foundUnitIds.includes(unitId));
      const uniqueUnits = Array.from(new Set(missingUnits));

      const allUnitsExist = missingUnits.length === 0;

      // Create lists of all files with their match status
      const unitFiles: FileStatus[] = allUnitIds.map(unitId => ({
        filename: unitId,
        exists: foundUnitIds.includes(unitId)
      }));

      const schemeFiles: FileStatus[] = allCodingSchemeRefs.map(ref => ({
        filename: ref,
        exists: allResourceIds.includes(ref)
      }));

      const definitionFiles: FileStatus[] = allDefinitionRefs.map(ref => ({
        filename: ref,
        exists: allResourceIds.includes(ref)
      }));

      const playerFiles: FileStatus[] = allPlayerRefs.map(ref => ({
        filename: ref,
        exists: allResourceIds.includes(ref)
      }));

      return {
        allUnitsExist,
        missingUnits: uniqueUnits,
        unitFiles,
        allCodingSchemesExist,
        allCodingDefinitionsExist,
        missingCodingSchemeRefs,
        missingDefinitionRefs,
        schemeFiles,
        definitionFiles,
        allPlayerRefsExist,
        missingPlayerRefs,
        playerFiles
      };
    } catch (error) {
      this.logger.error('Error validating units', error);
      throw error;
    }
  }

  static cleanResponses(rows: ResponseDto[]): ResponseDto[] {
    return Object.values(rows.reduce((agg, response) => {
      const key = [response.test_person, response.unit_id].join('@@@@@@');
      if (agg[key]) {
        if (!(agg[key].responses.length) && response.responses.length) {
          agg[key].responses = response.responses;
        }
        if (
          !(Object.keys(agg[key].unit_state || {}).length) &&
          (Object.keys(response.unit_state || {}).length)
        ) {
          agg[key].unit_state = response.unit_state;
        }
      } else {
        agg[key] = response;
      }
      return agg;
    }, <{ [key: string]: ResponseDto }>{}));
  }

  async testCenterImport(entries: Record<string, unknown>[]): Promise<boolean> {
    try {
      const registry = this.fileUploadRepository.create(entries);
      await this.fileUploadRepository.upsert(registry, ['file_id']);
      return true;
    } catch (error) {
      this.logger.error('Error during test center import', error);
      return false;
    }
  }

  private static getMimeType(fileName: string): string {
    if (/\.xml$/i.test(fileName)) return 'text/xml';
    if (/\.html$/i.test(fileName)) return 'text/html';
    return 'application/octet-stream';
  }

  private static getPlayerId(file: FileIo): string {
    try {
      const playerCode = file.buffer.toString();

      const playerContent = cheerio.load(playerCode);

      // Search for JSON+LD <script> tags in the parsed DOM.
      const metaDataElement = playerContent('script[type="application/ld+json"]');
      if (!metaDataElement.length) {
        console.error('Meta-data <script> tag not found');
      }

      const metadata = JSON.parse(metaDataElement.text());
      if (!metadata.id || !metadata.version) {
        console.error('Invalid metadata structure: Missing id or version');
      }

      return WorkspaceService.normalizePlayerId(`${metadata.id}-${metadata.version}`);
    } catch (error) {
      return WorkspaceService.getResourceId(file);
    }
  }

  private static getResourceId(file: FileIo): string {
    if (!file?.originalname) {
      throw new Error('Invalid file: originalname is required.');
    }
    const filePathParts = file.originalname.split('/')
      .map(part => part.trim());
    const fileName = filePathParts.pop();
    if (!fileName) {
      throw new Error('Invalid file: Could not determine the file name.');
    }
    return fileName.toUpperCase();
  }

  private static normalizePlayerId(name: string): string {
    const reg = /^(\D+?)[@V-]?((\d+)(\.\d+)?(\.\d+)?(-\S+?)?)?(.\D{3,4})?$/;

    const matches = name.match(reg);

    if (!matches) {
      throw new Error(`Invalid player name: ${name}`);
    }

    const [, module = '', , major = '', minorDot = ''] = matches;

    const majorVersion = parseInt(major, 10) || 0;
    const minorVersion = minorDot ? parseInt(minorDot.substring(1), 10) : 0;
    // const patchVersion = patchDot ? parseInt(patchDot.substring(1), 10) : 0;
    // const label = labelWithDash ? labelWithDash.substring(1) : '';

    return `${module}-${majorVersion}.${minorVersion}`.toUpperCase();
  }
}
