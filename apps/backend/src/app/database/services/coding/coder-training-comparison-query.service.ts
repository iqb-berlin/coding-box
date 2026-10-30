import {
  Injectable
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  In,
  Repository
} from 'typeorm';
import {
  TrainingCodingComparisonRowDto,
  TrainingComparisonCoderDto,
  WithinTrainingCodingComparisonRowDto
} from '../../../../../../../api-dto/coding/training-comparison.dto';
import { CoderTrainingDiscussionResult } from '../../entities/coder-training-discussion-result.entity';
import { CoderTraining } from '../../entities/coder-training.entity';
import { CodingJobUnit } from '../../entities/coding-job-unit.entity';
import { CodingJob } from '../../entities/coding-job.entity';
import User from '../../entities/user.entity';
import {
  WorkspaceExclusionService,
  applyResolvedExclusionsToQuery
} from '../workspace/workspace-exclusion.service';
import { CoderTrainingDiscussionService } from './coder-training-discussion.service';
import { CoderTrainingDisplayService } from './coder-training-display.service';
import {
  DiscussionSource, MissingCodeDisplayContext, TrainingComparisonAggregateRow, TrainingComparisonCandidate, TrainingComparisonRawUnitRow, WithinTrainingCoderResult, WithinTrainingCodingRow
} from './coder-training.types';
import { getTrainingJobCoderName, getWithinTrainingJobCoderName, toFreshnessNumber } from './coder-training.util';

@Injectable()
export class CoderTrainingComparisonQueryService {
  constructor(
    @InjectRepository(CodingJobUnit)
    private codingJobUnitRepository: Repository<CodingJobUnit>,
    @InjectRepository(CoderTrainingDiscussionResult)
    private coderTrainingDiscussionResultRepository: Repository<CoderTrainingDiscussionResult>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private readonly display: CoderTrainingDisplayService,
    private readonly discussion: CoderTrainingDiscussionService
  ) {}

  private addComparisonAggregateSelects(
    query: ReturnType<Repository<CodingJobUnit>['createQueryBuilder']>,
    selectedJobIds: number[],
    displayCodeExpression: string,
    selectedJobParameterName: string
  ): void {
    if (selectedJobIds.length === 0) {
      query
        .addSelect('0', 'completeCodeCount')
        .addSelect('0', 'distinctCodeCount')
        .addSelect('false', 'hasNotes');
      return;
    }

    const selectedJobCondition = `cj.id IN (:...${selectedJobParameterName})`;
    query
      .addSelect(
        `COUNT(DISTINCT cj.id) FILTER (WHERE ${selectedJobCondition} AND (${displayCodeExpression}) IS NOT NULL)`,
        'completeCodeCount'
      )
      .addSelect(
        `COUNT(DISTINCT (${displayCodeExpression})) FILTER (WHERE ${selectedJobCondition} AND (${displayCodeExpression}) IS NOT NULL)`,
        'distinctCodeCount'
      )
      .addSelect(
        `COALESCE(BOOL_OR(${selectedJobCondition} AND cju.notes IS NOT NULL AND BTRIM(cju.notes) <> ''), false)`,
        'hasNotes'
      )
      .setParameter(selectedJobParameterName, selectedJobIds);
  }

  async getTrainingComparisonAvailableCodersForJobs(
    workspaceId: number,
    trainingIds: number[],
    jobs: Array<Pick<CodingJob, 'id' | 'name' | 'training_id'> & {
      training?: Pick<CoderTraining, 'id' | 'label'> | null;
      codingJobCoders?: Array<{ user?: { username?: string | null } | null }> | null;
    }>,
    exclusions: Awaited<ReturnType<WorkspaceExclusionService['resolveExclusionsForQueries']>>
  ): Promise<TrainingComparisonCoderDto[]> {
    if (jobs.length === 0) {
      return [];
    }

    const query = this.codingJobUnitRepository
      .createQueryBuilder('cju')
      .innerJoin('cju.coding_job', 'cj')
      .select('DISTINCT cj.id', 'jobId')
      .where('cj.workspace_id = :workspaceId', { workspaceId })
      .andWhere('cj.training_id IN (:...trainingIds)', { trainingIds });

    applyResolvedExclusionsToQuery(query, exclusions, {
      unitNameExpression: 'cju.unit_name',
      bookletNameExpression: 'cju.booklet_name',
      parameterPrefix: 'trainingComparisonAvailableCoders'
    });

    const rows = await query.getRawMany<{ jobId: number | string }>();
    const jobIdsWithUnits = new Set(rows.map(row => toFreshnessNumber(row.jobId)));

    return jobs
      .filter(job => jobIdsWithUnits.has(job.id))
      .map(job => ({
        trainingId: job.training?.id ?? job.training_id!,
        trainingLabel: job.training?.label ?? '',
        coderId: job.id,
        coderName: getTrainingJobCoderName(job)
      }))
      .sort((a, b) => (
        a.trainingId - b.trainingId || a.coderName.localeCompare(b.coderName, 'de')
      ));
  }

