import {
  Injectable, Logger
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  In,
  Repository
} from 'typeorm';
import {
  TrainingCodingComparisonPageDto,
  TrainingCodingComparisonRowDto,
  TrainingComparisonCoderDto,
  TrainingComparisonFiltersDto,
  TrainingComparisonNotesFilter,
  TrainingComparisonSortBy,
  TrainingComparisonSortDirection,
  TrainingComparisonSummaryDto,
  WithinTrainingCodingComparisonPageDto,
  WithinTrainingCodingComparisonRowDto,
  WithinTrainingComparisonCoderDto
} from '../../../../../../../api-dto/coding/training-comparison.dto';
import { CoderTrainingDiscussionResult } from '../../entities/coder-training-discussion-result.entity';
import { CoderTraining } from '../../entities/coder-training.entity';
import { CodingJobUnit } from '../../entities/coding-job-unit.entity';
import { CodingJob } from '../../entities/coding-job.entity';
import User from '../../entities/user.entity';
import {
  WorkspaceExclusionService,
  applyResolvedExclusionsToQuery,
  isExcludedByResolvedExclusions
} from '../workspace/workspace-exclusion.service';
import { CoderTrainingComparisonQueryService } from './coder-training-comparison-query.service';
import { CoderTrainingDiscussionService } from './coder-training-discussion.service';
import { CoderTrainingDisplayService } from './coder-training-display.service';
import {
  DiscussionSource, TrainingComparisonAggregateRow, TrainingComparisonCandidate, TrainingComparisonCodeSlot, TrainingComparisonPageOptions, TrainingComparisonStatus, WithinTrainingCoderResult, WithinTrainingCodingRow
} from './coder-training.types';
import { getWithinTrainingComparisonSelectedJobIds, getWithinTrainingJobCoderName, toFreshnessNumber } from './coder-training.util';

@Injectable()
export class CoderTrainingComparisonService {
  private readonly logger = new Logger('CoderTrainingService');

  constructor(
    @InjectRepository(CodingJob)
    private codingJobRepository: Repository<CodingJob>,
    @InjectRepository(CodingJobUnit)
    private codingJobUnitRepository: Repository<CodingJobUnit>,
    @InjectRepository(CoderTraining)
    private coderTrainingRepository: Repository<CoderTraining>,
    @InjectRepository(CoderTrainingDiscussionResult)
    private coderTrainingDiscussionResultRepository: Repository<CoderTrainingDiscussionResult>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private workspaceExclusionService: WorkspaceExclusionService,
    private readonly display: CoderTrainingDisplayService,
    private readonly comparisonQuery: CoderTrainingComparisonQueryService,
    private readonly discussion: CoderTrainingDiscussionService
  ) {}

  private normalizeComparisonPage(page?: number): number {
    const normalizedPage = Math.floor(Number(page ?? 1));
    return Number.isFinite(normalizedPage) && normalizedPage > 0 ? normalizedPage : 1;
  }

  private normalizeComparisonLimit(limit?: number): number {
    const normalizedLimit = Math.floor(Number(limit ?? 50));
    if (!Number.isFinite(normalizedLimit) || normalizedLimit <= 0) {
      return 50;
    }
    return Math.min(normalizedLimit, 500);
  }

  private normalizeComparisonSortBy(sortBy?: TrainingComparisonSortBy): TrainingComparisonSortBy {
    return sortBy ?? 'unitName';
  }

  private normalizeComparisonSortDirection(
    sortDirection?: TrainingComparisonSortDirection
  ): TrainingComparisonSortDirection {
    return sortDirection === 'desc' ? 'desc' : 'asc';
  }

  private matchesComparisonTextFilter(
    value: string | number | null | undefined,
    filter: string | null | undefined
  ): boolean {
    const normalizedFilter = (filter || '').trim();
    if (!normalizedFilter) {
      return true;
    }

    const text = String(value ?? '');
    return text.toLowerCase().includes(normalizedFilter.toLowerCase());
  }

