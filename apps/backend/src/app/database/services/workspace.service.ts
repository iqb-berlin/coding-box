/* eslint-disable no-restricted-syntax, guard-for-in, no-return-assign, consistent-return */

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as cheerio from 'cheerio';
import AdmZip = require('adm-zip');
import * as util from 'util';
import * as fs from 'fs';
import * as csv from 'fast-csv';
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

function sanitizePath(filePath: string): string {
  if (filePath.indexOf('..') !== -1) {
    throw new Error('Invalid file path');
  }
  return filePath;
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

export type File = {
  filename: string,
  file_id: string,
  file_type: string,
  file_size: number,
  workspace_id: string,
  data: string
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
    private usersRepository:Repository<User>
  ) {
  }

  async findAll(): Promise<WorkspaceInListDto[]> {
    this.logger.log('Returning all workspace groups.');
    const workspaces = await this.workspaceRepository.find({});
    return workspaces.map(workspace => ({ id: workspace.id, name: workspace.name }));
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

  async findPlayer(workspace_id: number, playerName:string): Promise<FilesDto[]> {
    this.logger.log(`Returning ${playerName} for workspace`, workspace_id);
    const files = await this.fileUploadRepository
      .find({ where: { file_id: playerName.toUpperCase(), workspace_id: workspace_id } });
    return files;
  }

  async findUnitDef(workspace_id:number, unitId: string): Promise<FilesDto[]> {
    this.logger.log('Returning unit def for unit', unitId);
    const files = await this.fileUploadRepository
      .find({ where: { file_id: `${unitId}.VOUD`, workspace_id: workspace_id } });
    return files;
  }

  async findResponse(workspace_id: number, testPerson:string, unitId:string): Promise<ResponseDto[]> {
    this.logger.log('Returning response for test person', testPerson);
    const response = await this.responsesRepository.find(
      { where: { test_person: testPerson, unit_id: unitId, workspace_id: workspace_id } });
    return response;
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

  private static getTestPersonName(unitResponse: Response): string {
    return `${unitResponse.loginname}@${unitResponse.code}@${unitResponse.bookletname}`;
  }

  async create(workspace: CreateWorkspaceDto): Promise<number> {
    this.logger.log(`Creating workspace with name: ${workspace.name}`);
    const newWorkspace = this.workspaceRepository.create(workspace);
    await this.workspaceRepository.save(newWorkspace);
    return newWorkspace.id;
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

  async remove(id: number[]): Promise<void> {
    this.logger.log(`Deleting workspaces with ids: ${id.join(', ')}`);
    await this.workspaceRepository.delete(id);
  }

  static csvToArr(stringVal: string) {
    const rows = stringVal
      .trim()
      .split(/\r\n?|\n/);
    const headers = rows.shift().split(';');
    return rows.map(item => {
      const object = {};
      const row = item.split('";"');
      headers
        .forEach((key, index) => (object[key] = row[index]));
      return object;
    });
  }

  async uploadTestFiles(workspace_id: number, originalFiles: FileIo[]): Promise<boolean> {
    const filePromises =
      originalFiles.map(file => this.handleFile(workspace_id, file));
    const res = await Promise.all(filePromises);
    return !!res;
  }

  handleFile(workspaceId: number, file: FileIo): Array<Promise<unknown>> {
    const filePromises: Array<Promise<unknown>> = [];

    if (file.mimetype === 'text/xml') {
      const xmlDocument = cheerio.load(file.buffer.toString(), {
        xmlMode: true,
        recognizeSelfClosing: true
      });

      const rootTagName = xmlDocument.root().children().first().prop('tagName');

      if (rootTagName === 'UNIT') {
        const fileId = xmlDocument.root().find('Metadata').find(('Id')).text()
          .toUpperCase()
          .trim();

        filePromises.push(this.fileUploadRepository.upsert({
          filename: file.originalname,
          workspace_id: workspaceId,
          file_type: 'Unit',
          file_size: file.size,
          data: file.buffer.toString(),
          file_id: fileId
        }, ['file_id']));
      }
    }
    if (file.mimetype === 'text/html') {
      const resourceFileId = WorkspaceService.getPlayerId(file);
      filePromises.push(this.fileUploadRepository.upsert({
        filename: file.originalname,
        workspace_id: workspaceId,
        file_type: 'Resource',
        file_size: file.size,
        file_id: resourceFileId,
        data: file.buffer.toString()
      }, ['file_id']));
    }
    if (file.mimetype === 'application/octet-stream') {
      filePromises.push(this.fileUploadRepository.upsert({
        filename: file.originalname,
        workspace_id: workspaceId,
        file_id: WorkspaceService.getResourceId(file), // TODO: why? Should be case insensitive
        file_type: 'Resource',
        file_size: file.size,
        data: file.buffer.toString()
      }, ['file_id']));
    }
    if (file.mimetype === 'application/zip' ||
      file.mimetype === 'application/x-zip-compressed' ||
      file.mimetype === 'application/x-zip'
    ) {
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
            fs.writeFileSync(
              `${resourcePackagesPath}/${packageName}/${sanitizedFileName}`,
              file.buffer
            );
            return newResourcePackage.id;
          })
        );
      } else {
        const zipEntries = zip.getEntries();
        zipEntries.forEach(zipEntry => {
          const fileContent = zipEntry.getData();
          const sanitizedEntryName = sanitizePath(zipEntry.entryName);

          filePromises.push(Promise.all(this.handleFile(workspaceId, <FileIo>{
            fieldname: file.fieldname,
            originalname: `${sanitizedEntryName}`,
            encoding: file.encoding,
            mimetype: WorkspaceService.getMimeType(sanitizedEntryName),
            buffer: fileContent,
            size: fileContent.length
          })));
        });
      }
    }

    if (file.mimetype === 'text/csv') {
      const rowData: Response[] = [];
      fs.writeFile('responses.csv', file.buffer, 'binary', err => {
        if (err) {
          throw new Error('Failed to write file');
        } else {
          const stream = fs.createReadStream('responses.csv');
          csv.parseStream(stream, { headers: true, delimiter: ';' })
            .on('error', error => { this.logger.log(error); }).on('data', row => rowData.push(row))
            .on('end', () => {
              fs.unlinkSync('responses.csv');
              const mappedRowData = rowData.map(row => {
                const responseChunksCleaned = row.responses.replace(/""/g, '"');
                const responsesChunks = JSON.parse(responseChunksCleaned);
                const lastStateCleaned = row.laststate && row.laststate.length > 1 ? row.laststate
                  .replace(/""/g, '"')
                  .replace(/"$/, '') : '{}';
                let unitState;
                try {
                  unitState = JSON.parse(lastStateCleaned);
                } catch (e) {
                  this.logger.error('Error parsing last state', row.laststate);
                  unitState = {};
                }
                return {
                  test_person: WorkspaceService.getTestPersonName(row),
                  unit_id: row.unitname,
                  responses: responsesChunks,
                  test_group: row.groupname,
                  workspace_id: workspaceId,
                  unit_state: unitState,
                  booklet_id: row.bookletname,
                  id: undefined,
                  created_at: undefined
                };
              });
              const cleanedRows = WorkspaceService.cleanResponses(mappedRowData);
              cleanedRows.forEach(row => filePromises.push(
                this.responsesRepository.upsert(row, ['test_person', 'unit_id'])));
            });
        }
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

  async testCenterImport(entries:FileUpload[]): Promise<boolean> {
    const registry = this.fileUploadRepository.create(entries);
    const res = await this.fileUploadRepository.upsert(registry, ['file_id']);
    return !!res;
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
      const metaData = playerContent.root()
        .find('script[type="application/ld+json"]');
      const metadata = JSON.parse(metaData.text());
      return WorkspaceService.normalizePlayerId(`${metadata.id}-${metadata.version}`);
    } catch (e) {
      return WorkspaceService.getResourceId(file);
    }
  }

  private static getResourceId(file: FileIo): string {
    const filePathParts = file.originalname.split('/');
    const fileName = filePathParts.pop();
    return fileName.toUpperCase();
  }

  private static normalizePlayerId(name: string): string {
    const reg = /^(\D+?)[@V-]?((\d+)(\.\d+)?(\.\d+)?(-\S+?)?)?(.\D{3,4})?$/;
    const matches = name.match(reg);
    if (matches) {
      const rawIdParts = {
        module: matches[1] || '',
        full: matches[2] || '',
        major: parseInt(matches[3], 10) || 0,
        minor: (typeof matches[4] === 'string') ? parseInt(matches[4].substring(1), 10) : 0,
        patch: (typeof matches[5] === 'string') ? parseInt(matches[5].substring(1), 10) : 0,
        label: (typeof matches[6] === 'string') ? matches[6].substring(1) : ''
      };
      return `${rawIdParts.module}-${rawIdParts.major}.${rawIdParts.minor}`.toUpperCase();
    }
    throw new Error('Invalid player name');
  }
}
