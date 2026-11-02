import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import * as cheerio from 'cheerio';
import { getErrorMessage, getErrorStack } from '../../../utils/error.util';
import FileUpload from '../../entities/file_upload.entity';
import { Unit } from '../../entities/unit.entity';
import { ResponseEntity } from '../../entities/response.entity';
import { MissingPersonDto, TestTakerLoginDto, TestTakersValidationDto } from '../../../../../../../api-dto/files/testtakers-validation.dto';
import Persons from '../../entities/persons.entity';

@Injectable()
export class WorkspaceTestTakersValidationService {
  private readonly logger = new Logger(WorkspaceTestTakersValidationService.name);

  constructor(
    @InjectRepository(FileUpload) private readonly fileUploadRepository: Repository<FileUpload>,
    @InjectRepository(Persons) private readonly personsRepository: Repository<Persons>,
    @InjectRepository(Unit) private readonly unitRepository: Repository<Unit>,
    @InjectRepository(ResponseEntity) private readonly responseRepository: Repository<ResponseEntity>
  ) {}

  async validateTestTakers(
    workspaceId: number,
    onProgress?: (progress: number) => void
  ): Promise<TestTakersValidationDto> {
    try {
      if (onProgress) onProgress(10);
      const testTakers = await this.fileUploadRepository.find({
        where: {
          workspace_id: workspaceId,
          file_type: In(['TestTakers', 'Testtakers'])
        }
      });

      if (!testTakers || testTakers.length === 0) {
        this.logger.warn(
          `No TestTakers found in workspace with ID ${workspaceId}.`
        );
        return {
          testTakersFound: false,
          totalGroups: 0,
          totalLogins: 0,
          totalBookletCodes: 0,
          missingPersons: []
        };
      }

      if (onProgress) onProgress(30);

      const {
        testTakerLogins, totalGroups, totalLogins, totalBookletCodes
      } = this.collectLogins(testTakers);

      if (onProgress) onProgress(60);

      const persons = await this.personsRepository.find({
        where: { workspace_id: workspaceId, consider: true }
      });

      const missingPersons: MissingPersonDto[] = [];
      const totalPersons = persons.length;
      let processedPersons = 0;

      for (const person of persons) {
        processedPersons += 1;
        if (processedPersons % 50 === 0 && onProgress) {
          onProgress(60 + Math.floor((processedPersons / totalPersons) * 35));
        }
        const found = testTakerLogins.some(
          login => login.group === person.group && login.login === person.login
        );

        if (!found) {
          missingPersons.push({
            group: person.group,
            login: person.login,
            code: person.code,
            reason: 'Person not found in TestTakers XML'
          });
        }
      }

      return {
        testTakersFound: true,
        totalGroups,
        totalLogins,
        totalBookletCodes,
        missingPersons
      };
    } catch (error) {
      this.logger.error(
        `Error validating TestTakers for workspace ${workspaceId}: ${getErrorMessage(error)}`,
        getErrorStack(error)
      );
      throw new Error(
        `Error validating TestTakers for workspace ${workspaceId}: ${getErrorMessage(error)}`
      );
    }
  }

