import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import * as cheerio from 'cheerio';
import {
  FileUpload, Persons
} from '../../common';
import { FileValidationResultDto } from '../../../../../../api-dto/files/file-validation-result.dto';
import { InvalidVariableDto } from '../../../../../../api-dto/files/variable-validation.dto';
import { DuplicateResponsesResultDto } from '../../../../../../api-dto/files/duplicate-response.dto';
import {
  MissingPersonDto,
  TestTakerLoginDto,
  TestTakersValidationDto
} from '../../../../../../api-dto/files/testtakers-validation.dto';
import { WorkspaceResponseValidationService } from './workspace-response-validation.service';
import { WorkspaceTestFilesValidationService } from './workspace-test-files-validation.service';

@Injectable()
export class FileValidationService {
  private readonly logger = new Logger(FileValidationService.name);

  constructor(
    @InjectRepository(FileUpload)
    private fileUploadRepository: Repository<FileUpload>,
    @InjectRepository(Persons)
    private personsRepository: Repository<Persons>,
    private workspaceResponseValidationService: WorkspaceResponseValidationService,
    private workspaceTestFilesValidationService: WorkspaceTestFilesValidationService
  ) {}

  async validateTestFiles(
    workspaceId: number
  ): Promise<FileValidationResultDto> {
    return this.workspaceTestFilesValidationService.validateTestFiles(
      workspaceId
    );
  }

  async validateVariables(
    workspaceId: number,
    page: number = 1,
    limit: number = 10
  ): Promise<{
      data: InvalidVariableDto[];
      total: number;
      page: number;
      limit: number;
    }> {
    return this.workspaceResponseValidationService.validateVariables(
      workspaceId,
      page,
      limit
    );
  }

  async validateVariableTypes(
    workspaceId: number,
    page: number = 1,
    limit: number = 10
  ): Promise<{
      data: InvalidVariableDto[];
      total: number;
      page: number;
      limit: number;
    }> {
    return this.workspaceResponseValidationService.validateVariableTypes(
      workspaceId,
      page,
      limit
    );
  }

  async validateTestTakers(
    workspaceId: number
  ): Promise<TestTakersValidationDto> {
    try {
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

        for (let i = 0; i < groupElements.length; i += 1) {
          const groupElement = groupElements[i];
          const groupId = xmlDocument(groupElement).attr('id');
          const loginElements = xmlDocument(groupElement).find('Login');

          for (let j = 0; j < loginElements.length; j += 1) {
            const loginElement = loginElements[j];
            const loginName = xmlDocument(loginElement).attr('name');
            const loginMode = xmlDocument(loginElement).attr('mode');

            if (
              loginMode === 'run-hot-return' ||
              loginMode === 'run-hot-restart'
            ) {
              totalLogins += 1;

              const bookletElements = xmlDocument(loginElement).find('Booklet');
              const bookletCodes: string[] = [];

              for (let k = 0; k < bookletElements.length; k += 1) {
                const bookletElement = bookletElements[k];
                const codes = xmlDocument(bookletElement).attr('codes');
                if (codes) {
                  bookletCodes.push(codes);
                  totalBookletCodes += 1;
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
        }
      }

      const persons = await this.personsRepository.find({
        where: { workspace_id: workspaceId, consider: true }
      });

      const missingPersons: MissingPersonDto[] = [];

      for (const person of persons) {
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
        `Error validating TestTakers for workspace ${workspaceId}: ${error.message}`,
        error.stack
      );
      throw new Error(
        `Error validating TestTakers for workspace ${workspaceId}: ${error.message}`
      );
    }
  }

  async validateDuplicateResponses(
    workspaceId: number,
    page: number = 1,
    limit: number = 10
  ): Promise<DuplicateResponsesResultDto> {
    return this.workspaceResponseValidationService.validateDuplicateResponses(
      workspaceId,
      page,
      limit
    );
  }

  async validateResponseStatus(
    workspaceId: number,
    page: number = 1,
    limit: number = 10
  ): Promise<{
      data: InvalidVariableDto[];
      total: number;
      page: number;
      limit: number;
    }> {
    return this.workspaceResponseValidationService.validateResponseStatus(
      workspaceId,
      page,
      limit
    );
  }

  async validateGroupResponses(
    workspaceId: number,
    page: number = 1,
    limit: number = 10
  ): Promise<{
      testTakersFound: boolean;
      groupsWithResponses: { group: string; hasResponse: boolean }[];
      allGroupsHaveResponses: boolean;
      total: number;
      page: number;
      limit: number;
    }> {
    return this.workspaceResponseValidationService.validateGroupResponses(
      workspaceId,
      page,
      limit
    );
  }

  async deleteInvalidResponses(
    workspaceId: number,
    responseIds: number[]
  ): Promise<number> {
    return this.workspaceResponseValidationService.deleteInvalidResponses(
      workspaceId,
      responseIds
    );
  }

  async deleteAllInvalidResponses(
    workspaceId: number,
    validationType:
    | 'variables'
    | 'variableTypes'
    | 'responseStatus'
    | 'duplicateResponses'
  ): Promise<number> {
    return this.workspaceResponseValidationService.deleteAllInvalidResponses(
      workspaceId,
      validationType
    );
  }
}
