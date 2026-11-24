import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, MoreThan, Repository } from 'typeorm';
import * as cheerio from 'cheerio';
import { getErrorMessage, getErrorStack } from '../../../utils/error.util';
import FileUpload from '../../entities/file_upload.entity';
import { ResponseEntity } from '../../entities/response.entity';
import { MissingPersonDto, TestTakerLoginDto, TestTakersValidationDto } from '../../../../../../../api-dto/files/testtakers-validation.dto';
import Persons from '../../entities/persons.entity';

@Injectable()
export class WorkspaceTestTakersValidationService {
  private readonly logger = new Logger(WorkspaceTestTakersValidationService.name);

  constructor(
    @InjectRepository(FileUpload) private readonly fileUploadRepository: Repository<FileUpload>,
    @InjectRepository(Persons) private readonly personsRepository: Repository<Persons>,
    @InjectRepository(ResponseEntity) private readonly responseRepository: Repository<ResponseEntity>
  ) {}

  async validateTestTakers(
    workspaceId: number,
    onProgress?: (progress: number) => void | Promise<void>
  ): Promise<TestTakersValidationDto> {
    try {
      await onProgress?.(10);
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

      await onProgress?.(30);

      const {
        testTakerLogins, totalGroups, totalLogins, totalBookletCodes
      } = this.collectLogins(testTakers);

      const loginsByGroup = new Map<string, Set<string>>();
      for (const { group, login } of testTakerLogins) {
        const logins = loginsByGroup.get(group) ?? new Set<string>();
        logins.add(login);
        loginsByGroup.set(group, logins);
      }

      await onProgress?.(60);
      const personScope = { workspace_id: workspaceId, consider: true };
      const totalPersons = await this.personsRepository.countBy(personScope);
      const pageSize = 500;
      const missingPersons: MissingPersonDto[] = [];
      let processedPersons = 0;
      let afterId: number | undefined;

      while (true) {
        const persons = await this.personsRepository.find({
          select: {
            id: true, group: true, login: true, code: true
          },
          where: afterId === undefined ? personScope : { ...personScope, id: MoreThan(afterId) },
          order: { id: 'ASC' },
          take: pageSize
        });

        for (const person of persons) {
          if (!loginsByGroup.get(person.group)?.has(person.login)) {
            missingPersons.push({
              group: person.group,
              login: person.login,
              code: person.code,
              reason: 'Person not found in TestTakers XML'
            });
          }
        }
        processedPersons += persons.length;
        if (totalPersons > 0) {
          await onProgress?.(60 + Math.floor(Math.min(processedPersons / totalPersons, 1) * 35));
        }
        if (persons.length < pageSize) break;
        afterId = persons[persons.length - 1].id;
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
    onProgress?: (progress: number) => void | Promise<void>
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
      await onProgress?.(10);
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

      await onProgress?.(20);

      const groups = this.collectGroups(testTakers);

      if (groups.size === 0) {
        this.logger.warn(
          `No valid groups found in TestTakers files for workspace ${workspaceId}.`
        );
        return this.emptyGroupResult(true, page, limit);
      }

      await onProgress?.(40);

      // Check if each group has at least one response
      const groupsWithResponses: { group: string; hasResponse: boolean }[] = [];
      let allGroupsHaveResponses = true;
      let totalGroupsWithoutResponses = 0;
      const totalGroups = groups.size;
      let processedGroups = 0;

      for (const group of groups) {
        processedGroups += 1;
        const hasResponse = await this.groupHasResponses(workspaceId, group);
        await onProgress?.(40 + Math.floor((processedGroups / totalGroups) * 55));
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

  private groupHasResponses(workspaceId: number, group: string): Promise<boolean> {
    return this.responseRepository.existsBy({
      unit: { booklet: { person: { workspace_id: workspaceId, group, consider: true } } }
    });
  }

  private emptyGroupResult(testTakersFound: boolean, page: number, limit: number) {
    return {
      testTakersFound, groupsWithResponses: [], allGroupsHaveResponses: false, total: 0, totalGroupsWithoutResponses: 0, page, limit
    };
  }
}