  private matchesComparisonTextFilters(
    row: Pick<
      TrainingCodingComparisonRowDto,
    'unitName' | 'variableId' | 'personLogin' | 'personGroup' | 'bookletName'
    >,
    filters: TrainingComparisonFiltersDto
  ): boolean {
    return (
      this.matchesComparisonTextFilter(row.unitName, filters.unitName) &&
      this.matchesComparisonTextFilter(row.variableId, filters.variableId) &&
      this.matchesComparisonTextFilter(row.personLogin, filters.personLogin) &&
      this.matchesComparisonTextFilter(row.personGroup, filters.personGroup) &&
      this.matchesComparisonTextFilter(row.bookletName, filters.bookletName)
    );
  }

  private getComparisonStatusFromSlots(slots: TrainingComparisonCodeSlot[]): TrainingComparisonStatus {
    if (slots.length < 2) {
      return 'not_comparable';
    }

    if (slots.some(slot => !slot.hasEntry || slot.code === null)) {
      return 'incomplete';
    }

    const firstCode = slots[0].code;
    return slots.every(slot => slot.code === firstCode) ? 'match' : 'differ';
  }

  private parseTrainingCoderKey(key: string): { trainingId: number; coderId: number } | null {
    const [trainingIdRaw, coderIdRaw] = key.split('_');
    const trainingId = Number(trainingIdRaw);
    const coderId = Number(coderIdRaw);
    if (!Number.isInteger(trainingId) || !Number.isInteger(coderId)) {
      return null;
    }
    return { trainingId, coderId };
  }

  private getTrainingComparisonStatus(
    row: TrainingCodingComparisonRowDto,
    selectedTrainingIds: number[],
    selectedCoderKeys: string[]
  ): TrainingComparisonStatus {
    const slots: TrainingComparisonCodeSlot[] = selectedCoderKeys.map(key => {
      const parsedKey = this.parseTrainingCoderKey(key);
      if (!parsedKey) {
        return {
          code: null,
          hasEntry: false
        };
      }

      const coder = row.coders.find(item => (
        item.trainingId === parsedKey.trainingId &&
        item.coderId === parsedKey.coderId
      ));
      return {
        code: coder?.code ?? null,
        hasEntry: !!coder,
        trainingId: parsedKey.trainingId
      };
    });

    const trainingsWithSelectedCoder = new Set(slots
      .map(slot => slot.trainingId)
      .filter((trainingId): trainingId is number => trainingId !== undefined));
    selectedTrainingIds.forEach(trainingId => {
      if (!trainingsWithSelectedCoder.has(trainingId)) {
        slots.push({
          code: null,
          hasEntry: false,
          trainingId
        });
      }
    });

    return this.getComparisonStatusFromSlots(slots);
  }

  private getWithinTrainingComparisonStatus(
    row: WithinTrainingCodingComparisonRowDto,
    selectedJobIds: number[]
  ): TrainingComparisonStatus {
    const slots = selectedJobIds.map(jobId => {
      const coder = row.coders.find(item => item.jobId === jobId);
      return {
        code: coder?.code ?? null,
        hasEntry: !!coder
      };
    });
    return this.getComparisonStatusFromSlots(slots);
  }

  private rowHasTrainingComparisonNotes(
    row: TrainingCodingComparisonRowDto,
    selectedCoderKeys: string[]
  ): boolean {
    return selectedCoderKeys.some(key => {
      const parsedKey = this.parseTrainingCoderKey(key);
      if (!parsedKey) {
        return false;
      }
      const coder = row.coders.find(item => (
        item.trainingId === parsedKey.trainingId &&
        item.coderId === parsedKey.coderId
      ));
      return !!coder?.notes?.trim();
    });
  }

  private rowHasWithinTrainingComparisonNotes(
    row: WithinTrainingCodingComparisonRowDto,
    selectedJobIds: number[]
  ): boolean {
    return selectedJobIds.some(jobId => {
      const coder = row.coders.find(item => item.jobId === jobId);
      return !!coder?.notes?.trim();
    });
  }

  private matchesComparisonStateFilters(
    status: TrainingComparisonStatus,
    hasNotes: boolean,
    filters: TrainingComparisonFiltersDto
  ): boolean {
    if (filters.match === 'match' && status !== 'match') {
      return false;
    }
    if (filters.match === 'differ' && status !== 'differ') {
      return false;
    }

    const notesMode: TrainingComparisonNotesFilter = filters.notesMode ?? 'all';
    if (notesMode === 'none') {
      return !hasNotes;
    }
    if (notesMode === 'with-notes') {
      return hasNotes;
    }

    return true;
  }

