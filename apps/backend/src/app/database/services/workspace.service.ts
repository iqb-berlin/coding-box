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
// eslint-disable-next-line import/no-cycle
import Persons from '../entities/persons.entity';
import { Unit } from '../entities/unit.entity';
import { Booklet } from '../entities/booklet.entity';
import { ResponseEntity } from '../entities/response.entity';
import { BookletInfo } from '../entities/bookletInfo.entity';
import { FileDownloadDto } from '../../../../../../api-dto/files/file-download.dto';
import { BookletLog } from '../entities/bookletLog.entity';
import { UnitLog } from '../entities/unitLog.entity';

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

type DataValidation = {
  complete: boolean;
  missing: string[];
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
  allCodingSchemesExist: boolean;
  allCodingDefinitionsExist: boolean;
  missingCodingSchemeRefs: string[];
  missingDefinitionRefs: string[];
  allPlayerRefsExist: boolean;
  missingPlayerRefs: string[];
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
    private readonly connection: Connection

  ) {
  }

  async findAll(): Promise<WorkspaceInListDto[]> {
    this.logger.log('Fetching all workspaces from the repository.');
    const workspaces = await this.workspaceRepository.find({
      select: ['id', 'name']
    });
    this.logger.log(`Found ${workspaces.length} workspaces.`);
    return workspaces.map(({ id, name }) => ({ id, name }));
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

  async findFiles(workspaceId: number): Promise<FilesDto[]> {
    this.logger.log(`Fetching all test files for workspace: ${workspaceId}`);

    return this.fileUploadRepository.find({
      where: { workspace_id: workspaceId },
      select: ['id', 'filename', 'file_id', 'file_size', 'file_type', 'created_at']
    });
  }

  async findPersonTestResults(personId: number, workspaceId: number): Promise<{
    id: number;
    personid: number;
    name: string;
    size: number;
    logs: { id: number; bookletid: number; ts: string; parameter: string, key: string }[];
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

  async findUsers(workspaceId: number): Promise<WorkspaceUser[]> {
    this.logger.log(`Retrieving all users for workspace ID: ${workspaceId}`);

    try {
      const users = await this.workspaceUsersRepository.find({
        where: { workspaceId }
      });
      this.logger.log(`Found ${users.length} user(s) for workspace ID: ${workspaceId}`);
      return users;
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

  async codeTestPersons(workspace_id: number, testPersonIds: string): Promise<boolean> {
    const ids = testPersonIds.split(',');
    this.logger.log(`Verarbeite Personen ${testPersonIds} für Workspace ${workspace_id}`);

    try {
      const persons = await this.personsRepository.find({
        where: { workspace_id, id: In(ids) }
      });

      if (!persons || persons.length === 0) {
        this.logger.warn('Keine Personen gefunden mit den angegebenen IDs.');
        return false;
      }

      for (const person of persons) {
        const booklets = await this.bookletRepository.find({
          where: { personid: person.id }
        });

        if (!booklets || booklets.length === 0) {
          this.logger.log(`Keine Booklets für Person ${person.id} gefunden.`);
          continue;
        }

        for (const booklet of booklets) {
          const units = await this.unitRepository.find({
            where: { bookletid: booklet.id }
          });

          if (!units || units.length === 0) {
            this.logger.log(`Keine Einheiten für Booklet ${booklet.id} gefunden.`);
            continue;
          }

          for (const unit of units) {
            const testFile = await this.fileUploadRepository
              .findOne({ where: { file_id: unit.alias.toUpperCase() } });

            if (!testFile) {
              this.logger.log(`--- Keine Testdatei für Einheit ${unit.id} gefunden.`);
              continue;
            }
            let scheme = new Autocoder.CodingScheme({});

            try {
              const $ = cheerio.load(testFile.data);
              const codingSchemeRefText = $('codingSchemeRef').text();
              if (codingSchemeRefText) {
                const fileRecord = await this.fileUploadRepository.findOne({
                  where: { file_id: codingSchemeRefText.toUpperCase() },
                  select: ['data', 'filename']
                });
                if (fileRecord) {
                  scheme = new Autocoder.CodingScheme(JSON.parse(JSON.stringify(fileRecord?.data)));
                }
              } else {
                this.logger.log('--- Kein CodingSchemeRef-Tag gefunden.');
              }
            } catch (error) {
              this.logger.error(`--- Fehler beim Verarbeiten der Datei ${testFile.filename}: ${error.message}`);
            }

            const responses = await this.responseRepository.find({
              where: { unitid: unit.id, status: In(['VALUE_CHANGED']) }
            });
            const codedResponses = responses.map(response => {
              const codedResult = scheme.code([{
                id: response.variableid,
                value: response.value,
                status: response.status as ResponseStatusType
              }]);

              return {
                ...response,
                code: codedResult[0]?.code,
                codedstatus: codedResult[0]?.status,
                score: codedResult[0]?.score
              };
            });

            try {
              await this.responseRepository.save(codedResponses);
              this.logger.log('Die Responses wurden erfolgreich aktualisiert.');
            } catch (error) {
              this.logger.error('Fehler beim Aktualisieren der Responses:', error);
              throw new Error('Fehler beim Speichern der codierten Responses in der Datenbank.');
            }
          }
        }
      }

      return true;
    } catch (error) {
      this.logger.error('Fehler beim Verarbeiten der Personen:', error);
      return false;
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

  async findWorkspaceResponses(workspace_id: number): Promise<ResponseDto[]> {
    this.logger.log('Returning responses for workspace', workspace_id);
    return this.responsesRepository.find({ where: { workspace_id: workspace_id } });
  }

  async getCodingList(): Promise<{
    unit_key: string;
    unit_alias: string;
    login_name: string;
    login_code: string;
    booklet_id: string;
    variable_id: string;
    variable_page: string;
    variable_anchor: string;
    url: string;
  }[]> {
    try {
      const responses = await this.responseRepository.find({
        where: { codedstatus: 'CODING_INCOMPLETE' },
        relations: ['unit', 'unit.booklet', 'unit.booklet.person', 'unit.booklet.bookletinfo']
      });

      const result = responses.map(response => {
        const unit = response.unit;
        const booklet = unit?.booklet;
        const person = booklet?.person;
        const bookletInfo = booklet?.bookletinfo;
        const token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjEsInVzZXJuYW1lIjoicmVpY2hsZWpAZ214LmRlIiwic3ViIjp7ImlkIjoxLCJ1c2VybmFtZSI6InJlaWNobGVqQGdteC5kZSIsImlzQWRtaW4iOnRydWV9LCJ3b3Jrc3BhY2UiOiIzNCIsImlhdCI6MTc0OTAzNzUzMywiZXhwIjoxNzU0MjIxNTMzfQ.4FVfq10u_SbhXCCNXb2edh_SYupW-LZPj09Opb08CS4";

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

      return result;
    } catch (error) {
      this.logger.error(`Error fetching coding list: ${error.message}`);
      return [];
    }
  }

  async validateTestFiles(workspaceId: number): Promise<ValidationData[]> {
    try {
      const testTakers = await this.fileUploadRepository.find({
        where: { workspace_id: workspaceId, file_type: In(['TestTakers', 'Testtakers']) }
      });

      if (!testTakers || testTakers.length === 0) {
        this.logger.warn(`No TestTakers found in workspace with ID ${workspaceId}.`);
        return this.createEmptyValidationData();
      }
      const validationResults = [];
      for (const testTaker of testTakers) {
        const validationResult = await this.processTestTaker(testTaker);
        if (validationResult) {
          validationResults.push(validationResult);
        }
      }
      if (validationResults.length > 0) {
        return validationResults;
      }

      const booklets = await this.fileUploadRepository.find({
        where: { workspace_id: workspaceId, file_type: 'Booklet' }
      });

      if (!booklets || booklets.length === 0) {
        this.logger.warn(`No booklets found in workspace with ID ${workspaceId}.`);
        return this.createEmptyValidationData();
      }

      return this.createEmptyValidationData();
    } catch (error) {
      this.logger.error(`Error during test file validation for workspace ID ${workspaceId}: ${error.message}`, error.stack);
      throw error;
    }
  }

  private createEmptyValidationData(): ValidationData[] {
    return [{
      testTaker: '',
      booklets: { complete: false, missing: [] },
      units: { complete: false, missing: [] },
      schemes: { complete: false, missing: [] },
      definitions: { complete: false, missing: [] },
      player: { complete: false, missing: [] }
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

    const { allBookletsExist, missingBooklets } = await this.checkMissingBooklets(Array.from(uniqueBooklets));
    const {
      allUnitsExist,
      missingUnits,
      missingCodingSchemeRefs,
      missingDefinitionRefs,
      allCodingSchemesExist,
      allCodingDefinitionsExist,
      allPlayerRefsExist,
      missingPlayerRefs
    } = await this.checkMissingUnits(Array.from(uniqueBooklets));

    return {
      testTaker: testTaker.file_id,
      booklets: {
        complete: allBookletsExist,
        missing: missingBooklets
      },
      units: {
        complete: allUnitsExist,
        missing: missingUnits
      },
      schemes: {
        complete: allCodingSchemesExist,
        missing: missingCodingSchemeRefs
      },
      definitions: {
        complete: allCodingDefinitionsExist,
        missing: missingDefinitionRefs
      },
      player: {
        complete: allPlayerRefsExist,
        missing: missingPlayerRefs
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

  async checkMissingBooklets(uniqueBookletsArray: string[]): Promise<{ allBookletsExist: boolean, missingBooklets: string[] }> {
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

      return { allBookletsExist, missingBooklets };
    } catch (error) {
      this.logger.error('Error validating booklets:', error);
      throw error;
    }
  }

  async checkMissingUnits(bookletNames:string[]): Promise< ValidationResult> {
    try {
      const existingBooklets = await this.fileUploadRepository.findBy({
        file_type: 'Booklet',
        file_id: In(bookletNames.map(b => b.toUpperCase()))
      });
      const allUnitIds: string[] = [];
      const allCodingSchemeRefs: string[] = [];
      const allDefinitionRefs: string[] = [];
      const allPlayerRefs: string[] = [];

      for (const booklet of existingBooklets) {
        try {
          const fileData = booklet.data;

          const $ = cheerio.load(fileData, { xmlMode: true });
          $('Unit').each((_, element) => {
            const unitId = $(element).attr('id');

            if (unitId) {
              const upperUnitId = unitId.toUpperCase();
              if (!allUnitIds.includes(upperUnitId)) {
                allUnitIds.push(upperUnitId);
              }
            }
          });
        } catch (error) {
          this.logger.error(`Fehler beim Verarbeiten von Unit ${booklet.file_id}:`, error);
        }
      }

      const chunkSize = 50;
      let existingUnits = [];
      for (let i = 0; i < allUnitIds.length; i += chunkSize) {
        const chunk = allUnitIds.slice(i, i + chunkSize);
        const units = await this.fileUploadRepository.find({
          where: { file_id: In(chunk) }
        });
        existingUnits = existingUnits.concat(units);
      }

      for (const unit of existingUnits) {
        try {
          const fileData = unit.data;
          const $ = cheerio.load(fileData, { xmlMode: true });
          $('Unit').each((_, element) => {
            const codingSchemeRef = $(element).find('CodingSchemeRef').text();
            const definitionRef = $(element).find('DefinitionRef').text();
            const playerRef = $(element).find('DefinitionRef').attr('player')
              .replace('@', '-');

            if (codingSchemeRef && !allCodingSchemeRefs.includes(codingSchemeRef)) {
              allCodingSchemeRefs.push(codingSchemeRef.toUpperCase());
            }

            if (definitionRef && !allDefinitionRefs.includes(definitionRef)) {
              allDefinitionRefs.push(definitionRef.toUpperCase());
            }

            if (playerRef && !allPlayerRefs.includes(playerRef.toUpperCase())) {
              allPlayerRefs.push(playerRef.toUpperCase());
            }
          });
        } catch (error) {
          this.logger.error(`Fehler beim Verarbeiten von Unit ${unit.file_id}:`, error);
        }
      }

      const existingResources = await this.fileUploadRepository.findBy({
        file_type: 'Resource'
      });
      const allResourceIds = existingResources.map(resource => resource.file_id);
      const missingCodingSchemeRefs = allCodingSchemeRefs.filter(ref => !allResourceIds.includes(ref));
      const missingDefinitionRefs = allDefinitionRefs.filter(ref => !allResourceIds.includes(ref));
      const missingPlayerRefs = allPlayerRefs.filter(ref => !allResourceIds.includes(ref));
      const allCodingSchemesExist = missingCodingSchemeRefs.length === 0;
      const allCodingDefinitionsExist = missingDefinitionRefs.length === 0;
      const allPlayerRefsExist = missingPlayerRefs.length === 0;
      const foundUnitIds = existingUnits.map(unit => unit.file_id.toUpperCase());
      const missingUnits = allUnitIds.filter(unitId => !foundUnitIds.includes(unitId.toUpperCase()));
      const uniqueUnits = Array.from(new Set(missingUnits));
      const allUnitsExist = missingUnits.length === 0;
      return {
        allUnitsExist,
        missingUnits: uniqueUnits,
        allCodingSchemesExist,
        allCodingDefinitionsExist,
        missingCodingSchemeRefs,
        missingDefinitionRefs,
        allPlayerRefsExist,
        missingPlayerRefs
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
        throw new Error('Meta-data <script> tag not found');
      }

      const metadata = JSON.parse(metaDataElement.text());
      if (!metadata.id || !metadata.version) {
        throw new Error('Invalid metadata structure: Missing id or version');
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
