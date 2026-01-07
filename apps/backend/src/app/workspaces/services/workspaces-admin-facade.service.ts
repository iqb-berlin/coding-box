import { Injectable } from '@nestjs/common';
import { WorkspaceUsersService } from './workspace-users.service';
import { WorkspacePlayerService } from './workspace-player.service';
import { TestcenterService, Result } from './testcenter.service';
import { UploadResultsService } from './upload-results.service';
import { PersonService } from './person.service';
import { UnitTagService } from './unit-tag.service';
import { UnitNoteService } from './unit-note.service';
import { ResourcePackageService } from './resource-package.service';
import { JournalService } from './journal.service';
import { JobService } from './job.service';
import { ValidationTaskService } from './validation-task.service';
import { ReplayStatisticsService } from './replay-statistics.service';
import { BookletInfoService } from './booklet-info.service';
import { UnitInfoService } from './unit-info.service';
import { VariableAnalysisService } from './variable-analysis.service';
import { MissingsProfilesService } from './missings-profiles.service';
import { MissingsProfilesDto } from '../../../../../../api-dto/coding/missings-profiles.dto';
import { CreateUnitTagDto } from '../../../../../../api-dto/unit-tags/create-unit-tag.dto';
import { UpdateUnitTagDto } from '../../../../../../api-dto/unit-tags/update-unit-tag.dto';
import { CreateUnitNoteDto } from '../../../../../../api-dto/unit-notes/create-unit-note.dto';
import { UpdateUnitNoteDto } from '../../../../../../api-dto/unit-notes/update-unit-note.dto';
import { FileIo } from '../../admin/workspace/file-io.interface';
import { ImportOptions } from '../../../../../frontend/src/app/services/import.service';
import { UnitTagDto } from '../../../../../../api-dto/unit-tags/unit-tag.dto';
import { UnitNoteDto } from '../../../../../../api-dto/unit-notes/unit-note.dto';
import { ResourcePackageDto } from '../../../../../../api-dto/resource-package/resource-package-dto';
import { JournalEntry } from '../entities/journal-entry.entity';

@Injectable()
export class WorkspacesAdminFacade {
  constructor(
    private readonly usersService: WorkspaceUsersService,
    private readonly playerService: WorkspacePlayerService,
    private readonly testcenterService: TestcenterService,
    private readonly uploadResultsService: UploadResultsService,
    private readonly personService: PersonService,
    private readonly unitTagService: UnitTagService,
    private readonly unitNoteService: UnitNoteService,
    private readonly resourcePackageService: ResourcePackageService,
    private readonly journalService: JournalService,
    private readonly jobService: JobService,
    private readonly validationTaskService: ValidationTaskService,
    private readonly replayStatisticsService: ReplayStatisticsService,
    private readonly bookletInfoService: BookletInfoService,
    private readonly unitInfoService: UnitInfoService,
    private readonly variableAnalysisService: VariableAnalysisService,
    private readonly missingsProfilesService: MissingsProfilesService
  ) {}

  // Users
  async findUsers(workspaceId: number, options?: { page: number; limit: number }) {
    return this.usersService.findUsers(workspaceId, options);
  }

  async setWorkspaceUsers(workspaceId: number, userIds: number[]) {
    return this.usersService.setWorkspaceUsers(workspaceId, userIds);
  }

  async findCoders(workspaceId: number) {
    return this.usersService.findCoders(workspaceId);
  }

  async findAllUserWorkspaces(identity: string) {
    return this.usersService.findAllUserWorkspaces(identity);
  }

  // Persons
  async markPersonsAsNotConsidered(workspaceId: number, logins: string[]) {
    return this.personService.markPersonsAsNotConsidered(workspaceId, logins);
  }

  async markPersonsAsConsidered(workspaceId: number, logins: string[]) {
    return this.personService.markPersonsAsConsidered(workspaceId, logins);
  }

