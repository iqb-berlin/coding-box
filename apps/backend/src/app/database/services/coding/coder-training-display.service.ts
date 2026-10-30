import {
  BadRequestException,
  Injectable
} from '@nestjs/common';
import { CoderTraining } from '../../entities/coder-training.entity';
import { CodingJob } from '../../entities/coding-job.entity';
import {
  WorkspaceExclusionService,
  isExcludedByResolvedExclusions
} from '../workspace/workspace-exclusion.service';
import {
  DEFAULT_MISSING_CODE_CONTEXT, MissingCodeDisplayContext, MissingCodePair, TrainingResponseJobUnit
} from './coder-training.types';
import {
  MissingsProfilesService
} from './missings-profiles.service';

@Injectable()
export class CoderTrainingDisplayService {
  constructor(
    private missingsProfilesService: MissingsProfilesService
  ) {}

  async buildMissingCodesByJobId(
    workspaceId: number,
    jobs: Array<Pick<CodingJob, 'id' | 'missings_profile_id'>>
  ): Promise<Map<number, MissingCodeDisplayContext>> {
    if (!Array.isArray(jobs)) {
      return new Map();
    }

    const defaultMissingCodes = await this.getDefaultMissingCodeDisplayContext(workspaceId);
    const profileIds = [...new Set(jobs
      .map(job => job.missings_profile_id)
      .filter((id): id is number => id !== null && id !== undefined))];

    const missingCodesByProfileId = new Map<number, MissingCodeDisplayContext>();

    for (const profileId of profileIds) {
      if (!this.missingsProfilesService?.getMissingsProfileDetails ||
          !this.missingsProfilesService?.getNegativeMissingCodesForProfileOrDefault) {
        missingCodesByProfileId.set(profileId, defaultMissingCodes);
        continue;
      }

      const [profile, negativeCodes] = await Promise.all([
        this.missingsProfilesService.getMissingsProfileDetails(workspaceId, profileId),
        this.missingsProfilesService.getNegativeMissingCodesForProfileOrDefault(workspaceId, profileId)
      ]);
      if (!profile) {
        throw new BadRequestException(`Missing profile ${profileId} not found`);
      }

      missingCodesByProfileId.set(
        profileId,
        {
          ...this.getMirMciCodesFromMissings(profile.parseMissings(), defaultMissingCodes),
          negativeCodes,
          scoresByCode: this.getMissingScoresByCodeFromMissings(
            profile.parseMissings(),
            defaultMissingCodes.scoresByCode
          )
        }
      );
    }

    const missingCodesByJobId = new Map<number, MissingCodeDisplayContext>();
    jobs.forEach(job => {
      const profileCodes = job.missings_profile_id ? missingCodesByProfileId.get(job.missings_profile_id) : undefined;
      missingCodesByJobId.set(job.id, profileCodes ?? defaultMissingCodes);
    });

    return missingCodesByJobId;
  }

  async getDefaultMissingCodeDisplayContext(workspaceId: number): Promise<MissingCodeDisplayContext> {
    if (!this.missingsProfilesService?.getNegativeMissingCodesForProfileOrDefault ||
        !this.missingsProfilesService?.ensureDefaultMissingsProfile) {
      return {
        ...DEFAULT_MISSING_CODE_CONTEXT,
        negativeCodes: new Set(DEFAULT_MISSING_CODE_CONTEXT.negativeCodes),
        scoresByCode: new Map(DEFAULT_MISSING_CODE_CONTEXT.scoresByCode)
      };
    }

    const [defaultProfile, negativeCodes] = await Promise.all([
      this.missingsProfilesService.ensureDefaultMissingsProfile(workspaceId),
      this.missingsProfilesService.getNegativeMissingCodesForProfileOrDefault(workspaceId, null)
    ]);

    return {
      ...this.getMirMciCodesFromMissings(defaultProfile.parseMissings()),
      negativeCodes,
      scoresByCode: this.getMissingScoresByCodeFromMissings(
        defaultProfile.parseMissings()
      )
    };
  }

  private getMissingScoresByCodeFromMissings(
    missings: Array<{ id?: string; code: number; score?: unknown }>,
    fallbackScoresByCode?: Map<number, number | null>
  ): Map<number, number | null> {
    const scoresByCode = new Map<number, number | null>(fallbackScoresByCode);

    missings.forEach(missing => {
      const code = Number(missing.code);
      if (!Number.isInteger(code) || code >= 0) {
        return;
      }

      if (!this.hasExplicitScoreProperty(missing) || !this.hasExplicitValidScore(missing.score)) {
        throw new BadRequestException(`Missing profile must define a score for code ${code}`);
      }

      scoresByCode.set(code, this.normalizeScore(missing.score));
    });

    return scoresByCode;
  }

  private hasExplicitScoreProperty(missing: { score?: unknown }): boolean {
    return Object.prototype.hasOwnProperty.call(missing, 'score');
  }

