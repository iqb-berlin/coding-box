/* eslint-disable no-restricted-syntax, guard-for-in, no-return-assign, consistent-return */

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as cheerio from 'cheerio';
import AdmZip = require('adm-zip');
import * as util from 'util';
import * as fs from 'fs';
import * as path from 'path';
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
import Persons from '../entities/persons.entity';

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
    private personsRepository:Repository<Persons>

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

  async findFiles(workspace_id: number): Promise<FilesDto[]> {
    this.logger.log('Returning all test files for workspace ', workspace_id);
    return this.fileUploadRepository
      .find({
        where: { workspace_id: workspace_id },
        select: ['id', 'filename', 'file_size', 'file_type', 'created_at']
      });
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
        skip: (validPage - 1) * validLimit,
        take: validLimit
      });

      // save results in cache
      this.cache.set(cacheKey, { data: [results, total], expiry: Date.now() + cacheTTL });

      return [results, total];
    } catch (error) {
      this.logger.error(`Failed to fetch test results for workspace_id ${workspace_id}: ${error.message}`, error.stack);
      throw new Error('An error occurred while fetching test results');
    }
  }

  async findUsers(workspace_id: number): Promise<WorkspaceUser[]> {
    this.logger.log('Returning all users for workspace ', workspace_id);
    return this.workspaceUsersRepository
      .find({
        where: { workspaceId: workspace_id }
      });
  }

  async deleteTestFiles(workspace_id:number, fileIds: string[]): Promise<boolean> {
    this.logger.log(`Delete test files for workspace ${workspace_id}`);
    const res = await this.fileUploadRepository.delete(fileIds);
    return !!res;
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

  async findResponse(workspace_id: number, testPerson:string, unitId:string): Promise<ResponseDto[]> {
    this.logger.log('Returning response for test person', testPerson);
    const [group, code, booklet] = testPerson.split('@');

    const person = await this.personsRepository.find(
      { where: { group: group, code: code } });
    if (person) {
      const booklets : any = person[0].booklets;
      const foundBooklet = booklets.find((b: any) => b.id === booklet);
      const unit = foundBooklet.units.find((u: any) => u.id === unitId);
      const elementCodesChunk = unit.chunks.find((c: any) => c.id === 'elementCodes');
      const content = JSON.stringify(unit.subforms[0].responses);
      const response = {
        id: elementCodesChunk.id,
        responseType: elementCodesChunk.type,
        ts: elementCodesChunk.ts,
        content: content
      };
      return [{
        id: 5,
        test_person: '',
        unit_id: '',

        test_group: '',

        workspace_id: 1,

        created_at: new Date(),

        responses:
          [response],

        booklet_id: ''
      }];
    }
    return [];
  }

  async findWorkspaceResponses(workspace_id: number): Promise<ResponseDto[]> {
    this.logger.log('Returning responses for workspace', workspace_id);
    const responses = await this.responsesRepository.find({ where: { workspace_id: workspace_id } });
    return responses;
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

  private async handleXmlFile(workspaceId: number, file: FileIo): Promise<unknown> {
    const xmlDocument = cheerio.load(file.buffer.toString(), {
      xmlMode: true,
      recognizeSelfClosing: true
    });

    const rootTagName = xmlDocument.root().children().first().prop('tagName');

    if (rootTagName === 'UNIT') {
      const fileId = xmlDocument.root().find('Metadata').find('Id').text()
        .toUpperCase()
        .trim();
      return this.fileUploadRepository.upsert({
        filename: file.originalname,
        workspace_id: workspaceId,
        file_type: 'Unit',
        file_size: file.size,
        data: file.buffer.toString(),
        file_id: fileId
      }, ['file_id']);
    }

    return Promise.resolve();
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
      file_id: resourceId, // TODO: Ensure case insensitivity if required
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
