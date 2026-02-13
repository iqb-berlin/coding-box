import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { parseStringPromise } from 'xml2js';
import FileUpload from '../../entities/file_upload.entity';
import { FilesDto } from '../../../../../../../api-dto/files/files.dto';
import Persons from '../../entities/persons.entity';
import { ResponseEntity } from '../../entities/response.entity';

export interface BookletUnit {
  id: number;
  name: string;
  alias: string | null;
  bookletId: number;
}

interface IndexTracker {
  currentIndex: number;
}

interface XmlElementWithAttributes {
  $?: {
    id?: string;
    alias?: string;
    label?: string;
  };
}

interface BookletElement {
  Unit?: XmlElementWithAttributes[];
  Testlet?: TestletElement[];
  $?: {
    id?: string;
  };
}

interface TestletElement extends BookletElement {
  // Testlet extends BookletElement to allow for nested testlets
}

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

  async findPlayer(
    workspaceId: number,
    playerName: string
  ): Promise<FilesDto[]> {
    if (!workspaceId || typeof workspaceId !== 'number') {
      this.logger.error(`Invalid workspaceId provided: ${workspaceId}`);
      throw new Error('Invalid workspaceId parameter');
    }

    if (!playerName || typeof playerName !== 'string') {
      this.logger.error(`Invalid playerName provided: ${playerName}`);
      throw new Error('Invalid playerName parameter');
    }

    this.logger.log(
      `Attempting to retrieve files for player '${playerName}' in workspace ${workspaceId}`
    );

    try {
      // Parse the player name to extract module, major, minor, and optional patch version
      const playerNameUpperCase = playerName.toUpperCase();
      const regex = /^(.+?)-(\d+)\.(\d+)(?:\.(\d+))?$/;
      const matches = playerNameUpperCase.match(regex);

      if (matches) {
        const module = matches[1];
        const majorVersion = matches[2];
        const minorVersion = matches[3];
        const exactMinorPlayers = await this.fileUploadRepository
          .createQueryBuilder('file')
          .where('file.workspace_id = :workspaceId', { workspaceId })
          .andWhere(
            '(file.file_id LIKE :patternWithPatch OR file.file_id = :exactTwoPart)',
            {
              patternWithPatch: `${module}-${majorVersion}.${minorVersion}.%`,
              exactTwoPart: `${module}-${majorVersion}.${minorVersion}`
            }
          )
          .getMany();

        if (exactMinorPlayers.length > 0) {
          this.logger.log(
            `Found ${exactMinorPlayers.length} player(s) with exact match ${module}-${majorVersion}.${minorVersion}.x in workspace ${workspaceId}`
          );
          exactMinorPlayers.sort((a, b) => {
            const partsA = a.file_id.split('.');
            const partsB = b.file_id.split('.');
            const patchA = partsA.length >= 3 ? parseInt(partsA[2], 10) : 0;
            const patchB = partsB.length >= 3 ? parseInt(partsB[2], 10) : 0;
            return patchB - patchA; // Descending order
          });

          this.logger.log(
            `Selecting player with highest patch version: ${exactMinorPlayers[0].file_id}`
          );
          return [exactMinorPlayers[0]];
        }

        // Fallback: search for all players with the same module and major version (any minor)
        const similarPlayers = await this.fileUploadRepository
          .createQueryBuilder('file')
          .where('file.workspace_id = :workspaceId', { workspaceId })
          .andWhere('file.file_id LIKE :pattern', {
            pattern: `${module}-${majorVersion}.%`
          })
          .getMany();

        if (similarPlayers.length > 0) {
          this.logger.log(
            `No exact minor version match found. Found ${similarPlayers.length} player(s) with module ${module} and major version ${majorVersion} in workspace ${workspaceId}`
          );

          // Sort by minor and patch version (descending) and return the highest one
          similarPlayers.sort((a, b) => {
            const partsA = a.file_id.split('.');
            const partsB = b.file_id.split('.');
            // partsA/B = ['MODULE-MAJOR', 'MINOR', 'PATCH'] or ['MODULE-MAJOR', 'MINOR']
            const minorA = partsA.length >= 2 ? parseInt(partsA[1], 10) : 0;
            const minorB = partsB.length >= 2 ? parseInt(partsB[1], 10) : 0;
            const patchA = partsA.length >= 3 ? parseInt(partsA[2], 10) : 0;
            const patchB = partsB.length >= 3 ? parseInt(partsB[2], 10) : 0;

            if (minorB !== minorA) {
              return minorB - minorA; // Descending order by minor
            }
            return patchB - patchA; // Descending order by patch
          });

          this.logger.log(
            `Automatically selecting player with highest minor.patch version: ${similarPlayers[0].file_id}`
          );
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
        this.logger.log(
          `Found ${files.length} file(s) for player '${playerName}' in workspace ${workspaceId}`
        );
        return files;
      }

      this.logger.warn(
        `No files found for player '${playerName}' in workspace ${workspaceId}`
      );
      return [];
    } catch (error) {
      this.logger.error(
        `Failed to retrieve files for player '${playerName}' in workspace ${workspaceId}`,
        error.stack
      );
      throw new Error(
        `An error occurred while fetching files for player '${playerName}': ${error.message}`
      );
    }
  }

  async findUnitDef(workspaceId: number, unitId: string): Promise<FilesDto[]> {
    this.logger.log(
      `Fetching unit definition for unit: ${unitId} in workspace: ${workspaceId}`
    );
    try {
      const files = await this.fileUploadRepository.find({
        select: ['file_id', 'filename', 'data'],
        where: {
          file_id: `${unitId}.VOUD`,
          workspace_id: workspaceId
        }
      });

      if (files.length === 0) {
        this.logger.warn(
          `No unit definition found for unit: ${unitId} in workspace: ${workspaceId}`
        );
      } else {
        this.logger.log(
          `Successfully retrieved ${files.length} file(s) for unit: ${unitId}`
        );
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
    return this.fileUploadRepository.find({
      where: { file_id: `${unitId}`, workspace_id: workspace_id }
    });
  }

  async findTestPersons(id: number): Promise<number[]> {
    this.logger.log('Returning all test persons for workspace ', id);
    const persons = await this.personsRepository.find({
      select: ['id'],
      where: { workspace_id: id },
      order: { id: 'ASC' }
    });

    return persons.map(person => person.id);
  }

  async findTestPersonUnits(
    id: number,
    testPerson: string
  ): Promise<ResponseEntity[]> {
    this.logger.log('Returning all unit Ids for testperson ', testPerson);
    const res = this.responseRepository.find({
      select: ['unitid'],
      // where: { testPerson: testPerson },
      order: { unitid: 'ASC' }
    });
    if (res) {
      return res;
    }
    return [];
  }

  async getBookletUnits(
    workspaceId: number,
    bookletId: string
  ): Promise<BookletUnit[]> {
    this.logger.log(
      `Getting units for booklet ${bookletId} in workspace ${workspaceId}`
    );

    const bookletFiles = await this.fileUploadRepository.find({
      where: {
        file_id: bookletId.toUpperCase(),
        workspace_id: workspaceId
      }
    });

    if (!bookletFiles || bookletFiles.length === 0) {
      this.logger.error(
        `Booklet file with ID ${bookletId} not found in workspace ${workspaceId}`
      );
      throw new NotFoundException(
        `Booklet file with ID ${bookletId} not found`
      );
    }

    const bookletFile = bookletFiles[0];
    const bookletData = bookletFile.data;

    if (
      !bookletData ||
      typeof bookletData !== 'string' ||
      bookletData.trim().length === 0
    ) {
      this.logger.error(
        `Booklet file with ID ${bookletId} has invalid or empty data in workspace ${workspaceId}`
      );
      throw new NotFoundException(
        `Booklet file with ID ${bookletId} has invalid or empty content`
      );
    }

    const units: BookletUnit[] = [];
    let parsedBookletId = 0;

    try {
      const result = await parseStringPromise(bookletData);

      if (result.Booklet && result.Booklet.$) {
        parsedBookletId = parseInt(result.Booklet.$.id || '0', 10) || 0;
        this.logger.log(`Parsed booklet ID: ${parsedBookletId}`);
      }

      if (result.Booklet && result.Booklet.Units && result.Booklet.Units[0]) {
        const unitsElement = result.Booklet.Units[0];

        const indexTracker = { currentIndex: 0 };

        this.logger.log(
          `Starting to process booklet structure with ID: ${parsedBookletId}`
        );

        this.processUnitsAndTestlets(
          unitsElement,
          units,
          parsedBookletId,
          indexTracker
        );

        this.logger.log(
          `Finished processing booklet structure. Final index: ${indexTracker.currentIndex}`
        );

        this.logger.log(
          `Found ${units.length} total units in booklet ${bookletId}`
        );
      }
    } catch (error) {
      this.logger.error(
        `Error parsing booklet XML: ${error.message}`,
        error.stack
      );
      throw new Error(`Error parsing booklet XML: ${error.message}`);
    }

    if (units.length === 0) {
      this.logger.warn(`No units found in booklet ${bookletId}`);
    }

    return units;
  }

  private processUnitsAndTestlets(
    element: BookletElement,
    units: BookletUnit[],
    bookletId: number,
    indexTracker: IndexTracker
  ): void {
    // Process direct Unit elements if they exist
    if (element.Unit && Array.isArray(element.Unit)) {
      this.logger.log(`Processing ${element.Unit.length} direct Unit elements`);
      element.Unit.forEach((unitElement: XmlElementWithAttributes) => {
        if (unitElement && unitElement.$) {
          this.addUnitToList(unitElement, units, bookletId, indexTracker);
        }
      });
    }

    if (element.Testlet && Array.isArray(element.Testlet)) {
      this.logger.log(`Processing ${element.Testlet.length} Testlet elements`);
      element.Testlet.forEach((testlet: TestletElement) => {
        if (testlet && testlet.$) {
          this.logger.log(
            `Processing Testlet with ID: ${testlet.$.id || 'unknown'}`
          );
        }
        this.processUnitsAndTestlets(testlet, units, bookletId, indexTracker);
      });
    }
  }

  private addUnitToList(
    unitElement: XmlElementWithAttributes,
    units: BookletUnit[],
    bookletId: number,
    indexTracker: IndexTracker
  ): void {
    if (unitElement && unitElement.$) {
      const currentIndex = indexTracker.currentIndex;
      indexTracker.currentIndex += 1;

      const unitId = parseInt(unitElement.$.id || '0', 10) || currentIndex + 1;
      const unitName = unitElement.$.id || '';
      const unitAlias = unitElement.$.alias || unitElement.$.label || null;

      units.push({
        id: unitId,
        name: unitName,
        alias: unitAlias,
        bookletId: bookletId
      });

      this.logger.log(`Added unit: ${unitName} (${unitAlias || 'no alias'})`);
    }
  }
}
