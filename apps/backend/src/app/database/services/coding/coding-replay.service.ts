import {
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ResponseEntity } from '../../entities/response.entity';
import { CodingJobUnit } from '../../entities/coding-job-unit.entity';
import { generateReplayUrl } from '../../../utils/replay-url.util';
import { CodingListService } from './coding-list.service';

interface ReplayMetadata {
  unitName: string;
  variableId: string;
  variableAnchor: string;
  bookletName: string;
  personLogin: string;
  personCode: string;
  personGroup: string;
}

@Injectable()
export class CodingReplayService {
  private readonly logger = new Logger(CodingReplayService.name);

  constructor(
    @InjectRepository(ResponseEntity)
    private responseRepository: Repository<ResponseEntity>,
    @InjectRepository(CodingJobUnit)
    private codingJobUnitRepository: Repository<CodingJobUnit>,
    private codingListService: CodingListService
  ) { }

  async generateReplayUrlForResponse(
    workspaceId: number,
    responseId: number,
    serverUrl: string,
    authToken: string
  ): Promise<{ replayUrl: string }> {
    try {
      const response = await this.responseRepository.findOne({
        where: { id: responseId },
        relations: [
          'unit',
          'unit.booklet',
          'unit.booklet.person',
          'unit.booklet.bookletinfo'
        ]
      });

      if (!response) {
        throw new NotFoundException(`Response with id ${responseId} not found`);
      }

      const person = response.unit?.booklet?.person;
      if (person && Number(person.workspace_id) !== Number(workspaceId)) {
        throw new ForbiddenException(
          `Response ${responseId} does not belong to workspace ${workspaceId}`
        );
      }

      const responseMetadata = this.getMetadataFromResponse(response);
      const codingJobUnit = this.hasRequiredReplayMetadata(responseMetadata) ?
        null :
        await this.findCodingJobUnitForResponse(workspaceId, responseId);
      const metadata = this.mergeReplayMetadata(responseMetadata, codingJobUnit);

      if (!this.hasRequiredReplayMetadata(metadata)) {
        throw new NotFoundException(
          `Replay metadata for response ${responseId} in workspace ${workspaceId} not found`
        );
      }

      const replayUrl = await this.buildReplayUrl(workspaceId, metadata, serverUrl, authToken);

      this.logger.log(
        `Generated replay URL for response ${responseId} in workspace ${workspaceId}`
      );

      return { replayUrl };
    } catch (error) {
      if (!(error instanceof HttpException) && error instanceof Error) {
        this.logger.error(
          `Error generating replay URL for response ${responseId}: ${error.message}`,
          error.stack
        );
      }
      throw error;
    }
  }

  async generateReplayUrlsForItems(
    workspaceId: number,
    items: Array<{
      responseId: number;
      unitName: string;
      unitAlias: string | null;
      variableId: string;
      variableAnchor: string;
      bookletName: string;
      personLogin: string;
      personCode: string;
      personGroup: string;
    }>,
    serverUrl: string
  ): Promise<
    Array<{
      responseId: number;
      unitName: string;
      unitAlias: string | null;
      variableId: string;
      variableAnchor: string;
      bookletName: string;
      personLogin: string;
      personCode: string;
      personGroup: string;
      replayUrl: string;
    }>
    > {
    return Promise.all(
      items.map(async item => {
        try {
          const result = await this.generateReplayUrlForResponse(
            workspaceId,
            item.responseId,
            serverUrl,
            ''
          );
          const replayUrlWithoutAuth = result.replayUrl.replace('?auth=', '');
          return {
            ...item,
            replayUrl: replayUrlWithoutAuth
          };
        } catch (error) {
          this.logger.warn(
            `Failed to generate replay URL for response ${item.responseId}: ${error.message}`
          );
          return {
            ...item,
            replayUrl: ''
          };
        }
      })
    );
  }

  async generateReplayUrlsForItemsBulk(
    workspaceId: number,
    items: Array<{
      responseId: number;
      unitName: string;
      unitAlias: string | null;
      variableId: string;
      variableAnchor: string;
      bookletName: string;
      personLogin: string;
      personCode: string;
      personGroup: string;
    }>,
    serverUrl: string
  ): Promise<
    Array<{
      responseId: number;
      unitName: string;
      unitAlias: string | null;
      variableId: string;
      variableAnchor: string;
      bookletName: string;
      personLogin: string;
      personCode: string;
      personGroup: string;
      replayUrl: string;
    }>
    > {
    const uniqueUnitNames = [...new Set(items.map(i => i.unitName))];
    const variablePageMaps = new Map<string, Map<string, string>>();
    await Promise.all(
      uniqueUnitNames.map(async unitName => {
        try {
          const pageMap = await this.codingListService.getVariablePageMap(unitName, workspaceId);
          variablePageMaps.set(unitName, pageMap);
        } catch (error) {
          this.logger.warn(`Failed to get variable page map for unit '${unitName}': ${error.message}`);
          variablePageMaps.set(unitName, new Map());
        }
      })
    );

    return items.map(item => {
      try {
        const pageMap = variablePageMaps.get(item.unitName) ?? new Map<string, string>();
        const variablePage = pageMap.get(item.variableId) || '0';
        const replayUrl = this.createReplayUrl(
          {
            unitName: item.unitName,
            variableId: item.variableId,
            variableAnchor: item.variableAnchor,
            bookletName: item.bookletName,
            personLogin: item.personLogin,
            personCode: item.personCode,
            personGroup: item.personGroup
          },
          serverUrl,
          variablePage,
          ''
        ).replace('?auth=', '');
        return { ...item, replayUrl };
      } catch (error) {
        this.logger.warn(`Failed to generate replay URL for response ${item.responseId}: ${error.message}`);
        return { ...item, replayUrl: '' };
      }
    });
  }

