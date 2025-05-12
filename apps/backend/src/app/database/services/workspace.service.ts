/* eslint-disable no-restricted-syntax, guard-for-in, no-return-assign, consistent-return */

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import * as cheerio from 'cheerio';
import AdmZip = require('adm-zip');
import * as util from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as libxmljs from 'libxmljs2';
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
import { Result } from './testcenter.service';
import { BookletInfo } from '../entities/bookletInfo.entity';

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
  responses : string,
  laststate : string,
  originalUnitId: string

};

export type Log = {
  groupname:string,
  loginname : string,
  code : string,
  bookletname : string,
  unitname : string,
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
  private cache: Map<string, { data: [Persons[], number]; expiry: number }> = new Map();

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
    private bookletInfoRepository:Repository<BookletInfo>
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
      const ws = await this.workspaceRepository.find({ where: mappedWorkspaces });
      return ws;
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

  async findPersonTestResults(personId: number, workspaceId: number): Promise<any> {
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

      const structuredResults = booklets.map(booklet => {
        const bookletInfo = bookletInfoData.find(info => info.id === booklet.infoid);
        return {
          booklet: {
            id: booklet.id,
            personid: booklet.personid,
            name: bookletInfo.name,
            size: bookletInfo.size,
            units: units
              .filter(unit => unit.bookletid === booklet.id)
              .map(unit => ({
                id: unit.id,
                bookletid: unit.bookletid,
                name: unit.name,
                alias: unit.alias,
                results: unitResultMap.get(unit.id) || []
              }))
          }
        };
      });

      return structuredResults;
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
    const MAX_LIMIT = 100;
    const validPage = Math.max(1, page); // Minimum 1
    const validLimit = Math.min(Math.max(1, limit), MAX_LIMIT); // Zwischen 1 und MAX_LIMIT

    const cacheKey = `${workspace_id}-${validPage}-${validLimit}`;
    const cacheTTL = 5 * 60 * 1000;

    const cachedData = this.cache.get(cacheKey);
    if (cachedData && cachedData.expiry > Date.now()) {
      this.logger.log(`Cache hit for workspace_id=${workspace_id}, page=${validPage}, limit=${validLimit}`);
      return cachedData.data;
    }

    try {
      const [results, total] = await this.personsRepository.findAndCount({
        // where: { workspace_id: workspace_id },
        select: [
          'id',
          'group',
          'login',
          'code',
          'uploaded_at'
        ],
        skip: (validPage - 1) * validLimit,
        take: validLimit
      });

      this.cache.set(cacheKey, { data: [results, total], expiry: Date.now() + cacheTTL });

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

  async findPlayer(workspaceId: number, playerName: string): Promise<FilesDto[]> {
    console.log('workspaceId', workspaceId);
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

  async findUnitResponse(workspaceId:number, connector: string, unitId: string): Promise<any> {
    const [group, code, rest] = connector.split('@');
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
    const responses = await this.responsesRepository.find({ where: { workspace_id: workspace_id } });
    return responses;
  }

  async validateTestFiles(workspaceId: number): Promise<ValidationData[]> {
    try {
      const testTakers = await this.fileUploadRepository.find({
        where: { workspace_id: workspaceId, file_type: 'TestTakers' }
      });

      if (!testTakers || testTakers.length === 0) {
        this.logger.warn(`No TestTakers found in workspace with ID ${workspaceId}.`);
        return this.createEmptyValidationData();
      }
      const validationResults = [];
      for (const testTaker of testTakers) {
        // eslint-disable-next-line no-await-in-loop
        const validationResult = await this.processTestTaker(testTaker);
        if (validationResult) {
          validationResults.push(validationResult);
        }
      }
      if (validationResults.length > 0) {
        return validationResults;
      }

      // Nach Booklets im Workspace suchen, falls keine validen TestTakers gefunden wurden
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

  // eslint-disable-next-line class-methods-use-this
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
    console.log('uniqueBooklets', uniqueBooklets);

    const { allBookletsExist, missingBooklets } = await this.checkMissingBooklets(Array.from(uniqueBooklets));
    console.log('allBookletsExist', allBookletsExist);
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

  // eslint-disable-next-line class-methods-use-this
  private extractXmlData(
    bookletTags: cheerio.Cheerio<any>,
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

      $('unit').each((_, codingScheme) => {
        const value = $(codingScheme).text().trim();
        if (value) codingSchemeRefs.push(value);
      });

      $('DefinitionRef').each((_, definition) => {
        const value = $(definition).text().trim();
        if (value) definitionRefs.push(value);
      });

      const unitId = $('unit').attr('id');
      if (unitId) {
        uniqueUnits.add(unitId.trim());
      }
    });
    console.log('uniqueUnits', uniqueUnits);

    return {
      uniqueBooklets, uniqueUnits, codingSchemeRefs, definitionRefs
    };
  }

  async findUnit(workspace_id: number, testPerson:string, unitId:string): Promise<FileUpload[]> {
    this.logger.log('Returning unit for test person', testPerson);
    const response = await this.fileUploadRepository.find(
      { where: { file_id: `${unitId}`, workspace_id: workspace_id } });
    return response;
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

  async deleteTestGroups(workspaceId: string, testGroupNames: string[]): Promise<boolean> {
    this.logger.log('Delete test groups for workspace ', workspaceId);
    const mappedTestGroups = testGroupNames.map(testGroup => ({ test_group: testGroup }));
    const testGroupResponsesData = await this.responsesRepository
      .find({ where: mappedTestGroups, select: ['id'] });
    const ids = testGroupResponsesData.map(item => item.id);
    const chunkSize = 10;
    const deletePromises = [];
    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize);
      const deletePromise = this.responsesRepository.delete(chunk);
      deletePromises.push(deletePromise);
    }
    const res = await Promise.all(deletePromises);
    return !!res;
  }

  async findTestPersons(id: number, testGroup:string): Promise<string[]> {
    this.logger.log('Returning ind all test persons for test group ', testGroup);
    const response = await this.responsesRepository
      .find({
        select: ['test_person'],
        where: { test_group: testGroup },
        order: { test_person: 'ASC' }
      });
    if (response) {
      return Array.from(new Set(response.map(item => item.test_person)));
    }
    return [];
  }

  // Todo: This gets unitIds of responses
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

  private static getTestPersonName(unitResponse: Response | Log): string {
    return `${unitResponse.loginname}@${unitResponse.code}@${unitResponse.bookletname}`;
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

    // Batch size
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

      // Log details of failed uploads for better debugging
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

      // Return 'true' only if all files were uploaded successfully
      return failedFiles.length === 0;
    } catch (error) {
      this.logger.error(`Unexpected error while uploading files for workspace ${workspace_id}:`, error);
      throw error; // Re-throw the error to propagate it further
    }
  }

  handleFile(workspaceId: number, file: FileIo): Array<Promise<unknown>> {
    const filePromises: Array<Promise<unknown>> = [];
    console.log('file', file);

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

    // Validierung des XML-Dokuments gegen das Schema
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

      this.logger.log(`Root tag detected: ${rootTagName}`);

      const fileTypeMapping: Record<string, string> = {
        UNIT: 'Unit',
        BOOKLET: 'Booklet',
        TESTTAKERS: 'TestTakers'
      };

      const fileType = fileTypeMapping[rootTagName];
      if (!fileType) {
        return await this.unsupportedFile(`Unsupported root tag: ${rootTagName}`);
      }
      console.log('Current working directory:', process.cwd(), __dirname);

      const schemaPaths: Record<string, string> = {
        UNIT: path.resolve(__dirname, './schemas/unit.xsd'),
        BOOKLET: path.resolve(__dirname, './schemas/booklet.xsd'),
        TESTTAKERS: path.resolve(__dirname, '.testtakers.xsd')
      };

      // const xsdPath = schemaPaths[rootTagName];
      // if (!xsdPath || !fs.existsSync(xsdPath)) {
      //   return await this.unsupportedFile(`No XSD schema found for root tag: ${rootTagName}`);
      // }

      // await this.validateXmlAgainstSchema(xmlContent, xsdPath);

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
          // Skip directories as they do not contain data-related content
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
      const allCodingSchemeRefs: any[] = [];
      const allDefinitionRefs: any[] = [];
      const allPlayerRefs: any[] = [];

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
            const unitId = $(element).attr('id');
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
      // console.log('existingResources', existingResources);
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

  async testCenterImport(entries: FileUpload[]): Promise<boolean> {
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

      // Load the string into Cheerio for HTML parsing.
      const playerContent = cheerio.load(playerCode);

      // Search for JSON+LD <script> tags in the parsed DOM.
      const metaDataElement = playerContent('script[type="application/ld+json"]');
      if (!metaDataElement.length) {
        throw new Error('Meta-data <script> tag not found');
      }

      // Parse JSON data from the <script> tag content.
      const metadata = JSON.parse(metaDataElement.text());
      if (!metadata.id || !metadata.version) {
        throw new Error('Invalid metadata structure: Missing id or version');
      }

      // Normalize and return the player ID using metadata.
      return WorkspaceService.normalizePlayerId(`${metadata.id}-${metadata.version}`);
    } catch (error) {
      console.error('Error in getPlayerId:', error.message);

      return WorkspaceService.getResourceId(file);
    }
  }

  private static getResourceId(file: FileIo): string {
    if (!file?.originalname) {
      throw new Error('Invalid file: originalname is required.');
    }
    const filePathParts = file.originalname.split('/')
      .map(part => part.trim());
    // Extract the file name from the last part of the path
    const fileName = filePathParts.pop();
    if (!fileName) {
      throw new Error('Invalid file: Could not determine the file name.');
    }
    return fileName.toUpperCase();
  }

  private static normalizePlayerId(name: string): string {
    // Regular expression explanation:
    // 1. Module prefix: (\D+?) - Matches non-digits (at least once, as few as possible).
    // 2. Optional separator + version detail:
    //    [@V-]?((\d+)(\.\d+)?(\.\d+)?(-\S+?)?)?
    //    - [@V-]: Optional separator.
    //    - (\d+): Major version (digits).
    //    - (\.\d+)?: Optional minor version (preceded by a dot).
    //    - (\.\d+)?: Optional patch version (preceded by a dot).
    //    - (-\S+?)?: Optional label starting with a dash.
    // 3. Optional suffix: (.\D{3,4})? - Matches a single character followed by 3-4 letters.
    const reg = /^(\D+?)[@V-]?((\d+)(\.\d+)?(\.\d+)?(-\S+?)?)?(.\D{3,4})?$/;

    const matches = name.match(reg);

    if (!matches) {
      throw new Error(`Invalid player name: ${name}`);
    }

    const [, module = '', full = '', major = '', minorDot = '', patchDot = '', labelWithDash = ''] = matches;

    // Parse numeric values and remove prefixes where necessary.
    const majorVersion = parseInt(major, 10) || 0;
    const minorVersion = minorDot ? parseInt(minorDot.substring(1), 10) : 0; // Remove leading dot.
    const patchVersion = patchDot ? parseInt(patchDot.substring(1), 10) : 0; // Remove leading dot.
    const label = labelWithDash ? labelWithDash.substring(1) : ''; // Remove leading dash.

    // Construct normalized player ID.
    const normalizedId = `${module}-${majorVersion}.${minorVersion}`.toUpperCase();
    return normalizedId;
  }
}