  private calculateComparisonSummary<T>(
    rows: T[],
    getStatus: (row: T) => TrainingComparisonStatus
  ): TrainingComparisonSummaryDto {
    const statuses = rows.map(row => getStatus(row));
    const comparableRows = statuses.filter(status => status === 'match' || status === 'differ').length;
    const matchingRows = statuses.filter(status => status === 'match').length;
    const incompleteRows = statuses.filter(status => status === 'incomplete').length;
    const notComparableRows = statuses.filter(status => status === 'not_comparable').length;
    const visibleRows = rows.length;

    return {
      visibleRows,
      comparableRows,
      matchingRows,
      matchingPercentage: comparableRows > 0 ? Math.round((matchingRows / comparableRows) * 100) : 0,
      incompleteRows,
      notComparableRows,
      deviationRows: Math.max(comparableRows - matchingRows, 0),
      completionRate: visibleRows > 0 ? Math.round((comparableRows / visibleRows) * 100) : 0
    };
  }

  private getComparisonSortValue(
    row: Pick<
      TrainingCodingComparisonRowDto,
    'responseId' | 'unitName' | 'variableId' | 'personLogin' | 'personGroup' | 'bookletName'
    >,
    sortBy: TrainingComparisonSortBy
  ): string | number {
    return row[sortBy] ?? '';
  }

  private compareComparisonValues(a: string | number, b: string | number): number {
    if (typeof a === 'number' && typeof b === 'number') {
      return a - b;
    }
    return String(a).localeCompare(String(b), 'de');
  }

  private sortComparisonRows<T extends Pick<
    TrainingCodingComparisonRowDto,
  'responseId' | 'unitName' | 'variableId' | 'personLogin' | 'personGroup' | 'bookletName'
  >>(
    rows: T[],
    sortBy?: TrainingComparisonSortBy,
    sortDirection?: TrainingComparisonSortDirection
  ): T[] {
    const normalizedSortBy = this.normalizeComparisonSortBy(sortBy);
    const directionMultiplier = this.normalizeComparisonSortDirection(sortDirection) === 'desc' ? -1 : 1;

    return [...rows].sort((a, b) => {
      const primary = this.compareComparisonValues(
        this.getComparisonSortValue(a, normalizedSortBy),
        this.getComparisonSortValue(b, normalizedSortBy)
      );
      if (primary !== 0) {
        return primary * directionMultiplier;
      }

      return (
        this.compareComparisonValues(a.unitName, b.unitName) ||
        this.compareComparisonValues(a.variableId, b.variableId) ||
        this.compareComparisonValues(a.personLogin, b.personLogin) ||
        this.compareComparisonValues(a.responseId, b.responseId)
      );
    });
  }

  private getTrainingComparisonAvailableCoders(
    rows: TrainingCodingComparisonRowDto[]
  ): TrainingComparisonCoderDto[] {
    const codersByKey = new Map<string, TrainingComparisonCoderDto>();
    rows.forEach(row => {
      row.coders.forEach(coder => {
        const key = `${coder.trainingId}_${coder.coderId}`;
        if (!codersByKey.has(key)) {
          codersByKey.set(key, {
            trainingId: coder.trainingId,
            trainingLabel: coder.trainingLabel,
            coderId: coder.coderId,
            coderName: coder.coderName
          });
        }
      });
    });

    return Array.from(codersByKey.values()).sort((a, b) => (
      a.trainingId - b.trainingId || a.coderName.localeCompare(b.coderName, 'de')
    ));
  }

  private getWithinTrainingComparisonAvailableCoders(
    rows: WithinTrainingCodingComparisonRowDto[]
  ): WithinTrainingComparisonCoderDto[] {
    const codersByJobId = new Map<number, WithinTrainingComparisonCoderDto>();
    rows.forEach(row => {
      row.coders.forEach(coder => {
        if (!codersByJobId.has(coder.jobId)) {
          codersByJobId.set(coder.jobId, {
            jobId: coder.jobId,
            coderName: coder.coderName
          });
        }
      });
    });

    return Array.from(codersByJobId.values()).sort((a, b) => a.jobId - b.jobId);
  }