  private getMetadataFromResponse(response: ResponseEntity): ReplayMetadata {
    const person = response.unit?.booklet?.person;
    return {
      unitName: response.unit?.name || '',
      variableId: response.variableid || '',
      variableAnchor: response.variableid || '',
      bookletName: response.unit?.booklet?.bookletinfo?.name || '',
      personLogin: person?.login || '',
      personCode: person?.code || '',
      personGroup: person?.group || ''
    };
  }

  private mergeReplayMetadata(
    responseMetadata: ReplayMetadata,
    codingJobUnit: CodingJobUnit | null
  ): ReplayMetadata {
    if (!codingJobUnit) {
      return responseMetadata;
    }

    return {
      unitName: responseMetadata.unitName || codingJobUnit.unit_name || '',
      variableId: responseMetadata.variableId || codingJobUnit.variable_id || '',
      variableAnchor: codingJobUnit.variable_anchor || responseMetadata.variableAnchor || codingJobUnit.variable_id || '',
      bookletName: responseMetadata.bookletName || codingJobUnit.booklet_name || '',
      personLogin: responseMetadata.personLogin || codingJobUnit.person_login || '',
      personCode: responseMetadata.personLogin ? responseMetadata.personCode : codingJobUnit.person_code || '',
      personGroup: responseMetadata.personLogin ? responseMetadata.personGroup : codingJobUnit.person_group || ''
    };
  }

  private hasRequiredReplayMetadata(metadata: ReplayMetadata): boolean {
    return Boolean(
      metadata.unitName &&
      metadata.variableId &&
      metadata.variableAnchor &&
      metadata.bookletName &&
      metadata.personLogin
    );
  }

  private async findCodingJobUnitForResponse(
    workspaceId: number,
    responseId: number
  ): Promise<CodingJobUnit | null> {
    return this.codingJobUnitRepository
      .createQueryBuilder('codingJobUnit')
      .innerJoinAndSelect(
        'codingJobUnit.coding_job',
        'codingJob',
        'codingJob.workspace_id = :workspaceId',
        { workspaceId }
      )
      .where('codingJobUnit.response_id = :responseId', { responseId })
      .orderBy('codingJobUnit.id', 'ASC')
      .getOne();
  }

  private async buildReplayUrl(
    workspaceId: number,
    metadata: ReplayMetadata,
    serverUrl: string,
    authToken: string
  ): Promise<string> {
    const variablePage = await this.resolveVariablePage(
      workspaceId,
      metadata.unitName,
      metadata.variableId
    );

    return this.createReplayUrl(metadata, serverUrl, variablePage, authToken);
  }

  private async resolveVariablePage(
    workspaceId: number,
    unitName: string,
    variableId: string
  ): Promise<string> {
    try {
      this.logger.log(
        `Looking up variablePage for unit '${unitName}', variable '${variableId}' in workspace ${workspaceId}`
      );
      const variablePageMap = await this.codingListService.getVariablePageMap(
        unitName,
        workspaceId
      );
      this.logger.log(
        `VOUD lookup result: variablePageMap has ${variablePageMap.size} entries for unit '${unitName}'`
      );
      const variablePage = variablePageMap.get(variableId) || '0';
      this.logger.log(
        `Variable '${variableId}' resolved to page '${variablePage}' (found in map: ${variablePageMap.has(
          variableId
        )})`
      );
      return variablePage;
    } catch (error) {
      this.logger.warn(
        `Failed to resolve variablePage for unit '${unitName}', variable '${variableId}' in workspace ${workspaceId}: ${error.message}`
      );
      return '0';
    }
  }

  private createReplayUrl(
    metadata: ReplayMetadata,
    serverUrl: string,
    variablePage: string,
    authToken: string
  ): string {
    return generateReplayUrl({
      serverUrl,
      loginName: metadata.personLogin,
      loginCode: metadata.personCode,
      loginGroup: metadata.personGroup,
      bookletId: metadata.bookletName,
      unitId: metadata.unitName,
      variablePage,
      variableAnchor: metadata.variableAnchor,
      authToken
    });
  }
}
