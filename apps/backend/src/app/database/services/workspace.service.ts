/* eslint-disable no-restricted-syntax, guard-for-in, no-return-assign, consistent-return */

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as cheerio from 'cheerio';
import AdmZip = require('adm-zip');
import * as util from 'util';
import * as fs from 'fs';
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

  async findResponse(workspace_id: number, testPerson:string, unitId:string): Promise<Responses[]> {
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

  async findTestPersonUnits(id: number, testPerson:string): Promise<Responses[]> {
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
      .split('\n');
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
    const filePromises = [];
    originalFiles.forEach(file => {
      if (file.mimetype === 'text/xml') {
        const xmlDocument = cheerio.load(file.buffer.toString(), {
          xmlMode: true,
          recognizeSelfClosing: true
        });

        filePromises.push(this.fileUploadRepository.save({
          filename: file.originalname,
          workspace_id: workspace_id,
          file_type: 'Unit',
          file_size: file.size,
          data: xmlDocument.html()
        }));
      }
      if (file.mimetype === 'text/html') {
        filePromises.push(this.fileUploadRepository.save({
          filename: file.originalname,
          workspace_id: workspace_id,
          file_type: 'Resource',
          file_size: file.size,
          data: originalFiles[0].buffer.toString()
        }));
      }
      if (file.mimetype === 'application/octet-stream') {
        const json = originalFiles[0].buffer.toString();
        filePromises.push(this.fileUploadRepository.save({
          filename: file.originalname,
          workspace_id: workspace_id,
          file_type: 'Resource',
          file_size: file.size,
          data: json
        }));
      }
      if (file.mimetype === 'application/zip' ||
        file.mimetype === 'application/x-zip-compressed' ||
        file.mimetype === 'application/x-zip') {
        const zip = new AdmZip(file.buffer);
        const packageFiles = zip.getEntries().map(entry => entry.entryName);
        const resourcePackagesPath = './packages';
        const packageName = 'GeoGebra';
        const zipExtractAllToAsync = util.promisify(zip.extractAllToAsync);
        return zipExtractAllToAsync(`${resourcePackagesPath}/${packageName}`, true, true)
          .then(async () => {
            const newResourcePackage = this.resourcePackageRepository.create({
              name: packageName,
              elements: packageFiles,
              createdAt: new Date()
            });
            await this.resourcePackageRepository.save(newResourcePackage);
            fs.writeFileSync(
              `${resourcePackagesPath}/${packageName}/${file.originalname}`,
              file.buffer
            );
            return newResourcePackage.id;
          })
          .catch(error => {
            throw new Error(error.message);
          });
      }

      if (file.mimetype === 'text/csv') {
        const rows = WorkspaceService.csvToArr(file.buffer.toString());
        const mappedRows: Array<Responses> = rows.map((row: Response) => {
          const testPerson = `${row.loginname}${row.code}`;
          const groupName = `${row.groupname}`.replace(/"/g, '');
          const unitId = row.unitname;
          const responseChunksCleaned = row.responses
            .replace(/""/g, '"');
          const responsesChunks = JSON.parse(responseChunksCleaned);
          return (<Responses>{
            test_person: testPerson,
            unit_id: unitId.toUpperCase(),
            responses: responsesChunks,
            test_group: groupName,
            workspace_id: workspace_id
          });
        });
        filePromises.push(this.responsesRepository.save(mappedRows));
        return file;
      }
    });
    const res = await Promise.all(filePromises);
    return !!res;
  }

  async testCenterImport(entries:FileUpload[]): Promise<boolean> {
    const registry = this.fileUploadRepository.create(entries);
    const res = await this.fileUploadRepository.save(registry);
    return !!res;
  }
}