  // Testcenter
  async authenticateTestCenter(credentials: { username: string, password: string, server: string, url: string }) {
    return this.testcenterService.authenticate(credentials);
  }

  async getTestgroups(workspace_id: string, tc_workspace: string, server: string, url: string, authToken: string) {
    return this.testcenterService.getTestgroups(workspace_id, tc_workspace, server, url, authToken);
  }

  async importWorkspaceFiles(
    workspace_id: string,
    tc_workspace: string,
    server: string,
    url: string,
    authToken: string,
    importOptions: ImportOptions,
    testGroups: string,
    overwriteExistingLogs: boolean = true,
    overwriteFileIds?: string[]
  ): Promise<Result> {
    return this.testcenterService.importWorkspaceFiles(
      workspace_id,
      tc_workspace,
      server,
      url,
      authToken,
      importOptions,
      testGroups,
      overwriteExistingLogs,
      overwriteFileIds
    );
  }

  // Upload Results
  async uploadTestResults(
    workspace_id: number,
    originalFiles: FileIo[],
    resultType:'logs' | 'responses',
    overwriteExisting: boolean = true,
    personMatchMode?: 'strict' | 'loose',
    overwriteMode: 'skip' | 'merge' | 'replace' = 'skip',
    scope: 'person' | 'workspace' | 'group' | 'booklet' | 'unit' | 'response' = 'person',
    scopeFilters: { groupName?: string; bookletName?: string; unitNameOrAlias?: string; variableId?: string; subform?: string } | undefined = undefined
  ) {
    return this.uploadResultsService.uploadTestResults(
      workspace_id, originalFiles, resultType, overwriteExisting, personMatchMode, overwriteMode, scope, scopeFilters
    );
  }

  // Unit Tags
  async createUnitTag(createUnitTagDto: CreateUnitTagDto): Promise<UnitTagDto> {
    return this.unitTagService.create(createUnitTagDto);
  }

  async findAllUnitTags(unitId: number): Promise<UnitTagDto[]> {
    return this.unitTagService.findAllByUnitId(unitId);
  }

  async findOneUnitTag(id: number): Promise<UnitTagDto> {
    return this.unitTagService.findOne(id);
  }

  async updateUnitTag(id: number, updateUnitTagDto: UpdateUnitTagDto): Promise<UnitTagDto> {
    return this.unitTagService.update(id, updateUnitTagDto);
  }

  async removeUnitTag(id: number): Promise<boolean> {
    return this.unitTagService.remove(id);
  }

  // Unit Notes
  async createUnitNote(createUnitNoteDto: CreateUnitNoteDto): Promise<UnitNoteDto> {
    return this.unitNoteService.create(createUnitNoteDto);
  }

  async findAllUnitNotes(unitId: number): Promise<UnitNoteDto[]> {
    return this.unitNoteService.findAllByUnitId(unitId);
  }

  async findAllUnitNotesByUnitIds(unitIds: number[]): Promise<{ [unitId: number]: UnitNoteDto[] }> {
    return this.unitNoteService.findAllByUnitIds(unitIds);
  }

  async findOneUnitNote(id: number): Promise<UnitNoteDto> {
    return this.unitNoteService.findOne(id);
  }

  async updateUnitNote(id: number, updateUnitNoteDto: UpdateUnitNoteDto): Promise<UnitNoteDto> {
    return this.unitNoteService.update(id, updateUnitNoteDto);
  }

  async removeUnitNote(id: number): Promise<boolean> {
    return this.unitNoteService.remove(id);
  }

  // Resource Packages
  async findResourcePackages(workspaceId: number): Promise<ResourcePackageDto[]> {
    return this.resourcePackageService.findResourcePackages(workspaceId);
  }

  async removeResourcePackage(workspaceId: number, id: number): Promise<void> {
    return this.resourcePackageService.removeResourcePackage(workspaceId, id);
  }

  async removeResourcePackages(workspaceId: number, ids: number[]): Promise<void> {
    return this.resourcePackageService.removeResourcePackages(workspaceId, ids);
  }