  private paginateComparisonRows<T>(rows: T[], page: number, limit: number): T[] {
    return rows.slice((page - 1) * limit, page * limit);
  }

  private toBooleanValue(value: boolean | string | number | null | undefined): boolean {
    return value === true || value === 'true' || value === 1 || value === '1';
  }

  private getComparisonStatusFromAggregate(
    row: Pick<TrainingComparisonAggregateRow, 'completeCodeCount' | 'distinctCodeCount'>,
    slotCount: number
  ): TrainingComparisonStatus {
    if (slotCount < 2) {
      return 'not_comparable';
    }

    const completeCodeCount = toFreshnessNumber(row.completeCodeCount);
    if (completeCodeCount < slotCount) {
      return 'incomplete';
    }

    return toFreshnessNumber(row.distinctCodeCount) <= 1 ? 'match' : 'differ';
  }

  private toComparisonCandidate(
    row: TrainingComparisonAggregateRow,
    slotCount: number
  ): TrainingComparisonCandidate {
    const personGroup = row.personGroup || '';
    return {
      responseId: toFreshnessNumber(row.responseId),
      unitName: row.unitName,
      variableId: row.variableId,
      personCode: row.personCode,
      personLogin: row.personLogin,
      personGroup,
      bookletName: row.bookletName,
      testPerson: `${row.personLogin} (${personGroup}) - ${row.bookletName}`,
      status: this.getComparisonStatusFromAggregate(row, slotCount),
      hasNotes: this.toBooleanValue(row.hasNotes)
    };
  }

  private matchesComparisonCandidateFilters(
    row: TrainingComparisonCandidate,
    filters: TrainingComparisonFiltersDto
  ): boolean {
    return this.matchesComparisonTextFilters(row, filters) &&
      this.matchesComparisonStateFilters(row.status, row.hasNotes, filters);
  }

  private calculateComparisonSummaryFromCandidates(
    rows: TrainingComparisonCandidate[]
  ): TrainingComparisonSummaryDto {
    return this.calculateComparisonSummary(rows, row => row.status);
  }

  private getTrainingComparisonSelection(
    selectedTrainingIds: number[],
    selectedCoderKeys: string[],
    availableCoders: TrainingComparisonCoderDto[]
  ): { selectedJobIds: number[]; slotCount: number } {
    const trainingIds = [...new Set(selectedTrainingIds)];
    const selectedTrainingIdSet = new Set(trainingIds);
    const availableCoderKeys = new Set(availableCoders.map(coder => `${coder.trainingId}_${coder.coderId}`));
    const normalizedKeyMap = new Map<string, { trainingId: number; coderId: number }>();
    const parsedKeys = selectedCoderKeys
      .map(key => this.parseTrainingCoderKey(key))
      .filter((key): key is { trainingId: number; coderId: number } => (
        key !== null &&
        selectedTrainingIdSet.has(key.trainingId) &&
        availableCoderKeys.has(`${key.trainingId}_${key.coderId}`)
      ));
    parsedKeys.forEach(key => {
      normalizedKeyMap.set(`${key.trainingId}_${key.coderId}`, key);
    });
    const normalizedKeys = [...normalizedKeyMap.values()];
    const selectedTrainingKeys = new Set(normalizedKeys.map(key => key.trainingId));
    const missingTrainingSlots = trainingIds
      .filter(trainingId => !selectedTrainingKeys.has(trainingId))
      .length;

    return {
      selectedJobIds: [...new Set(normalizedKeys.map(key => key.coderId))],
      slotCount: normalizedKeys.length + missingTrainingSlots
    };
  }