  async getTrainingComparisonAggregateRows(
    workspaceId: number,
    trainingIds: number[],
    selectedJobIds: number[],
    missingCodesByJobId: Map<number, MissingCodeDisplayContext>,
    defaultMissingCodeContext: MissingCodeDisplayContext,
    exclusions: Awaited<ReturnType<WorkspaceExclusionService['resolveExclusionsForQueries']>>
  ): Promise<TrainingComparisonAggregateRow[]> {
    const displayCodeExpression = this.display.buildComparisonDisplayCodeSqlExpression(
      missingCodesByJobId,
      defaultMissingCodeContext
    );
    const query = this.codingJobUnitRepository
      .createQueryBuilder('cju')
      .innerJoin('cju.coding_job', 'cj')
      .select('cju.response_id', 'responseId')
      .addSelect('MIN(cju.unit_name)', 'unitName')
      .addSelect('MIN(cju.variable_id)', 'variableId')
      .addSelect('MIN(cju.person_code)', 'personCode')
      .addSelect('MIN(cju.person_login)', 'personLogin')
      .addSelect('MIN(cju.person_group)', 'personGroup')
      .addSelect('MIN(cju.booklet_name)', 'bookletName')
      .where('cj.workspace_id = :workspaceId', { workspaceId })
      .andWhere('cj.training_id IN (:...trainingIds)', { trainingIds })
      .groupBy('cju.response_id');

    this.addComparisonAggregateSelects(
      query,
      selectedJobIds,
      displayCodeExpression,
      'trainingComparisonSelectedJobIds'
    );
    applyResolvedExclusionsToQuery(query, exclusions, {
      unitNameExpression: 'cju.unit_name',
      bookletNameExpression: 'cju.booklet_name',
      parameterPrefix: 'trainingComparisonAggregate'
    });

    return query.getRawMany<TrainingComparisonAggregateRow>();
  }

