import {
  Injectable, Logger
} from '@nestjs/common';
import { WorkspaceFilesFacade } from '../../workspaces/services/workspace-files-facade.service';
import { LRUCache } from '../../utils/lru-cache';

@Injectable()
export class VoudService {
  private readonly logger = new Logger(VoudService.name);
  private voudCache = new LRUCache<Map<string, string>>(50);

  constructor(
    private readonly workspaceFilesFacade: WorkspaceFilesFacade
  ) {}

  clearCache() {
    this.voudCache.clear();
  }

  async getVariablePageMap(
    unitName: string,
    workspaceId: number
  ): Promise<Map<string, string>> {
    const cacheKey = `${workspaceId}:${unitName}`;
    let map = this.voudCache.get(cacheKey);
    if (map) return map;

    map = await this.workspaceFilesFacade.getVariablePageMap(unitName, workspaceId);
    this.voudCache.set(cacheKey, map);
    return map;
  }

  async getVariablePageMaps(
    unitNames: string[],
    workspaceId: number
  ): Promise<Map<string, Map<string, string>>> {
    const variablePageMap = new Map<string, Map<string, string>>();
    const uniqueNames = [...new Set(unitNames)];

    for (const unitName of uniqueNames) {
      try {
        const map = await this.getVariablePageMap(
          unitName,
          workspaceId
        );
        variablePageMap.set(unitName, map);
      } catch (error) {
        this.logger.warn(`Could not load VOUD map for unit ${unitName}: ${error.message}`);
      }
    }
    return variablePageMap;
  }

  async getUnitVariableMap(
    workspaceId: number
  ): Promise<Map<string, Set<string>>> {
    return this.workspaceFilesFacade.getUnitVariableMap(workspaceId);
  }
}