  async getTrainingCodingComparison(
    workspaceId: number,
    trainingIds: number[]
  ): Promise<Array<{
    responseId: number;
    unitName: string;
    variableId: string;
    personCode: string;
    personLogin: string;
    personGroup: string;
    bookletName: string;
    testPerson: string;
    coders: Array<{
      trainingId: number;
      trainingLabel: string;
      coderId: number;
      coderName: string;
      code: string | null;
      score: number | null;
      notes: string | null;
      codingIssueOption: number | null;
    }>;
  }>> {
    this.logger.log(`Getting coding comparison for trainings ${trainingIds.join(', ')} in workspace ${workspaceId}`);

    const trainings = await this.coderTrainingRepository.find({
      where: {
        workspace_id: workspaceId,
        id: In(trainingIds)
      },
      relations: [
        'codingJobs',
        'codingJobs.codingJobUnits',
        'codingJobs.codingJobCoders',
        'codingJobs.codingJobCoders.user'
      ],
      order: { label: 'ASC' }
    });

    if (trainings.length === 0) {
      return [];
    }

    const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
    const allTrainingJobs = trainings.flatMap(training => training.codingJobs || []);
    const missingCodesByJobId = await this.display.buildMissingCodesByJobId(workspaceId, allTrainingJobs);
    const defaultMissingCodeContext = await this.display.getDefaultMissingCodeDisplayContext(workspaceId);

    const responseMap = new Map<number, {
      unitName: string;
      variableId: string;
      personCode: string;
      personLogin: string;
      personGroup: string;
      bookletName: string;
      testPerson: string;
    }>();

    // Identify all unique responses involved across all selected trainings
    trainings.forEach(training => {
      training.codingJobs?.forEach(job => {
        job.codingJobUnits?.forEach(unit => {
          if (isExcludedByResolvedExclusions(exclusions, unit.booklet_name, unit.unit_name)) {
            return;
          }
          if (unit.response_id && !responseMap.has(unit.response_id)) {
            const personGroup = unit.person_group || '';
            const testPerson = `${unit.person_login} (${personGroup}) - ${unit.booklet_name}`;

            responseMap.set(unit.response_id, {
              unitName: unit.unit_name,
              variableId: unit.variable_id,
              personCode: unit.person_code,
              personLogin: unit.person_login,
              personGroup: personGroup,
              bookletName: unit.booklet_name,
              testPerson
            });
          }
        });
      });
    });

    const comparisonData: Array<{
      responseId: number;
      unitName: string;
      variableId: string;
      personCode: string;
      personLogin: string;
      personGroup: string;
      bookletName: string;
      testPerson: string;
      coders: Array<{
        trainingId: number;
        trainingLabel: string;
        coderId: number;
        coderName: string;
        code: string | null;
        score: number | null;
        notes: string | null;
        codingIssueOption: number | null;
      }>;
    }> = [];

    // For each unique response, find how it was coded in each training by ALL coders
    for (const [responseId, info] of responseMap.entries()) {
      const codersData: Array<{
        trainingId: number;
        trainingLabel: string;
        coderId: number;
        coderName: string;
        code: string | null;
        score: number | null;
        notes: string | null;
        codingIssueOption: number | null;
      }> = [];

      for (const training of trainings) {
        if (training.codingJobs) {
          for (const job of training.codingJobs) {
            // Find if this job (coder) has a unit for this response
            const unit = job.codingJobUnits?.find(u => (
              u.response_id === responseId &&
              !isExcludedByResolvedExclusions(exclusions, u.booklet_name, u.unit_name)
            ));

            // Determine coder info
            // Assuming one coder per job for now, which is standard in this system
            const coderUser = job.codingJobCoders?.[0]?.user;

            // If no user assigned (rare), use job name? CoderTrainingService logic usually ensures assignment.
            // But let's be safe.
            const coderName = coderUser ? coderUser.username : `Job ${job.id}`;

            if (unit) {
              // This coder HAS this response assigned
              const mappedDisplay = this.display.mapDisplayCodeAndScore(
                unit.code,
                unit.score,
                unit.coding_issue_option,
                missingCodesByJobId.get(job.id) ?? defaultMissingCodeContext
              );

              codersData.push({
                trainingId: training.id,
                trainingLabel: training.label,
                coderId: job.id,
                coderName: coderName,
                code: mappedDisplay.code,
                score: mappedDisplay.score,
                notes: unit.notes,
                codingIssueOption: unit.coding_issue_option
              });
            }
          }
        }
      }

      comparisonData.push({
        responseId,
        unitName: info.unitName,
        variableId: info.variableId,
        personCode: info.personCode,
        personLogin: info.personLogin,
        personGroup: info.personGroup,
        bookletName: info.bookletName,
        testPerson: info.testPerson,
        coders: codersData
      });
    }

    // Sort by Unit, Variable, then Person
    comparisonData.sort((a, b) => {
      if (a.unitName !== b.unitName) return a.unitName.localeCompare(b.unitName);
      if (a.variableId !== b.variableId) return a.variableId.localeCompare(b.variableId);
      return a.personLogin.localeCompare(b.personLogin);
    });

    this.logger.log(`Generated comparison data for ${comparisonData.length} unique responses across ${trainings.length} trainings`);

    return comparisonData;
  }