  private hasExplicitValidScore(score: unknown): boolean {
    if (score === null) {
      return true;
    }

    if (typeof score === 'number') {
      return Number.isFinite(score);
    }

    if (typeof score === 'string') {
      const trimmedScore = score.trim();
      return trimmedScore !== '' && Number.isFinite(Number(trimmedScore));
    }

    return false;
  }

  private normalizeScore(score: unknown): number | null {
    if (score === null) {
      return null;
    }

    return Number(score);
  }

  private getMissingScoreFromContext(
    missingCodes: MissingCodeDisplayContext,
    code: number
  ): number | null {
    const score = missingCodes.scoresByCode.get(code);
    if (score === undefined) {
      throw new BadRequestException(`Missing profile must define a score for code ${code}`);
    }

    return score;
  }

  private getMirMciCodesFromMissings(
    missings: Array<{ id?: string; label?: string; code: number }>,
    fallback?: MissingCodePair
  ): MissingCodePair {
    const mirMissing = missings.find(m => m.id === 'mir' ||
      m.label?.toLowerCase().includes('invalid') ||
      m.label?.toLowerCase().includes('spa')
    );

    const mciMissing = missings.find(m => m.id === 'mci' ||
      m.label?.toLowerCase().includes('coding impossible') ||
      m.label?.toLowerCase().includes('techn')
    );

    const mirCode = mirMissing?.code ?? fallback?.mirCode;
    const mciCode = mciMissing?.code ?? fallback?.mciCode;

    if (mirCode === undefined || mciCode === undefined || !Number.isInteger(mirCode) || !Number.isInteger(mciCode)) {
      throw new BadRequestException('Missing profile must define MIR and MCI codes');
    }

    return { mirCode, mciCode };
  }

  buildComparisonDisplayCodeSqlExpression(
    missingCodesByJobId: Map<number, MissingCodeDisplayContext>,
    defaultMissingCodeContext: MissingCodeDisplayContext
  ): string {
    const buildJobCase = (selector: (context: MissingCodeDisplayContext) => number): string => {
      const cases = Array.from(missingCodesByJobId.entries())
        .map(([jobId, context]) => `WHEN ${jobId} THEN '${selector(context)}'`)
        .join(' ');
      return `(CASE cj.id ${cases} ELSE '${selector(defaultMissingCodeContext)}' END)`;
    };

    return `CASE
      WHEN cju.code IS NULL AND cju.coding_issue_option IS NULL THEN NULL
      WHEN cju.code = -3 OR cju.coding_issue_option = -3 THEN ${buildJobCase(context => context.mirCode)}
      WHEN cju.code = -4 OR cju.coding_issue_option = -4 THEN ${buildJobCase(context => context.mciCode)}
      ELSE cju.code::text
    END`;
  }

  private toSqlScoreLiteral(score: number | null): string {
    return score === null ? 'NULL::integer' : score.toString();
  }

  private buildComparisonMissingScoreByJobSqlExpression(
    missingCodesByJobId: Map<number, MissingCodeDisplayContext>,
    defaultMissingCodeContext: MissingCodeDisplayContext,
    selector: (context: MissingCodeDisplayContext) => number | null
  ): string {
    const cases = Array.from(missingCodesByJobId.entries())
      .map(([jobId, context]) => `WHEN ${jobId} THEN ${this.toSqlScoreLiteral(selector(context))}`)
      .join(' ');
    return `(CASE cj.id ${cases} ELSE ${this.toSqlScoreLiteral(selector(defaultMissingCodeContext))} END)`;
  }

  private buildComparisonNegativeMissingScoreSqlExpression(
    context: MissingCodeDisplayContext
  ): string {
    const cases = Array.from(context.negativeCodes)
      .sort((a, b) => a - b)
      .map(code => `WHEN ${code} THEN ${this.toSqlScoreLiteral(this.getMissingScoreFromContext(context, code))}`)
      .join(' ');

    return cases.length > 0 ? `(CASE cju.code ${cases} ELSE cju.score END)` : 'cju.score';
  }

  private buildComparisonNegativeMissingScoreByJobSqlExpression(
    missingCodesByJobId: Map<number, MissingCodeDisplayContext>,
    defaultMissingCodeContext: MissingCodeDisplayContext
  ): string {
    const cases = Array.from(missingCodesByJobId.entries())
      .map(([jobId, context]) => `WHEN ${jobId} THEN ${this.buildComparisonNegativeMissingScoreSqlExpression(context)}`)
      .join(' ');
    return `(CASE cj.id ${cases} ELSE ${this.buildComparisonNegativeMissingScoreSqlExpression(defaultMissingCodeContext)} END)`;
  }

