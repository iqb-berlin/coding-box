import { Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { ResponseEntity } from '../../common';
import { JournalService } from './journal.service';

/**
 * DuplicateResponseService
 *
 * Handles detection and resolution of duplicate responses in the system.
 * This service is responsible for:
 * - Parsing duplicate resolution keys
 * - Finding duplicate response groups
 * - Deleting duplicate responses (keeping selected one)
 * - Logging resolution actions to journal
 *
 * Duplicate Key Format: "unitId|variableId|subform|testTakerLogin"
 *
 * Extracted from WorkspaceTestResultsService to improve maintainability.
 */
@Injectable()
export class DuplicateResponseService {
  private readonly logger = new Logger(DuplicateResponseService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly journalService: JournalService
  ) {}

  /**
   * Resolve duplicate responses by keeping selected responses and deleting others
   *
   * @param workspaceId - The workspace ID
   * @param resolutionMap - Map of duplicate keys to selected response IDs
   * @param userId - User performing the resolution
   * @returns Count of resolved duplicates and success status
   */
  async resolveDuplicateResponses(
    workspaceId: number,
    resolutionMap: Record<string, number>,
    userId: string
  ): Promise<{ resolvedCount: number; success: boolean }> {
    this.validateInputs(workspaceId, resolutionMap);

    if (Object.keys(resolutionMap).length === 0) {
      return { resolvedCount: 0, success: true };
    }

    this.logger.log(
      `Resolving ${Object.keys(resolutionMap).length} duplicate groups in workspace ${workspaceId}`
    );

    return this.dataSource.transaction(async manager => {
      let resolvedCount = 0;

      for (const [key, selectedResponseId] of Object.entries(resolutionMap)) {
        const resolved = await this.resolveSingleDuplicateGroup(
          manager,
          workspaceId,
          key,
          selectedResponseId,
          userId
        );
        resolvedCount += resolved;
      }

      this.logger.log(`Resolved ${resolvedCount} duplicate responses`);

      return {
        resolvedCount,
        success: true
      };
    });
  }

  /**
   * Validate inputs for duplicate resolution
   */
  private validateInputs(
    workspaceId: number,
    resolutionMap: Record<string, number>
  ): void {
    if (!workspaceId || workspaceId <= 0) {
      throw new Error('Invalid workspaceId provided');
    }

    if (!resolutionMap || typeof resolutionMap !== 'object') {
      throw new Error('Invalid resolutionMap provided');
    }
  }

  /**
   * Resolve a single duplicate group
   */
  private async resolveSingleDuplicateGroup(
    manager: EntityManager,
    workspaceId: number,
    duplicateKey: string,
    selectedResponseId: number,
    userId: string
  ): Promise<number> {
    if (!selectedResponseId) {
      return 0;
    }

    const parsedKey = this.parseDuplicateKey(duplicateKey);
    if (!parsedKey) {
      return 0;
    }

    const {
      unitId, variableId, subform, testTakerLogin
    } = parsedKey;

    const duplicateResponseIds = await this.findDuplicateResponses(
      manager,
      workspaceId,
      unitId,
      variableId,
      subform,
      testTakerLogin
    );

    if (duplicateResponseIds.length <= 1) {
      this.logger.debug(`No duplicates found for key: ${duplicateKey}`);
      return 0;
    }

    if (!duplicateResponseIds.includes(selectedResponseId)) {
      this.logger.warn(
        `Selected responseId ${selectedResponseId} not part of duplicate group ${duplicateKey}`
      );
      return 0;
    }

    const deleteIds = duplicateResponseIds.filter(
      id => id !== selectedResponseId
    );

    if (deleteIds.length === 0) {
      return 0;
    }

    const deletedCount = await this.deleteDuplicateResponses(
      manager,
      deleteIds
    );

    await this.logResolution(
      userId,
      workspaceId,
      duplicateKey,
      selectedResponseId,
      deleteIds
    );

    return deletedCount;
  }

  /**
   * Parse duplicate key into components
   *
   * Key format: "unitId|variableId|subform|testTakerLogin"
   */
  private parseDuplicateKey(key: string): {
    unitId: number;
    variableId: string;
    subform: string;
    testTakerLogin: string;
  } | null {
    const parts = key.split('|');
    if (parts.length !== 4) {
      this.logger.warn(`Invalid duplicate resolution key format: ${key}`);
      return null;
    }

    const unitId = Number(parts[0]);
    const variableId = decodeURIComponent(parts[1] || '');
    const subform = decodeURIComponent(parts[2] || '');
    const testTakerLogin = decodeURIComponent(parts[3] || '');

    if (!unitId || Number.isNaN(unitId) || !variableId || !testTakerLogin) {
      this.logger.warn(`Invalid duplicate resolution key components: ${key}`);
      return null;
    }

    return {
      unitId, variableId, subform, testTakerLogin
    };
  }

  /**
   * Find all duplicate responses matching the criteria
   */
  private async findDuplicateResponses(
    manager: EntityManager,
    workspaceId: number,
    unitId: number,
    variableId: string,
    subform: string,
    testTakerLogin: string
  ): Promise<number[]> {
    const responses = await manager
      .createQueryBuilder(ResponseEntity, 'response')
      .innerJoin('response.unit', 'unit')
      .innerJoin('unit.booklet', 'booklet')
      .innerJoin('booklet.person', 'person')
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true })
      .andWhere('person.login = :testTakerLogin', { testTakerLogin })
      .andWhere('unit.id = :unitId', { unitId })
      .andWhere('response.variableid = :variableId', { variableId })
      .andWhere("COALESCE(response.subform, '') = :subform", {
        subform: subform || ''
      })
      .select(['response.id'])
      .getMany();

    return (responses || []).map(r => r.id);
  }

  /**
   * Delete duplicate responses
   */
  private async deleteDuplicateResponses(
    manager: EntityManager,
    deleteIds: number[]
  ): Promise<number> {
    const deleteResult = await manager
      .createQueryBuilder()
      .delete()
      .from(ResponseEntity)
      .where('id IN (:...deleteIds)', { deleteIds })
      .execute();

    return deleteResult.affected || 0;
  }

  /**
   * Log duplicate resolution to journal
   */
  private async logResolution(
    userId: string,
    workspaceId: number,
    duplicateGroupKey: string,
    keptResponseId: number,
    deletedResponseIds: number[]
  ): Promise<void> {
    await this.journalService.createEntry(
      userId,
      workspaceId,
      'delete',
      'response',
      keptResponseId,
      {
        duplicateGroupKey,
        keptResponseId,
        deletedResponseIds
      }
    );
  }
}