  async getTrainingCodingComparisonPage(
    workspaceId: number,
    trainingIds: number[],
    options: TrainingComparisonPageOptions = {}
  ): Promise<TrainingCodingComparisonPageDto> {
    const page = this.normalizeComparisonPage(options.page);
    const limit = this.normalizeComparisonLimit(options.limit);
    const filters = options.filters ?? {};
    if (trainingIds.length === 0) {
      return {
        data: [],
        total: 0,
        page,
        limit,
        totalPages: 0,
        summary: this.calculateComparisonSummaryFromCandidates([]),
        availableCoders: []
      };
    }

    const trainings = await this.coderTrainingRepository.find({
      where: {
        workspace_id: workspaceId,
        id: In(trainingIds)
      },
      relations: [
        'codingJobs',
        'codingJobs.codingJobCoders',
        'codingJobs.codingJobCoders.user'
      ],
      order: { label: 'ASC' }
    });

    if (trainings.length === 0) {
      return {
        data: [],
        total: 0,
        page,
        limit,
        totalPages: 0,
        summary: this.calculateComparisonSummaryFromCandidates([]),
        availableCoders: []
      };
    }

    const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
    const allTrainingJobs = trainings.flatMap(training => (
      (training.codingJobs || []).map(job => ({
        ...job,
        training
      }))
    ));
    const [missingCodesByJobId, defaultMissingCodeContext, availableCoders] = await Promise.all([
      this.display.buildMissingCodesByJobId(workspaceId, allTrainingJobs),
      this.display.getDefaultMissingCodeDisplayContext(workspaceId),
      this.comparisonQuery.getTrainingComparisonAvailableCodersForJobs(workspaceId, trainingIds, allTrainingJobs, exclusions)
    ]);
    const selectedCoderKeys = options.selectedCoderKeys ?? availableCoders
      .map(coder => `${coder.trainingId}_${coder.coderId}`);
    const selection = this.getTrainingComparisonSelection(trainingIds, selectedCoderKeys, availableCoders);
    const aggregateRows = await this.comparisonQuery.getTrainingComparisonAggregateRows(
      workspaceId,
      trainingIds,
      selection.selectedJobIds,
      missingCodesByJobId,
      defaultMissingCodeContext,
      exclusions
    );

    const filteredCandidates = aggregateRows
      .map(row => this.toComparisonCandidate(row, selection.slotCount))
      .filter(row => this.matchesComparisonCandidateFilters(row, filters));
    const sortedCandidates = this.sortComparisonRows(filteredCandidates, options.sortBy, options.sortDirection);
    const pageCandidates = this.paginateComparisonRows(sortedCandidates, page, limit);
    const pageRows = await this.comparisonQuery.getTrainingComparisonRowsForResponseIds(
      workspaceId,
      trainingIds,
      pageCandidates.map(row => row.responseId),
      pageCandidates,
      missingCodesByJobId,
      defaultMissingCodeContext,
      exclusions
    );

    return {
      data: pageRows,
      total: filteredCandidates.length,
      page,
      limit,
      totalPages: Math.ceil(filteredCandidates.length / limit),
      summary: this.calculateComparisonSummaryFromCandidates(filteredCandidates),
      availableCoders
    };
  }