  buildComparisonDisplayScoreSqlExpression(
    missingCodesByJobId: Map<number, MissingCodeDisplayContext>,
    defaultMissingCodeContext: MissingCodeDisplayContext
  ): string {
    const mirScoreExpression = this.buildComparisonMissingScoreByJobSqlExpression(
      missingCodesByJobId,
      defaultMissingCodeContext,
      context => this.getMissingScoreFromContext(context, context.mirCode)
    );
    const mciScoreExpression = this.buildComparisonMissingScoreByJobSqlExpression(
      missingCodesByJobId,
      defaultMissingCodeContext,
      context => this.getMissingScoreFromContext(context, context.mciCode)
    );
    const negativeMissingScoreExpression = this.buildComparisonNegativeMissingScoreByJobSqlExpression(
      missingCodesByJobId,
      defaultMissingCodeContext
    );

    return `CASE
      WHEN cju.code IS NULL AND cju.coding_issue_option IS NULL THEN cju.score
      WHEN cju.code = -3 OR cju.coding_issue_option = -3 THEN ${mirScoreExpression}
      WHEN cju.code = -4 OR cju.coding_issue_option = -4 THEN ${mciScoreExpression}
      WHEN cju.code < 0 THEN ${negativeMissingScoreExpression}
      ELSE cju.score
    END`;
  }

  mapDisplayCodeAndScore(
    code: number | null,
    score: number | null,
    codingIssueOption: number | null,
    missingCodes: MissingCodeDisplayContext
  ): { code: string | null; score: number | null } {
    if (code === null && codingIssueOption === null) {
      return { code: null, score };
    }

    if (code === -3 || codingIssueOption === -3) {
      return {
        code: missingCodes.mirCode.toString(),
        score: this.getMissingScoreFromContext(missingCodes, missingCodes.mirCode)
      };
    }

    if (code === -4 || codingIssueOption === -4) {
      return {
        code: missingCodes.mciCode.toString(),
        score: this.getMissingScoreFromContext(missingCodes, missingCodes.mciCode)
      };
    }

    if (code !== null && code < 0 && missingCodes.negativeCodes.has(code)) {
      return {
        code: code.toString(),
        score: this.getMissingScoreFromContext(missingCodes, code)
      };
    }

    return {
      code: code !== null ? code.toString() : null,
      score
    };
  }

  findTrainingJobUnitsForResponse(
    training: CoderTraining,
    responseId: number,
    exclusions: Awaited<ReturnType<WorkspaceExclusionService['resolveExclusionsForQueries']>>
  ): TrainingResponseJobUnit[] {
    return (training.codingJobs || []).flatMap(job => {
      const unit = job.codingJobUnits?.find(candidate => (
        candidate.response_id === responseId &&
        !isExcludedByResolvedExclusions(exclusions, candidate.booklet_name, candidate.unit_name)
      ));

      return unit ? [{ job, unit }] : [];
    });
  }

  toNullableScore(score: number | string | null | undefined): number | null {
    if (score === null || score === undefined) {
      return null;
    }

    const numericScore = Number(score);
    return Number.isFinite(numericScore) ? numericScore : null;
  }

  async getMissingScoreForResponse(
    workspaceId: number,
    training: CoderTraining,
    responseId: number,
    code: number,
    exclusions: Awaited<ReturnType<WorkspaceExclusionService['resolveExclusionsForQueries']>>
  ): Promise<number | null> {
    const profileId = await this.resolveMissingProfileIdForResponse(
      workspaceId,
      training,
      responseId,
      exclusions
    );

    return this.getMissingScoreForProfile(workspaceId, profileId, code);
  }

  async getMissingScoreForProfile(
    workspaceId: number,
    profileId: number | null,
    code: number
  ): Promise<number | null> {
    try {
      return (await this.missingsProfilesService.getMissingByCodeForProfileOrDefault(
        workspaceId,
        profileId,
        code
      )).score;
    } catch (error) {
      if (error instanceof BadRequestException && error.message.includes('not found')) {
        throw new BadRequestException(`Unsupported missing code: ${code}`);
      }

      throw error;
    }
  }

  async resolveMissingProfileIdForResponse(
    workspaceId: number,
    training: CoderTraining,
    responseId: number,
    exclusions: Awaited<ReturnType<WorkspaceExclusionService['resolveExclusionsForQueries']>>
  ): Promise<number | null> {
    const jobUnits = this.findTrainingJobUnitsForResponse(training, responseId, exclusions);
    if (jobUnits.length === 0) {
      return null;
    }

    const resolvedProfileIds = await Promise.all(jobUnits.map(({ job }) => (
      this.missingsProfilesService.resolveMissingsProfileId(workspaceId, job.missings_profile_id)
    )));
    const profileKeys = new Set(resolvedProfileIds);
    if (profileKeys.size > 1) {
      throw new BadRequestException(`Conflicting missing profiles for response ${responseId} in training ${training.id}`);
    }

    return resolvedProfileIds[0];
  }
}