  async getZippedResourcePackage(workspaceId: number, name: string): Promise<Buffer> {
    return this.resourcePackageService.getZippedResourcePackage(workspaceId, name);
  }

  async createResourcePackage(workspaceId: number, file: Express.Multer.File): Promise<number> {
    return this.resourcePackageService.create(workspaceId, file);
  }

  // Journal
  async createJournalEntry(
    userId: string,
    workspaceId: number,
    actionType: string,
    entityType: string,
    entityId: number,
    details?: Record<string, unknown>
  ): Promise<JournalEntry> {
    return this.journalService.createEntry(userId, workspaceId, actionType, entityType, entityId, details);
  }

  async searchJournalEntries(
    filters: {
      workspaceId: number;
      userId?: string;
      actionType?: string;
      entityType?: string;
      entityId?: number;
      fromDate?: Date;
      toDate?: Date;
    },
    options: { page?: number; limit?: number }
  ): Promise<{ data: JournalEntry[]; total: number }> {
    return this.journalService.search(filters, options);
  }

  async generateJournalCsv(workspaceId: number): Promise<string> {
    return this.journalService.generateCsv(workspaceId);
  }

  // Jobs
  async getJobs(workspaceId: number) {
    return this.jobService.getJobs(workspaceId);
  }

  async getJob(jobId: number, workspaceId: number) {
    return this.jobService.getJob(jobId, workspaceId);
  }

  async cancelJob(jobId: number) {
    return this.jobService.cancelJob(jobId);
  }

  async deleteJob(jobId: number) {
    return this.jobService.deleteJob(jobId);
  }

  // Validation Tasks
  async createValidationTask(
    workspaceId: number,
    type: 'variables' | 'variableTypes' | 'responseStatus' | 'testTakers' | 'groupResponses' | 'deleteResponses' | 'deleteAllResponses' | 'duplicateResponses',
    page?: number,
    limit?: number,
    additionalData?: Record<string, unknown>
  ) {
    return this.validationTaskService.createValidationTask(workspaceId, type, page, limit, additionalData);
  }

  async getValidationTasks(workspaceId: number) {
    return this.validationTaskService.getValidationTasks(workspaceId);
  }

  async getValidationTask(taskId: number, workspaceId: number) {
    return this.validationTaskService.getValidationTask(taskId, workspaceId);
  }

  async getValidationResults(taskId: number, workspaceId: number) {
    return this.validationTaskService.getValidationResults(taskId, workspaceId);
  }

  // Replay Statistics
  async storeReplayStatistics(data: {
    workspaceId: number;
    unitId: string;
    bookletId?: string;
    testPersonLogin?: string;
    testPersonCode?: string;
    durationMilliseconds: number;
    replayUrl?: string;
    success?: boolean;
    errorMessage?: string;
  }) {
    return this.replayStatisticsService.storeReplayStatistics(data);
  }

  async getReplayStatistics(workspaceId: number) {
    return this.replayStatisticsService.getReplayStatistics(workspaceId);
  }

  async getReplayFrequencyByUnit(workspaceId: number, options: { from?: string; to?: string; lastDays?: string; limit?: string }) {
    return this.replayStatisticsService.getReplayFrequencyByUnit(workspaceId, options);
  }

  async getReplayDurationStatistics(workspaceId: number, unitId?: string, options?: { from?: string; to?: string; lastDays?: string }) {
    return this.replayStatisticsService.getReplayDurationStatistics(workspaceId, unitId, options);
  }

  async getReplayDistributionByDay(workspaceId: number, options: { from?: string; to?: string; lastDays?: string }) {
    return this.replayStatisticsService.getReplayDistributionByDay(workspaceId, options);
  }

  async getReplayDistributionByHour(workspaceId: number, options: { from?: string; to?: string; lastDays?: string }) {
    return this.replayStatisticsService.getReplayDistributionByHour(workspaceId, options);
  }

