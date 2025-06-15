import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import FileUpload from '../entities/file_upload.entity';
import { FilesDto } from '../../../../../../api-dto/files/files.dto';
import { Unit } from '../entities/unit.entity';
import { Booklet } from '../entities/booklet.entity';
import Persons from '../entities/persons.entity';
import { ResponseDto } from '../../../../../../api-dto/responses/response-dto';
import Responses from '../entities/responses.entity';

@Injectable()
export class WorkspacePlayerService {
  private readonly logger = new Logger(WorkspacePlayerService.name);

  constructor(
    @InjectRepository(FileUpload)
    private fileUploadRepository: Repository<FileUpload>,
    @InjectRepository(Unit)
    private unitRepository: Repository<Unit>,
    @InjectRepository(Booklet)
    private bookletRepository: Repository<Booklet>,
    @InjectRepository(Persons)
    private personsRepository: Repository<Persons>,
    @InjectRepository(Responses)
    private responsesRepository: Repository<Responses>
  ) {}

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

  async findUnit(workspace_id: number, testPerson: string, unitId: string): Promise<FileUpload[]> {
    this.logger.log('Returning unit for test person', testPerson);
    return this.fileUploadRepository.find(
      { where: { file_id: `${unitId}`, workspace_id: workspace_id } });
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

  async findTestPersonUnits(id: number, testPerson: string): Promise<ResponseDto[]> {
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
}
