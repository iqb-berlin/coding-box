import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ArgumentOutOfRangeError } from 'rxjs';
import * as cheerio from 'cheerio';
import Workspace from '../entities/workspace.entity';
import { WorkspaceInListDto } from '../../../../../frontend/api-dto/workspaces/workspace-in-list-dto';
import { WorkspaceFullDto } from '../../../../../frontend/api-dto/workspaces/workspace-full-dto';
import { CreateWorkspaceDto } from '../../../../../frontend/api-dto/workspaces/create-workspace-dto';
import { AdminWorkspaceNotFoundException } from '../../exceptions/admin-workspace-not-found.exception';
import FileUpload from '../entities/file_upload.entity';
import { FilesDto } from '../../../../../frontend/api-dto/files/files.dto';
import Responses from '../entities/responses.entity';
import { ResourcePackageService } from './resource-package.service';

export type Response = {
  groupname:string,
  loginname : string,
  code : string,
  bookletname : string,
  unitname : string,
  responses : string,
  laststate : string,
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
    private resourcePackageService: ResourcePackageService
  ) {
  }

  async findAll(userId?: number): Promise<WorkspaceInListDto[]> {
    this.logger.log('Returning all workspace groups.');
    const workspaces = await this.workspaceRepository.find({});
    return workspaces.map(workspace => ({ id: workspace.id, name: workspace.name }));
  }

  async findFiles(id: number): Promise<FilesDto[]> {
    this.logger.log('Returning all files for workspace', id);
    const files = await this.fileUploadRepository.find({});
    return files;
  }

  async findPlayer(id: number): Promise<FilesDto[]> {
    this.logger.log('Returning player for workspace', id);
    const files = await this.fileUploadRepository.find({ where: { filename: 'IQB-PLAYER-ASPECT-2.4' } });
    return files;
  }

  async findUnitDef(unitId: string): Promise<FilesDto[]> {
    this.logger.log('Returning unit def for unit', unitId);
    const files = await this.fileUploadRepository.find({ where: { filename: `${unitId}.VOUD` } });
    return files;
  }

  async findResponse(id: number, testPerson:string, unitId:string): Promise<Responses[]> {
    this.logger.log('Returning response for test person', testPerson);
    const response = await this.responsesRepository.find(
      { where: { test_person: testPerson, unit_id: unitId } });
    return response;
  }

  async findTestGroups(id: number): Promise<any> {
    this.logger.log('Returning all test groups for workspace ', id);
    const response = await this.responsesRepository.find({ select: ['test_group'] });
    return Array.from(new Set(response.map(item => item.test_group)));
  }

  async findTestPersons(id: number, testGroup:string): Promise<any> {
    this.logger.log('Returning ind all test persons for test group ', testGroup);
    const response = await this.responsesRepository.find({ select: ['test_person'], where: { test_group: testGroup } });
    return Array.from(new Set(response.map(item => item.test_person)));
  }

  async findTestPersonUnits(id: number, testPerson:string): Promise<any> {
    this.logger.log('Returning all unit Ids for testperson ', testPerson);
    return this.responsesRepository.find({ where: { test_person: testPerson }, select: ['unit_id'] });
  }

  async findOne(id: number): Promise<WorkspaceFullDto> {
    this.logger.log(`Returning workspace with id: ${id}`);
    const workspaceGroup = await this.workspaceRepository.findOne({
      where: { id: id },
      select: { id: true, name: true, settings: true }
    });
    if (workspaceGroup) {
      return <WorkspaceFullDto>{
        id: workspaceGroup.id,
        name: workspaceGroup.name,
        settings: workspaceGroup.settings
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
    } else {
      throw new ArgumentOutOfRangeError();
    }
  }

  async remove(id: number[]): Promise<void> {
    this.logger.log(`Deleting workspaces with ids: ${id.join(', ')}`);
    await this.workspaceRepository.delete(id);
  }

  static csvToArr(stringVal, splitter) {
    const [keys, ...rest] = stringVal
      .trim()
      .split('\n')
      .map(item => item.split(splitter));
    return rest.map(item => {
      const object = {};
      keys.forEach((key, index) => (object[key] = (item.at(index)).replace('""', '"').replace('"', '')));
      return object;
    });
  }

  async uploadTestFiles(id: number, originalFiles: BufferSource, file:any): Promise<any> {
    if (originalFiles[0].mimetype === 'text/xml') {
      const xmlDocument = cheerio.load(originalFiles[0].buffer.toString(), {
        xmlMode: true,
        recognizeSelfClosing: true
      });
      const registry = this.fileUploadRepository.create(
        { filename: originalFiles[0].originalname, workspace_id: 2, data: xmlDocument.html() });
      await this.fileUploadRepository.save(registry);
    }
    if (originalFiles[0].mimetype === 'text/html') {
      const registry = this.fileUploadRepository.create(
        { filename: originalFiles[0].originalname, workspace_id: 2, data: originalFiles[0].buffer.toString() });
      await this.fileUploadRepository.save(registry);
    }
    if (originalFiles[0].mimetype === 'application/octet-stream') {
      const json = originalFiles[0].buffer.toString();
      const registry = this.fileUploadRepository.create(
        { filename: originalFiles[0].originalname, workspace_id: 2, data: json });
      await this.fileUploadRepository.save(registry);
    }
    if (originalFiles[0].mimetype === 'application/zip') {
      const json = originalFiles[0].buffer.toString();
      const registry = this.fileUploadRepository.create(
        { filename: originalFiles[0].originalname, workspace_id: 2, data: json });
      await this.fileUploadRepository.save(registry);
    }

    if (originalFiles[0].mimetype === 'text/csv') {
      const rows = WorkspaceService.csvToArr(originalFiles[0].buffer.toString(), ';');
      const mappedRows = rows.map((row: Response) => {
        const testPerson = `${row.loginname}${row.code}`.replace(/"/g, '');
        const groupName = `${row.groupname}`.replace(/"/g, '');
        const unitId = row.unitname.replace(/"/g, '');
        const responses = row.responses.slice(0, -1).replace(/""/g, '"');

        return ({
          test_person: testPerson,
          unit_id: unitId,
          responses: responses,
          test_group: groupName
        });
      });

      const registry = this.responsesRepository.create(mappedRows);
      await this.responsesRepository.save(registry);
    }
  }

  async testcenterImport(entries:any): Promise<any> {
    console.log(entries);
    const registry = this.fileUploadRepository.create(entries);
    await this.fileUploadRepository.save(registry);
  }
}
