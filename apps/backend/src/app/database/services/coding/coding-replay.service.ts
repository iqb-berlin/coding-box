import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ResponseEntity } from '../../entities/response.entity';
import { generateReplayUrl } from '../../../utils/replay-url.util';
import { CodingListService } from './coding-list.service';

@Injectable()
export class CodingReplayService {
  private readonly logger = new Logger(CodingReplayService.name);

  constructor(
    @InjectRepository(ResponseEntity)
    private responseRepository: Repository<ResponseEntity>,
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
        throw new Error(`Response with id ${responseId} not found`);
      }

      const person = response.unit?.booklet?.person;
      if (!person || person.workspace_id !== workspaceId) {
        throw new Error(
          `Response ${responseId} does not belong to workspace ${workspaceId}`
        );
      }

      const unitName = response.unit?.name || '';
      const variableId = response.variableid || '';
      const loginName = person.login || '';
      const loginCode = person.code || '';
      const loginGroup = person.group || '';
      const bookletId = response.unit?.booklet?.bookletinfo?.name || '';

      // Get the variable page from VOUD data
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

      const replayUrl = generateReplayUrl({
        serverUrl,
        loginName,
        loginCode,
        loginGroup,
        bookletId,
        unitId: unitName,
        variablePage,
        variableAnchor: variableId,
        authToken
      });

      this.logger.log(
        `Generated replay URL for response ${responseId} in workspace ${workspaceId}`
      );

      return { replayUrl };
    } catch (error) {
      if (!(error instanceof Error && (error.message.includes('not found') || error.message.includes('does not belong')))) {
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
}