  async validateGroupResponses(
    workspaceId: number,
    page: number = 1,
    limit: number = 10,
    onProgress?: (progress: number) => void
  ): Promise<{
    testTakersFound: boolean;
    groupsWithResponses: { group: string; hasResponse: boolean }[];
    allGroupsHaveResponses: boolean;
    total: number;
    totalGroupsWithoutResponses: number;
    page: number;
    limit: number;
  }> {
    try {
      if (onProgress) onProgress(10);
      if (!workspaceId) {
        this.logger.error('Workspace ID is required');
        return this.emptyGroupResult(false, page, limit);
      }
      const testTakers = await this.fileUploadRepository.find({
        where: {
          workspace_id: workspaceId,
          file_type: In(['TestTakers', 'Testtakers'])
        }
      });

      if (!testTakers || testTakers.length === 0) {
        this.logger.warn(
          `No TestTakers found in workspace with ID ${workspaceId}.`
        );
        return this.emptyGroupResult(false, page, limit);
      }

      if (onProgress) onProgress(20);

      const groups = this.collectGroups(testTakers);

      if (groups.size === 0) {
        this.logger.warn(
          `No valid groups found in TestTakers files for workspace ${workspaceId}.`
        );
        return this.emptyGroupResult(true, page, limit);
      }

      if (onProgress) onProgress(40);

      // Check if each group has at least one response
      const groupsWithResponses: { group: string; hasResponse: boolean }[] = [];
      let allGroupsHaveResponses = true;
      let totalGroupsWithoutResponses = 0;
      const totalGroups = groups.size;
      let processedGroups = 0;

      for (const group of groups) {
        processedGroups += 1;
        if (onProgress) {
          onProgress(40 + Math.floor((processedGroups / totalGroups) * 55));
        }
        const hasResponse = await this.groupHasResponses(workspaceId, group);
        groupsWithResponses.push({ group, hasResponse });

        if (!hasResponse) {
          allGroupsHaveResponses = false;
          totalGroupsWithoutResponses += 1;
        }
      }

      // Apply pagination
      const validPage = Math.max(1, page);
      const validLimit = Math.max(1, limit);
      const startIndex = (validPage - 1) * validLimit;
      const endIndex = startIndex + validLimit;
      const paginatedGroupsWithResponses = groupsWithResponses.slice(
        startIndex,
        endIndex
      );

      return {
        testTakersFound: true,
        groupsWithResponses: paginatedGroupsWithResponses,
        allGroupsHaveResponses,
        total: groupsWithResponses.length,
        totalGroupsWithoutResponses,
        page: validPage,
        limit: validLimit
      };
    } catch (error) {
      this.logger.error(
        `Error validating group responses for workspace ${workspaceId}: ${getErrorMessage(error)}`,
        getErrorStack(error)
      );
      throw new Error(
        `Error validating group responses for workspace ${workspaceId}: ${getErrorMessage(error)}`
      );
    }
  }

  private collectLogins(testTakers: FileUpload[]) {
    const testTakerLogins: TestTakerLoginDto[] = [];
    let totalGroups = 0;
    let totalLogins = 0;
    let totalBookletCodes = 0;

    for (const testTaker of testTakers) {
      const xmlDocument = cheerio.load(testTaker.data, { xml: true });
      const groupElements = xmlDocument('Group');

      if (groupElements.length === 0) {
        this.logger.warn(
          `No <Group> elements found in TestTakers file ${testTaker.file_id}.`
        );
        continue;
      }

      totalGroups += groupElements.length;

      const logins = this.collectGroupLogins(xmlDocument);
      testTakerLogins.push(...logins);
      totalLogins += logins.length;
      totalBookletCodes += logins.reduce((count, login) => count + login.bookletCodes.length, 0);
    }

    return {
      testTakerLogins, totalGroups, totalLogins, totalBookletCodes
    };
  }

  private collectGroupLogins(xmlDocument: cheerio.CheerioAPI): TestTakerLoginDto[] {
    const groupElements = xmlDocument('Group');
    const testTakerLogins: TestTakerLoginDto[] = [];
    // Extract data from each group
    for (let i = 0; i < groupElements.length; i += 1) {
      const groupElement = groupElements[i];
      const groupId = xmlDocument(groupElement).attr('id');
      const loginElements = xmlDocument(groupElement).find('Login');

      // Extract data from each login
      for (let j = 0; j < loginElements.length; j += 1) {
        const loginElement = loginElements[j];
        const loginName = xmlDocument(loginElement).attr('name');
        const loginMode = xmlDocument(loginElement).attr('mode');

        // Only include logins with mode "run-hot-return" or "run-hot-restart"
        if (loginMode !== 'run-hot-return' && loginMode !== 'run-hot-restart') continue;
        const bookletElements = xmlDocument(loginElement).find('Booklet');
        const bookletCodes: string[] = [];

        // Extract data from each booklet
        for (let k = 0; k < bookletElements.length; k += 1) {
          const bookletElement = bookletElements[k];
          const codes = xmlDocument(bookletElement).attr('codes');
          if (codes) {
            bookletCodes.push(codes);
          }
        }

        testTakerLogins.push({
          group: groupId || '',
          login: loginName || '',
          mode: loginMode || '',
          bookletCodes
        });
      }
    }
    return testTakerLogins;
  }

