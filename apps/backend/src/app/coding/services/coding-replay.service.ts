import { Injectable, Logger } from '@nestjs/common';
import { WorkspacesFacadeService } from '../../workspaces/services/workspaces-facade.service';
import { CodingListService } from './coding-list.service';
import { generateReplayUrl } from '../../utils/replay-url.util';

/**
 * CodingReplayService
 *
 * Handles the generation of replay URLs for responses.
 *
 * Extracted from WorkspaceCodingService to improve maintainability.
 */
@Injectable()
export class CodingReplayService {
  private readonly logger = new Logger(CodingReplayService.name);

  constructor(
    private readonly workspacesFacadeService: WorkspacesFacadeService,
    private readonly codingListService: CodingListService
  ) {}

  /**
   * Generate a replay URL for a single response
   */
  async generateReplayUrlForResponse(
    workspaceId: number,
    responseId: number,
    serverUrl: string,
    authToken: string
  ): Promise<{ replayUrl: string }> {
    const response = await this.workspacesFacadeService.findResponseByIdWithRelations(responseId);
    if (!response) {
      throw new Error(`Response with id ${responseId} not found`);
    }

    const person = response.unit?.booklet?.person;
    if (!person || person.workspace_id !== workspaceId) {
      throw new Error(`Response ${responseId} does not belong to workspace ${workspaceId}`);
    }

    try {
      const unitName = response.unit?.name || '';
      const variableId = response.variableid || '';
      const variablePageMap = await this.codingListService.getVariablePageMap(unitName, workspaceId);
      const variablePage = variablePageMap.get(variableId) || '0';

      const replayUrl = generateReplayUrl({
        serverUrl,
        loginName: person.login || '',
        loginCode: person.code || '',
        loginGroup: person.group || '',
        bookletId: response.unit?.booklet?.bookletinfo?.name || '',
        unitId: unitName,
        variablePage,
        variableAnchor: variableId,
        authToken
      });

      return { replayUrl };
    } catch (error) {
      this.logger.error(`Error generating replay URL for response ${responseId}: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Generate replay URLs for multiple items
   */
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
  ): Promise<Array<{
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
    }>> {
    return Promise.all(
      items.map(async item => {
        try {
          const result = await this.generateReplayUrlForResponse(workspaceId, item.responseId, serverUrl, '');
          return {
            ...item,
            replayUrl: result.replayUrl.replace('?auth=', '')
          };
        } catch (error) {
          this.logger.warn(`Failed to generate replay URL for response ${item.responseId}: ${error.message}`);
          return { ...item, replayUrl: '' };
        }
      })
    );
  }
}
