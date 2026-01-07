import { Injectable } from '@nestjs/common';
import { Request } from 'express';
import { CodingListService } from './coding-list.service';

@Injectable()
export class ExportUrlService {
  private variablePageMapsCache = new Map<string, Map<string, string>>();
  private currentWorkspaceId: number | null = null;

  constructor(private codingListService: CodingListService) {}

  clearPageMapsCache(): void {
    this.variablePageMapsCache.clear();
    this.currentWorkspaceId = null;
  }

  async getVariablePage(unitName: string, variableId: string, workspaceId: number): Promise<string> {
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

  generateReplayUrl(
    req: Request,
    loginName: string,
    loginCode: string,
    group: string,
    bookletId: string,
    unitName: string,
    variableId: string,
    variablePage: string,
    authToken: string
  ): string {
    if (!loginName || !loginCode || !bookletId || !unitName || !variableId) {
      return '';
    }

    const baseUrl = `${req.protocol}://${req.get('host')}`;

    const encodedLoginName = encodeURIComponent(loginName);
    const encodedLoginCode = encodeURIComponent(loginCode);
    const encodedGroup = encodeURIComponent(group || '');
    const encodedBookletId = encodeURIComponent(bookletId);
    const encodedUnitName = encodeURIComponent(unitName);
    const encodedVariablePage = encodeURIComponent(variablePage || '0');
    const encodedVariableId = encodeURIComponent(variableId);
    const encodedAuthToken = encodeURIComponent(authToken || '');

    return `${baseUrl}/#/replay/${encodedLoginName}@${encodedLoginCode}@${encodedGroup}@${encodedBookletId}/${encodedUnitName}/${encodedVariablePage}/${encodedVariableId}?auth=${encodedAuthToken}`;
  }

  async generateReplayUrlWithPageLookup(
    req: Request,
    loginName: string,
    loginCode: string,
    group: string,
    bookletId: string,
    unitName: string,
    variableId: string,
    workspaceId: number,
    authToken: string
  ): Promise<string> {
    const variablePage = await this.getVariablePage(unitName, variableId, workspaceId);
    return this.generateReplayUrl(req, loginName, loginCode, group, bookletId, unitName, variableId, variablePage, authToken);
  }
}
