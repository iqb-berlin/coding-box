import { Injectable } from '@nestjs/common';
import { TestPersonCodingService } from './test-person-coding.service';
import { CodingStatisticsWithJob, ResponseEntity, CodingStatistics } from '../../common';

@Injectable()
export class WorkspaceCodingFacade {
  constructor(
    private readonly testPersonCodingService: TestPersonCodingService
  ) {}

  async codeTestPersons(
    workspaceId: number,
    testPersonIdsOrGroups: string,
    autoCoderRun: number = 1
  ): Promise<CodingStatisticsWithJob> {
    return this.testPersonCodingService.codeTestPersons(workspaceId, testPersonIdsOrGroups, autoCoderRun);
  }

  async processTestPersonsBatch(
    workspaceId: number,
    options: { personIds: number[]; autoCoderRun?: number; jobId?: string },
    progressCallback?: (progress: number) => void
  ): Promise<CodingStatistics> {
    return this.testPersonCodingService.processTestPersonsBatch(workspaceId, options, progressCallback);
  }

  async getManualTestPersons(
    workspaceId: number,
    personIds?: string
  ): Promise<Array<ResponseEntity & { unitname: string }>> {
    return this.testPersonCodingService.getManualTestPersons(workspaceId, personIds);
  }
}
