import { BadRequestException, Injectable } from '@nestjs/common';
import { CodingFreshnessSummaryItemDto } from '../../../../../../../api-dto/coding/coding-freshness.dto';
import { CodingFreshnessService } from './coding-freshness.service';
import { CodingProgressService } from './coding-progress.service';

@Injectable()
export class AutoCodingRunGuardService {
  constructor(
    private readonly codingFreshnessService: CodingFreshnessService,
    private readonly codingProgressService: CodingProgressService
  ) {}

  async assertAutoCodingRunCanStart(
    workspaceId: number,
    autoCoderRun: number
  ): Promise<void> {
    if (autoCoderRun !== 2) {
      await this.codingFreshnessService.assertAutoCodingRunCanStart(
        workspaceId,
        autoCoderRun
      );
      return;
    }

    const expectedRevision = (await this.codingFreshnessService.getSummary(
      workspaceId
    )).currentRevision;
    const coverage = await this.codingProgressService.getCaseCoverageOverview(workspaceId);
    const effectiveUnassignedCases = Math.max(
      0,
      Number(coverage.effectiveUnassignedCases || 0)
    );
    const additionalBlockers: CodingFreshnessSummaryItemDto[] =
      effectiveUnassignedCases > 0 ? [{
        version: 'v2',
        state: 'MANUAL_REVIEW_REQUIRED',
        unitCount: effectiveUnassignedCases,
        affectedResponseCount: Math.max(
          effectiveUnassignedCases,
          Number(coverage.unassignedCases || 0)
        )
      }] : [];

    await this.codingFreshnessService.assertAutoCodingRunCanStart(
      workspaceId,
      autoCoderRun,
      additionalBlockers
    );

    if (effectiveUnassignedCases === 0) {
      await this.codingFreshnessService.reconcileCompletedManualCodingFreshness(
        workspaceId,
        expectedRevision
      );

      const revisionStillCurrent =
        await this.codingFreshnessService.isRevisionCurrent(
          workspaceId,
          expectedRevision
        );
      if (!revisionStillCurrent) {
        throw new BadRequestException(
          'Der Kodierstand wurde während der Startprüfung geändert. ' +
          'Bitte starten Sie den Autocoder-Lauf erneut.'
        );
      }
    }
  }
}