  async getTrainingComparisonRowsForResponseIds(
    workspaceId: number,
    trainingIds: number[],
    responseIds: number[],
    pageCandidates: TrainingComparisonCandidate[],
    missingCodesByJobId: Map<number, MissingCodeDisplayContext>,
    defaultMissingCodeContext: MissingCodeDisplayContext,
    exclusions: Awaited<ReturnType<WorkspaceExclusionService['resolveExclusionsForQueries']>>
  ): Promise<TrainingCodingComparisonRowDto[]> {
    if (responseIds.length === 0) {
      return [];
    }

    const query = this.codingJobUnitRepository
      .createQueryBuilder('cju')
      .innerJoin('cju.coding_job', 'cj')
      .innerJoin('cj.training', 'ct')
      .leftJoin('cj.codingJobCoders', 'cjc')
      .leftJoin('cjc.user', 'coderUser')
      .select('ct.id', 'trainingId')
      .addSelect('ct.label', 'trainingLabel')
      .addSelect('cj.id', 'jobId')
      .addSelect('coderUser.username', 'coderName')
      .addSelect('cj.missings_profile_id', 'missingsProfileId')
      .addSelect('cju.response_id', 'responseId')
      .addSelect('cju.unit_name', 'unitName')
      .addSelect('cju.variable_id', 'variableId')
      .addSelect('cju.person_code', 'personCode')
      .addSelect('cju.person_login', 'personLogin')
      .addSelect('cju.person_group', 'personGroup')
      .addSelect('cju.booklet_name', 'bookletName')
      .addSelect('cju.code', 'code')
      .addSelect('cju.score', 'score')
      .addSelect('cju.notes', 'notes')
      .addSelect('cju.coding_issue_option', 'codingIssueOption')
      .where('cj.workspace_id = :workspaceId', { workspaceId })
      .andWhere('cj.training_id IN (:...trainingIds)', { trainingIds })
      .andWhere('cju.response_id IN (:...responseIds)', { responseIds })
      .orderBy('ct.label', 'ASC')
      .addOrderBy('cj.id', 'ASC')
      .addOrderBy('cju.id', 'ASC');

    applyResolvedExclusionsToQuery(query, exclusions, {
      unitNameExpression: 'cju.unit_name',
      bookletNameExpression: 'cju.booklet_name',
      parameterPrefix: 'trainingComparisonRows'
    });

    const rawRows = await query.getRawMany<TrainingComparisonRawUnitRow>();
    const codersByResponseId = new Map<number, TrainingCodingComparisonRowDto['coders']>();
    const seenSlots = new Set<string>();
    rawRows.forEach(row => {
      const responseId = toFreshnessNumber(row.responseId);
      const jobId = toFreshnessNumber(row.jobId);
      const slotKey = `${responseId}:${jobId}`;
      if (seenSlots.has(slotKey)) {
        return;
      }
      seenSlots.add(slotKey);

      const code = this.display.toNullableScore(row.code);
      const score = this.display.toNullableScore(row.score);
      const codingIssueOption = this.display.toNullableScore(row.codingIssueOption);
      const mappedDisplay = this.display.mapDisplayCodeAndScore(
        code,
        score,
        codingIssueOption,
        missingCodesByJobId.get(jobId) ?? defaultMissingCodeContext
      );
      const coders = codersByResponseId.get(responseId) ?? [];
      coders.push({
        trainingId: toFreshnessNumber(row.trainingId),
        trainingLabel: row.trainingLabel,
        coderId: jobId,
        coderName: row.coderName || `Job ${jobId}`,
        code: mappedDisplay.code,
        score: mappedDisplay.score,
        notes: row.notes,
        codingIssueOption
      });
      codersByResponseId.set(responseId, coders);
    });

    return pageCandidates.map(candidate => ({
      responseId: candidate.responseId,
      unitName: candidate.unitName,
      variableId: candidate.variableId,
      personCode: candidate.personCode,
      personLogin: candidate.personLogin,
      personGroup: candidate.personGroup,
      bookletName: candidate.bookletName,
      testPerson: candidate.testPerson,
      coders: codersByResponseId.get(candidate.responseId) ?? []
    }));
  }

  async getWithinTrainingComparisonAggregateRows(
    workspaceId: number,
    trainingId: number,
    selectedJobIds: number[],
    missingCodesByJobId: Map<number, MissingCodeDisplayContext>,
    defaultMissingCodeContext: MissingCodeDisplayContext,
    exclusions: Awaited<ReturnType<WorkspaceExclusionService['resolveExclusionsForQueries']>>
  ): Promise<TrainingComparisonAggregateRow[]> {
    const displayCodeExpression = this.display.buildComparisonDisplayCodeSqlExpression(
      missingCodesByJobId,
      defaultMissingCodeContext
    );
    const query = this.codingJobUnitRepository
      .createQueryBuilder('cju')
      .innerJoin('cju.coding_job', 'cj')
      .select('cju.response_id', 'responseId')
      .addSelect('MIN(cju.unit_name)', 'unitName')
      .addSelect('MIN(cju.variable_id)', 'variableId')
      .addSelect('MIN(cju.person_code)', 'personCode')
      .addSelect('MIN(cju.person_login)', 'personLogin')
      .addSelect('MIN(cju.person_group)', 'personGroup')
      .addSelect('MIN(cju.booklet_name)', 'bookletName')
      .where('cj.workspace_id = :workspaceId', { workspaceId })
      .andWhere('cj.training_id = :trainingId', { trainingId })
      .groupBy('cju.response_id');

    this.addComparisonAggregateSelects(
      query,
      selectedJobIds,
      displayCodeExpression,
      'withinTrainingComparisonSelectedJobIds'
    );
    applyResolvedExclusionsToQuery(query, exclusions, {
      unitNameExpression: 'cju.unit_name',
      bookletNameExpression: 'cju.booklet_name',
      parameterPrefix: 'withinTrainingComparisonAggregate'
    });

    return query.getRawMany<TrainingComparisonAggregateRow>();
  }

