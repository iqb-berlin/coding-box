import { Injectable, Optional } from '@nestjs/common';
import { Request } from 'express';
import { generateReplayUrl, generateReplayUrlFromRequest } from '../../../utils/replay-url.util';
import { CodingListService } from './coding-list.service';
import { CodingReplayAnchorService } from './coding-replay-anchor.service';

@Injectable()
export class CodingExportReplayService {
  private variablePageMapsCache = new Map<string, Map<string, string>>();
  private variableAnchorMapsCache = new Map<string, Map<string, string>>();
  private currentWorkspaceId: number | null = null;

  constructor(
    private codingListService: CodingListService,
    @Optional()
    private replayAnchorService?: CodingReplayAnchorService
  ) {}

  clearPageMapsCache(): void {
    this.variablePageMapsCache.clear();
    this.variableAnchorMapsCache.clear();
    this.currentWorkspaceId = null;
  }

  private async getVariablePage(unitName: string, variableId: string, workspaceId: number): Promise<string> {
    if (this.currentWorkspaceId !== workspaceId) {
      this.clearPageMapsCache();
      this.currentWorkspaceId = workspaceId;
    }

    if (!this.variablePageMapsCache.has(unitName)) {
      const pageMap = await this.codingListService.getVariablePageMap(unitName, workspaceId);
      this.variablePageMapsCache.set(unitName, pageMap);
    }

    return this.variablePageMapsCache.get(unitName)?.get(variableId) || '0';
  }

  private async getVariableAnchor(unitName: string, variableId: string, workspaceId: number): Promise<string> {
    if (!this.replayAnchorService) {
      return variableId;
    }

    if (this.currentWorkspaceId !== workspaceId) {
      this.clearPageMapsCache();
      this.currentWorkspaceId = workspaceId;
    }

    if (!this.variableAnchorMapsCache.has(unitName)) {
      const anchorMap = await this.replayAnchorService.getVariableAnchorMap(unitName, workspaceId);
      this.variableAnchorMapsCache.set(unitName, anchorMap);
    }

    return this.variableAnchorMapsCache.get(unitName)?.get(variableId) || variableId;
  }

  async generateReplayUrlWithPageLookup(
    req: Request | undefined,
    loginName: string,
    loginCode: string,
    group: string,
    bookletId: string,
    unitName: string,
    variableId: string,
    workspaceId: number,
    authToken: string,
    serverUrl?: string
  ): Promise<string> {
    const [variablePage, variableAnchor] = await Promise.all([
      this.getVariablePage(unitName, variableId, workspaceId),
      this.getVariableAnchor(unitName, variableId, workspaceId)
    ]);
    if (req) {
      return generateReplayUrlFromRequest(req, {
        loginName,
        loginCode,
        loginGroup: group,
        bookletId,
        unitId: unitName,
        variablePage,
        variableAnchor,
        authToken,
        workspaceId: authToken ? undefined : workspaceId
      });
    }

    if (!serverUrl) {
      return '';
    }

    return generateReplayUrl({
      serverUrl,
      loginName,
      loginCode,
      loginGroup: group,
      bookletId,
      unitId: unitName,
      variablePage,
      variableAnchor,
      authToken,
      workspaceId: authToken ? undefined : workspaceId
    });
  }
}