  private collectGroups(testTakers: FileUpload[]): Set<string> {
    const groups: Set<string> = new Set();

    for (const testTaker of testTakers) {
      const xmlDocument = cheerio.load(testTaker.data, { xml: true });
      const groupElements = xmlDocument('Group');

      if (groupElements.length === 0) {
        this.logger.warn(
          `No <Group> elements found in TestTakers file ${testTaker.file_id}.`
        );
        continue;
      }

      // Extract data from each group
      for (let i = 0; i < groupElements.length; i += 1) {
        const groupElement = groupElements[i];
        const groupId = xmlDocument(groupElement).attr('id');
        const loginElements = xmlDocument(groupElement).find('Login');

        // Check if there's at least one login with mode "run-hot-return" or "run-hot-restart"
        let hasValidLogin = false;
        for (let j = 0; j < loginElements.length; j += 1) {
          const loginElement = loginElements[j];
          const loginMode = xmlDocument(loginElement).attr('mode');

          if (
            loginMode === 'run-hot-return' ||
              loginMode === 'run-hot-restart'
          ) {
            hasValidLogin = true;
            break;
          }
        }

        // Only add groups with valid logins
        if (hasValidLogin && groupId) {
          groups.add(groupId);
        }
      }
    }

    return groups;
  }

  private async groupHasResponses(workspaceId: number, group: string): Promise<boolean> {
    // Find persons with this group ID
    const persons = await this.personsRepository.find({
      where: { workspace_id: workspaceId, group, consider: true }
    });

    if (persons.length === 0) {
      // No persons found for this group
      return false;
    }

    // Get all person IDs
    const personIds = persons.map(person => person.id);

    if (personIds.length === 0) {
      this.logger.warn(
        `No person IDs found for group ${group} in workspace ${workspaceId}`
      );
      return false;
    }

    const batchSize = 1000;
    let allUnits: Unit[] = [];

    for (let i = 0; i < personIds.length; i += batchSize) {
      const personIdsBatch = personIds.slice(i, i + batchSize);

      // Find units for this batch of person IDs
      const unitsBatch = await this.unitRepository
        .createQueryBuilder('unit')
        .innerJoin('unit.booklet', 'booklet')
        .where('booklet.personid IN (:...personIdsBatch)', {
          personIdsBatch
        })
        .getMany();

      allUnits = [...allUnits, ...unitsBatch];
    }

    if (allUnits.length === 0) {
      return false;
    }

    const unitIds = allUnits.map(unit => unit.id);

    if (unitIds.length === 0) {
      this.logger.warn(
        `No unit IDs found for group ${group} in workspace ${workspaceId}`
      );
      return false;
    }

    let totalResponseCount = 0;

    for (let i = 0; i < unitIds.length; i += batchSize) {
      const unitIdsBatch = unitIds.slice(i, i + batchSize);

      const responseCountBatch = await this.responseRepository.count({
        where: { unitid: In(unitIdsBatch) }
      });

      totalResponseCount += responseCountBatch;
    }

    return totalResponseCount > 0;
  }

  private emptyGroupResult(testTakersFound: boolean, page: number, limit: number) {
    return {
      testTakersFound, groupsWithResponses: [], allGroupsHaveResponses: false, total: 0, totalGroupsWithoutResponses: 0, page, limit
    };
  }
}
