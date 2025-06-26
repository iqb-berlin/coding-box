import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import FileUpload from '../entities/file_upload.entity';
import { FilesDto } from '../../../../../../api-dto/files/files.dto';
import Persons from '../entities/persons.entity';
import { ResponseEntity } from '../entities/response.entity';

@Injectable()
export class WorkspacePlayerService {
  private readonly logger = new Logger(WorkspacePlayerService.name);

  constructor(
    @InjectRepository(FileUpload)
    private fileUploadRepository: Repository<FileUpload>,
    @InjectRepository(Persons)
    private personsRepository: Repository<Persons>,
    @InjectRepository(ResponseEntity)
    private responseRepository: Repository<ResponseEntity>

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
      // Parse the player name to extract module and major version
      const playerNameUpperCase = playerName.toUpperCase();
      const regex = /^(\D+)-(\d+)\.(\d+)$/;
      const matches = playerNameUpperCase.match(regex);

      if (matches) {
        const module = matches[1];
        const majorVersion = matches[2];

        // Always search for all players with the same module and major version
        const similarPlayers = await this.fileUploadRepository
          .createQueryBuilder('file')
          .where('file.workspace_id = :workspaceId', { workspaceId })
          .andWhere('file.file_id LIKE :pattern', { pattern: `${module}-${majorVersion}.%` })
          .getMany();

        if (similarPlayers.length > 0) {
          this.logger.log(`Found ${similarPlayers.length} player(s) with module ${module} and major version ${majorVersion} in workspace ${workspaceId}`);

          // Sort by minor version (descending) and return the highest one
          similarPlayers.sort((a, b) => {
            const minorA = parseInt(a.file_id.split('.')[1], 10);
            const minorB = parseInt(b.file_id.split('.')[1], 10);
            return minorB - minorA; // Descending order
          });

          this.logger.log(`Automatically selecting player with highest minor version: ${similarPlayers[0].file_id}`);
          return [similarPlayers[0]];
        }
      }

      // If no players with the same module and major version were found, try to find an exact match
      const files = await this.fileUploadRepository.find({
        where: {
          file_id: playerNameUpperCase,
          workspace_id: workspaceId
        }
      });

      if (files.length > 0) {
        this.logger.log(`Found ${files.length} file(s) for player '${playerName}' in workspace ${workspaceId}`);
        return files;
      }

      this.logger.warn(`No files found for player '${playerName}' in workspace ${workspaceId}`);
      return [];
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

  async findUnit(workspace_id: number, unitId: string): Promise<FileUpload[]> {
    this.logger.log('Returning unit for unitId', unitId);
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

  async findTestPersonUnits(id: number, testPerson: string): Promise<ResponseEntity[]> {
    this.logger.log('Returning all unit Ids for testperson ', testPerson);
    const res = this.responseRepository
      .find({
        select: ['unitid'],
        //where: { testPerson: testPerson },
        order: { unitid: 'ASC' }
      });
    if (res) {
      return res;
    }
    return [];
  }
}