  async getWithinTrainingComparisonRowsForResponseIds(
    workspaceId: number,
    trainingId: number,
    responseIds: number[],
    pageCandidates: TrainingComparisonCandidate[],
    jobs: Array<Pick<CodingJob, 'id' | 'name' | 'missings_profile_id'> & {
      codingJobCoders?: Array<{ user?: { username?: string | null } | null }> | null;
    }>,
    missingCodesByJobId: Map<number, MissingCodeDisplayContext>,
    defaultMissingCodeContext: MissingCodeDisplayContext,
    exclusions: Awaited<ReturnType<WorkspaceExclusionService['resolveExclusionsForQueries']>>
  ): Promise<WithinTrainingCodingComparisonRowDto[]> {
    if (responseIds.length === 0) {
      return [];
    }

    const coderNameByJobId = new Map<number, string>();
    jobs.forEach(job => {
      coderNameByJobId.set(job.id, getWithinTrainingJobCoderName(job));
    });

    const query = this.codingJobUnitRepository
      .createQueryBuilder('cju')
      .innerJoin('cju.coding_job', 'cj')
      .leftJoin('cju.response', 'resp')
      .select('cj.id', 'jobId')
      .addSelect('cju.id', 'unitRowId')
      .addSelect('cju.response_id', 'responseId')
      .addSelect('cju.unit_name', 'unitName')
      .addSelect('cju.variable_id', 'variableId')
      .addSelect('cju.person_code', 'personCode')
      .addSelect('cju.person_login', 'personLogin')
      .addSelect('cju.person_group', 'personGroup')
      .addSelect('cju.booklet_name', 'bookletName')
      .addSelect('resp.value', 'givenAnswer')
      .addSelect('resp.code_v1', 'replayCodeV1')
      .addSelect('resp.code_v2', 'replayCodeV2')
      .addSelect('resp.code_v3', 'replayCodeV3')
      .addSelect('resp.score_v1', 'replayScoreV1')
      .addSelect('resp.score_v2', 'replayScoreV2')
      .addSelect('resp.score_v3', 'replayScoreV3')
      .addSelect('cju.code', 'code')
      .addSelect('cju.score', 'score')
      .addSelect('cju.notes', 'notes')
      .addSelect('cju.coding_issue_option', 'codingIssueOption')
      .where('cj.workspace_id = :workspaceId', { workspaceId })
      .andWhere('cj.training_id = :trainingId', { trainingId })
      .andWhere('cju.response_id IN (:...responseIds)', { responseIds })
      .orderBy('cju.id', 'ASC')
      .addOrderBy('cj.id', 'ASC');

    applyResolvedExclusionsToQuery(query, exclusions, {
      unitNameExpression: 'cju.unit_name',
      bookletNameExpression: 'cju.booklet_name',
      parameterPrefix: 'withinTrainingComparisonRows'
    });

    const rawRows = await query.getRawMany<WithinTrainingCodingRow>();
    const unitsByResponseId = new Map<number, Map<number, WithinTrainingCodingRow>>();
    const firstRowByResponseId = new Map<number, WithinTrainingCodingRow>();

    rawRows.forEach(row => {
      const responseId = this.display.toNullableScore(row.responseId);
      const jobId = this.display.toNullableScore(row.jobId);
      if (responseId === null || jobId === null) {
        return;
      }

      if (!firstRowByResponseId.has(responseId)) {
        firstRowByResponseId.set(responseId, row);
      }
      if (!unitsByResponseId.has(responseId)) {
        unitsByResponseId.set(responseId, new Map<number, WithinTrainingCodingRow>());
      }
      unitsByResponseId.get(responseId)!.set(jobId, row);
    });

    const persistedDiscussionResults = await this.coderTrainingDiscussionResultRepository.find({
      where: {
        workspace_id: workspaceId,
        training_id: trainingId,
        response_id: In(responseIds)
      }
    });
    const discussionByResponseId = new Map<number, CoderTrainingDiscussionResult>();
    persistedDiscussionResults.forEach(result => {
      discussionByResponseId.set(result.response_id, result);
    });

    const managerUserIds = [...new Set(persistedDiscussionResults
      .map(result => result.manager_user_id)
      .filter((id): id is number => id !== null && id !== undefined))];
    const managerNameById = new Map<number, string>();
    if (managerUserIds.length > 0) {
      const users = await this.userRepository.find({
        where: { id: In(managerUserIds) }
      });
      users.forEach(user => {
        managerNameById.set(user.id, user.username);
      });
    }

    const resultRows: WithinTrainingCodingComparisonRowDto[] = [];
    for (const candidate of pageCandidates) {
      const unitsByJobId = unitsByResponseId.get(candidate.responseId) ?? new Map<number, WithinTrainingCodingRow>();
      const firstRow = firstRowByResponseId.get(candidate.responseId);
      const codersData: WithinTrainingCoderResult[] = jobs.map(job => {
        const unit = unitsByJobId.get(job.id);
        const code = this.display.toNullableScore(unit?.code);
        const score = this.display.toNullableScore(unit?.score);
        const codingIssueOption = this.display.toNullableScore(unit?.codingIssueOption);
        const mappedDisplay = this.display.mapDisplayCodeAndScore(
          code,
          score,
          codingIssueOption,
          missingCodesByJobId.get(job.id) ?? defaultMissingCodeContext
        );

        return {
          jobId: job.id,
          coderName: coderNameByJobId.get(job.id) ?? `Coder ${job.name}`,
          code: mappedDisplay.code,
          score: mappedDisplay.score,
          notes: unit?.notes ?? null,
          codingIssueOption
        };
      });

      const discussionResult = discussionByResponseId.get(candidate.responseId);
      const hasManualDiscussionResult = discussionResult?.code !== null && discussionResult?.code !== undefined;
      const automaticDiscussionResult = hasManualDiscussionResult ?
        null :
        await this.discussion.deriveAutomaticDiscussionResultForRawResponse(
          workspaceId,
          trainingId,
          candidate.responseId,
          jobs,
          unitsByJobId,
          codersData
        );
      let discussionCode = automaticDiscussionResult?.code ?? null;
      let discussionScore = automaticDiscussionResult?.score ?? null;
      let discussionNotes: string | null = null;
      let discussionManagerUserId: number | null = null;
      let discussionManagerName: string | null = null;
      let discussionSource: DiscussionSource = automaticDiscussionResult ? 'auto_agreement' : null;

      if (hasManualDiscussionResult) {
        discussionCode = discussionResult!.code;
        discussionScore = discussionResult!.score;
        discussionNotes = discussionResult!.notes ?? null;
        discussionManagerUserId = discussionResult!.manager_user_id ?? null;
        discussionManagerName = discussionResult!.manager_user_id ?
          (managerNameById.get(discussionResult!.manager_user_id) ?? discussionResult!.manager_name ?? null) :
          (discussionResult!.manager_name ?? null);
        discussionSource = 'manual';
      }

      resultRows.push({
        responseId: candidate.responseId,
        unitName: candidate.unitName,
        variableId: candidate.variableId,
        personCode: candidate.personCode,
        personLogin: candidate.personLogin,
        personGroup: candidate.personGroup,
        bookletName: candidate.bookletName,
        testPerson: candidate.testPerson,
        givenAnswer: firstRow?.givenAnswer || '',
        replayCode: this.display.toNullableScore(firstRow?.replayCodeV3) ??
          this.display.toNullableScore(firstRow?.replayCodeV2) ??
          this.display.toNullableScore(firstRow?.replayCodeV1),
        replayScore: this.display.toNullableScore(firstRow?.replayScoreV3) ??
          this.display.toNullableScore(firstRow?.replayScoreV2) ??
          this.display.toNullableScore(firstRow?.replayScoreV1),
        discussionCode,
        discussionScore,
        discussionNotes,
        discussionManagerUserId,
        discussionManagerName,
        discussionSource,
        coders: codersData
      });
    }

    return resultRows;
  }
}