  async getWithinTrainingCodingComparison(
    workspaceId: number,
    trainingId: number
  ): Promise<Array<{
    responseId: number;
    unitName: string;
    variableId: string;
    personCode: string;
    personLogin: string;
    personGroup: string;
    bookletName: string;
    testPerson: string;
    givenAnswer: string;
    replayCode: number | null;
    replayScore: number | null;
    discussionCode: number | null;
    discussionScore: number | null;
    discussionNotes: string | null;
    discussionManagerUserId: number | null;
    discussionManagerName: string | null;
    discussionSource: DiscussionSource;
    coders: WithinTrainingCoderResult[];
  }>> {
    this.logger.log(`Getting within-training coding comparison for training ${trainingId} in workspace ${workspaceId}`);

    const training = await this.coderTrainingRepository.findOne({
      where: {
        workspace_id: workspaceId,
        id: trainingId
      }
    });

    if (!training) {
      return [];
    }

    const jobs = await this.codingJobRepository.find({
      where: {
        workspace_id: workspaceId,
        training_id: trainingId
      },
      relations: ['codingJobCoders.user'],
      order: { id: 'ASC' }
    });

    if (jobs.length === 0) {
      return [];
    }

    const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
    const missingCodesByJobId = await this.display.buildMissingCodesByJobId(workspaceId, jobs);
    const defaultMissingCodeContext = await this.display.getDefaultMissingCodeDisplayContext(workspaceId);
    const coderNameByJobId = new Map<number, string>();
    jobs.forEach(job => {
      const coderName = job.codingJobCoders?.[0]?.user?.username ?
        `${job.codingJobCoders[0].user.username}` :
        `Coder ${job.name}`;
      coderNameByJobId.set(job.id, coderName);
    });

    const unitVariableMap = new Map<string, {
      responseId: number;
      unitName: string;
      variableId: string;
      personCode: string;
      personLogin: string;
      personGroup: string;
      bookletName: string;
      testPerson: string;
      givenAnswer: string;
      replayCode: number | null;
      replayScore: number | null;
    }>();

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
      .orderBy('cju.id', 'ASC')
      .addOrderBy('cj.id', 'ASC');

    applyResolvedExclusionsToQuery(query, exclusions, {
      unitNameExpression: 'cju.unit_name',
      bookletNameExpression: 'cju.booklet_name',
      parameterPrefix: 'withinTrainingComparison'
    });

    const rows = await query.getRawMany<WithinTrainingCodingRow>();
    const unitsByResponseId = new Map<number, Map<number, WithinTrainingCodingRow>>();

    rows.forEach(row => {
      const responseId = this.display.toNullableScore(row.responseId);
      const jobId = this.display.toNullableScore(row.jobId);
      if (responseId === null || jobId === null) {
        return;
      }

      const unitVariableKey = responseId.toString();
      if (!unitVariableMap.has(unitVariableKey)) {
        const personGroup = row.personGroup || '';
        const testPerson = `${row.personLogin} (${personGroup}) - ${row.bookletName}`;

        unitVariableMap.set(unitVariableKey, {
          responseId,
          unitName: row.unitName,
          variableId: row.variableId,
          personCode: row.personCode,
          personLogin: row.personLogin,
          personGroup,
          bookletName: row.bookletName,
          testPerson,
          givenAnswer: row.givenAnswer || '',
          replayCode: this.display.toNullableScore(row.replayCodeV3) ??
            this.display.toNullableScore(row.replayCodeV2) ??
            this.display.toNullableScore(row.replayCodeV1),
          replayScore: this.display.toNullableScore(row.replayScoreV3) ??
            this.display.toNullableScore(row.replayScoreV2) ??
            this.display.toNullableScore(row.replayScoreV1)
        });
      }

      if (!unitsByResponseId.has(responseId)) {
        unitsByResponseId.set(responseId, new Map<number, WithinTrainingCodingRow>());
      }
      unitsByResponseId.get(responseId)!.set(jobId, row);
    });

    const comparisonData = [];
    const responseIds = Array.from(unitVariableMap.values()).map(item => item.responseId);
    const persistedDiscussionResults = responseIds.length > 0 ?
      await this.coderTrainingDiscussionResultRepository.find({
        where: {
          workspace_id: workspaceId,
          training_id: trainingId,
          response_id: In(responseIds)
        }
      }) :
      [];
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

    for (const [, unitVar] of unitVariableMap.entries()) {
      const unitsByJobId = unitsByResponseId.get(unitVar.responseId) ?? new Map<number, WithinTrainingCodingRow>();
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

      const discussionResult = discussionByResponseId.get(unitVar.responseId);
      const hasManualDiscussionResult = discussionResult?.code !== null && discussionResult?.code !== undefined;
      const automaticDiscussionResult = hasManualDiscussionResult ?
        null :
        await this.discussion.deriveAutomaticDiscussionResultForRawResponse(
          workspaceId,
          trainingId,
          unitVar.responseId,
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

      comparisonData.push({
        responseId: unitVar.responseId,
        unitName: unitVar.unitName,
        variableId: unitVar.variableId,
        personCode: unitVar.personCode,
        personLogin: unitVar.personLogin,
        personGroup: unitVar.personGroup,
        bookletName: unitVar.bookletName,
        testPerson: unitVar.testPerson,
        givenAnswer: unitVar.givenAnswer,
        replayCode: unitVar.replayCode,
        replayScore: unitVar.replayScore,
        discussionCode,
        discussionScore,
        discussionNotes,
        discussionManagerUserId,
        discussionManagerName,
        discussionSource,
        coders: codersData
      });
    }

    this.logger.log(`Generated within-training comparison data for ${comparisonData.length} unit/variable combinations across ${jobs.length} coders`);

    return comparisonData;
  }

  async getWithinTrainingCodingComparisonPage(
    workspaceId: number,
    trainingId: number,
    options: TrainingComparisonPageOptions = {}
  ): Promise<WithinTrainingCodingComparisonPageDto> {
    const page = this.normalizeComparisonPage(options.page);
    const limit = this.normalizeComparisonLimit(options.limit);
    const filters = options.filters ?? {};
    const training = await this.coderTrainingRepository.findOne({
      where: {
        workspace_id: workspaceId,
        id: trainingId
      }
    });

    if (!training) {
      return {
        data: [],
        total: 0,
        page,
        limit,
        totalPages: 0,
        summary: this.calculateComparisonSummaryFromCandidates([]),
        availableCoders: []
      };
    }

    const jobs = await this.codingJobRepository.find({
      where: {
        workspace_id: workspaceId,
        training_id: trainingId
      },
      relations: ['codingJobCoders.user'],
      order: { id: 'ASC' }
    });

    if (jobs.length === 0) {
      return {
        data: [],
        total: 0,
        page,
        limit,
        totalPages: 0,
        summary: this.calculateComparisonSummaryFromCandidates([]),
        availableCoders: []
      };
    }

    const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
    const [missingCodesByJobId, defaultMissingCodeContext] = await Promise.all([
      this.display.buildMissingCodesByJobId(workspaceId, jobs),
      this.display.getDefaultMissingCodeDisplayContext(workspaceId)
    ]);
    const selectedJobIds = getWithinTrainingComparisonSelectedJobIds(options.selectedJobIds, jobs);
    const aggregateRows = await this.comparisonQuery.getWithinTrainingComparisonAggregateRows(
      workspaceId,
      trainingId,
      selectedJobIds,
      missingCodesByJobId,
      defaultMissingCodeContext,
      exclusions
    );
    const availableCoders = aggregateRows.length > 0 ?
      jobs.map(job => ({
        jobId: job.id,
        coderName: getWithinTrainingJobCoderName(job)
      })) :
      [];
    const slotCount = selectedJobIds.length;

    const filteredCandidates = aggregateRows
      .map(row => this.toComparisonCandidate(row, slotCount))
      .filter(row => this.matchesComparisonCandidateFilters(row, filters));
    const sortedCandidates = this.sortComparisonRows(filteredCandidates, options.sortBy, options.sortDirection);
    const pageCandidates = this.paginateComparisonRows(sortedCandidates, page, limit);
    const pageRows = await this.comparisonQuery.getWithinTrainingComparisonRowsForResponseIds(
      workspaceId,
      trainingId,
      pageCandidates.map(row => row.responseId),
      pageCandidates,
      jobs,
      missingCodesByJobId,
      defaultMissingCodeContext,
      exclusions
    );

    return {
      data: pageRows,
      total: filteredCandidates.length,
      page,
      limit,
      totalPages: Math.ceil(filteredCandidates.length / limit),
      summary: this.calculateComparisonSummaryFromCandidates(filteredCandidates),
      availableCoders
    };
  }
}