  async getReplayErrorStatistics(workspaceId: number, options: { from?: string; to?: string; lastDays?: string; limit?: string }) {
    return this.replayStatisticsService.getReplayErrorStatistics(workspaceId, options);
  }

  async getFailureDistributionByUnit(workspaceId: number, options: { from?: string; to?: string; lastDays?: string; limit?: string }) {
    return this.replayStatisticsService.getFailureDistributionByUnit(workspaceId, options);
  }

  async getFailureDistributionByDay(workspaceId: number, options: { from?: string; to?: string; lastDays?: string }) {
    return this.replayStatisticsService.getFailureDistributionByDay(workspaceId, options);
  }

  async getFailureDistributionByHour(workspaceId: number, options: { from?: string; to?: string; lastDays?: string }) {
    return this.replayStatisticsService.getFailureDistributionByHour(workspaceId, options);
  }

  // Booklet Info
  async getBookletInfo(workspaceId: number, bookletId: string) {
    return this.bookletInfoService.getBookletInfo(workspaceId, bookletId);
  }

  // Unit Info
  async getUnitInfo(workspaceId: number, unitId: string) {
    return this.unitInfoService.getUnitInfo(workspaceId, unitId);
  }

  // Player
  async findPlayer(workspaceId: number, playerName: string) {
    return this.playerService.findPlayer(workspaceId, playerName);
  }

  async findTestPersonUnits(id: number, testPerson: string) {
    return this.playerService.findTestPersonUnits(id, testPerson);
  }

  async findTestPersons(id: number) {
    return this.playerService.findTestPersons(id);
  }

  async findUnitDef(workspaceId: number, unitId: string) {
    return this.playerService.findUnitDef(workspaceId, unitId);
  }

  async findUnit(workspaceId: number, unitId: string) {
    return this.playerService.findUnit(workspaceId, unitId);
  }

  async getBookletUnits(workspaceId: number, bookletId: string) {
    return this.playerService.getBookletUnits(workspaceId, bookletId);
  }

  // Variable Analysis
  async getVariableFrequencies(workspaceId: number, unitId?: number, variableId?: string) {
    return this.variableAnalysisService.getVariableFrequencies(workspaceId, unitId, variableId);
  }

  async createVariableAnalysisJob(workspaceId: number, unitId?: number, variableId?: string) {
    return this.variableAnalysisService.createAnalysisJob(workspaceId, unitId, variableId);
  }

  async getVariableAnalysisJobs(workspaceId: number) {
    return this.variableAnalysisService.getAnalysisJobs(workspaceId);
  }

  async getVariableAnalysisJob(jobId: number, workspaceId: number) {
    return this.variableAnalysisService.getAnalysisJob(jobId, workspaceId);
  }

  async getVariableAnalysisResults(jobId: number, workspaceId: number) {
    return this.variableAnalysisService.getAnalysisResults(jobId, workspaceId);
  }

  // Missings Profiles
  async getMissingsProfiles(workspaceId: number) {
    return this.missingsProfilesService.getMissingsProfiles(workspaceId);
  }

  async getMissingsProfileDetails(workspaceId: number, id: number) {
    return this.missingsProfilesService.getMissingsProfileDetails(workspaceId, id);
  }

  async getMissingsProfileByLabel(label: string) {
    return this.missingsProfilesService.getMissingsProfileByLabel(label);
  }

  async createMissingsProfile(workspaceId: number, profile: MissingsProfilesDto) {
    return this.missingsProfilesService.createMissingsProfile(workspaceId, profile);
  }

  async updateMissingsProfile(workspaceId: number, label: string, profile: MissingsProfilesDto) {
    return this.missingsProfilesService.updateMissingsProfile(workspaceId, label, profile);
  }

  async deleteMissingsProfile(workspaceId: number, label: string) {
    return this.missingsProfilesService.deleteMissingsProfile(workspaceId, label);
  }
}
