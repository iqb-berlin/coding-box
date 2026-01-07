import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, QueryRunner } from 'typeorm';
import { CodingScheme } from '@iqbspecs/coding-scheme';
import {
  ResponseEntity, CodingStatisticsWithJob, Unit, FileUpload, CodingStatistics
} from '../../common';
import { CodingJob } from '../entities/coding-job.entity';
import { WorkspacesFacadeService } from '../../workspaces/services/workspaces-facade.service';
import { WorkspaceFilesFacade } from '../../workspaces/services/workspace-files-facade.service';
import { BullJobManagementService } from './bull-job-management.service';
import { CodingStatisticsService } from './coding-statistics.service';
import { CodingFileCache } from './coding-file-cache.service';
import { CodingProcessor } from './coding-processor.service';

@Injectable()
export class TestPersonCodingService {
  private readonly logger = new Logger(TestPersonCodingService.name);

  constructor(
    private dataSource: DataSource,
    private workspacesFacadeService: WorkspacesFacadeService,
    private workspaceFilesFacade: WorkspaceFilesFacade,
    @InjectRepository(CodingJob)
    private codingJobRepository: Repository<CodingJob>,
    @InjectRepository(FileUpload)
    private bullJobManagementService: BullJobManagementService,
    private codingStatisticsService: CodingStatisticsService,
    private codingFileCache: CodingFileCache,
    private codingProcessor: CodingProcessor
  ) {}

  async codeTestPersons(
    workspace_id: number,
    testPersonIdsOrGroups: string,
    autoCoderRun: number = 1
  ): Promise<CodingStatisticsWithJob> {
    if (
      !workspace_id ||
      !testPersonIdsOrGroups ||
      testPersonIdsOrGroups.trim() === ''
    ) {
      this.logger.warn(
        'Ungültige Eingabeparameter: workspace_id oder testPersonIdsOrGroups fehlen.'
      );
      return { totalResponses: 0, statusCounts: {} };
    }

    const groupsOrIds = testPersonIdsOrGroups
      .split(',')
      .filter(item => item.trim() !== '');
    if (groupsOrIds.length === 0) {
      this.logger.warn('Keine gültigen Gruppen oder Personen-IDs angegeben.');
      return { totalResponses: 0, statusCounts: {} };
    }

    const areAllNumbers = groupsOrIds.every(
      item => !Number.isNaN(Number(item))
    );

    let personIds: string[] = [];

    if (areAllNumbers) {
      personIds = groupsOrIds;
      this.logger.log(`Using provided person IDs: ${personIds.length} persons`);
    } else {
      this.logger.log(`Fetching persons for groups: ${groupsOrIds.join(', ')}`);

      try {
        const persons = await this.workspacesFacadeService.findPersonsByGroup(workspace_id, groupsOrIds);

        personIds = persons.map(person => person.id.toString());
        this.logger.log(
          `Found ${personIds.length} persons in the specified groups`
        );

        if (personIds.length === 0) {
          this.logger.warn(
            `No persons found in groups: ${groupsOrIds.join(', ')}`
          );
          return {
            totalResponses: 0,
            statusCounts: {},
            message: `No persons found in the selected groups: ${groupsOrIds.join(
              ', '
            )}`
          };
        }
      } catch (error) {
        this.logger.error(
          `Error fetching persons for groups: ${error.message}`,
          error.stack
        );
        return {
          totalResponses: 0,
          statusCounts: {},
          message: `Error fetching persons for groups: ${error.message}`
        };
      }
    }

    this.logger.log(
      `Starting job for ${personIds.length} test persons in workspace ${workspace_id}`
    );

    const bullJob = await this.bullJobManagementService.addTestPersonCodingJob({
      workspaceId: workspace_id,
      personIds,
      groupNames: !areAllNumbers ? groupsOrIds.join(',') : undefined,
      autoCoderRun
    });

    this.logger.log(`Added job to Redis queue with ID ${bullJob.id}`);

    return {
      totalResponses: 0,
      statusCounts: {},
      jobId: bullJob.id.toString(),
      message: `Processing ${personIds.length} test persons in the background. Check job status with jobId: ${bullJob.id}`
    };
  }

  async getManualTestPersons(
    workspace_id: number,
    personIds?: string
  ): Promise<Array<ResponseEntity & { unitname: string }>> {
    this.logger.log(
      `Fetching responses for workspace_id = ${workspace_id} ${
        personIds ? `and personIds = ${personIds}` : ''
      }.`
    );

    try {
      const persons = await this.workspacesFacadeService.findConsideringPersons(workspace_id);

      if (!persons.length) {
        this.logger.log(`No persons found for workspace_id = ${workspace_id}.`);
        return [];
      }

      const filteredPersons = personIds ?
        persons.filter(person => personIds.split(',').includes(String(person.id))
        ) :
        persons;

      if (!filteredPersons.length) {
        this.logger.log(
          `No persons match the personIds in workspace_id = ${workspace_id}.`
        );
        return [];
      }

      const personIdsArray = filteredPersons.map(person => person.id);

      const booklets = await this.workspacesFacadeService.findBookletsByPersonIds(personIdsArray);

      const bookletIds = booklets.map(booklet => booklet.id);

      if (!bookletIds.length) {
        this.logger.log(
          `No booklets found for persons = [${personIdsArray.join(
            ', '
          )}] in workspace_id = ${workspace_id}.`
        );
        return [];
      }

      const units = await this.workspacesFacadeService.findUnitsByBookletIds(bookletIds);

      const unitIdToNameMap = new Map(
        units.map(unit => [unit.id, unit.name])
      );
      const unitIds = Array.from(unitIdToNameMap.keys());

      if (!unitIds.length) {
        this.logger.log(
          `No units found for booklets = [${bookletIds.join(
            ', '
          )}] in workspace_id = ${workspace_id}.`
        );
        return [];
      }

      const responses = await this.workspacesFacadeService.findIncompleteResponsesByUnitIds(unitIds);

      const enrichedResponses = responses.map(response => ({
        ...response,
        unitname: unitIdToNameMap.get(response.unitid) || 'Unknown Unit'
      }));

      this.logger.log(
        `Fetched ${responses.length} responses for the given criteria in workspace_id = ${workspace_id}.`
      );

      return enrichedResponses;
    } catch (error) {
      this.logger.error(
        `Failed to fetch responses: ${error.message}`,
        error.stack
      );
      throw new Error(
        'Could not retrieve responses. Please check the database connection or query.'
      );
    }
  }

  async processTestPersonsBatch(
    workspace_id: number,
    options: { personIds: number[]; autoCoderRun?: number; jobId?: string },
    progressCallback?: (progress: number) => void
  ): Promise<CodingStatistics> {
    const { personIds, autoCoderRun = 1, jobId } = options;
    const startTime = Date.now();
    const statistics: CodingStatistics = {
      totalResponses: 0,
      statusCounts: {}
    };

    const metrics = {
      personsQuery: 0,
      bookletQuery: 0,
      unitQuery: 0,
      responseQuery: 0,
      fileQuery: 0,
      schemeExtract: 0,
      schemeQuery: 0,
      schemeParsing: 0,
      processing: 0,
      update: 0
    };

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      this.logger.log(
        `Processing batch of ${personIds.length} persons for workspace ${workspace_id}`
      );

      // Step 1: Get persons - 10% progress
      const personsStart = Date.now();
      const persons = await this.workspacesFacadeService.findPersonsByIds(workspace_id, personIds.map(id => String(id)));
      metrics.personsQuery = Date.now() - personsStart;

      if (progressCallback) {
        progressCallback(10);
      }

      if (!persons.length) {
        this.logger.warn('No persons found for the given IDs.');
        await queryRunner.release();
        return statistics;
      }

      // Check for cancellation
      if (jobId && (await this.isJobCancelled(jobId))) {
        this.logger.log(`Job ${jobId} was cancelled or paused`);
        await queryRunner.release();
        return statistics;
      }

      // Step 2: Get booklets - 20% progress
      const bookletStart = Date.now();
      const booklets = await this.workspacesFacadeService.findBookletsByPersonIds(personIds);
      metrics.bookletQuery = Date.now() - bookletStart;

      if (progressCallback) {
        progressCallback(20);
      }

      if (!booklets.length) {
        this.logger.warn('No booklets found for the given persons.');
        await queryRunner.release();
        return statistics;
      }

      // Step 3: Get units - 30% progress
      const unitStart = Date.now();
      const units = await this.workspacesFacadeService.findUnitsByBookletIds(
        booklets.map(b => b.id)
      );
      metrics.unitQuery = Date.now() - unitStart;

      if (progressCallback) {
        progressCallback(30);
      }

      if (!units.length) {
        this.logger.warn('No units found for the given booklets.');
        await queryRunner.release();
        return statistics;
      }

      // Step 4: Get responses - 40% progress
      const responseStart = Date.now();
      const unitIds = units.map(u => u.id);
      const allResponses = await this.workspacesFacadeService.findIncompleteResponsesByUnitIds(unitIds);
      metrics.responseQuery = Date.now() - responseStart;

      if (progressCallback) {
        progressCallback(40);
      }

      if (!allResponses.length) {
        this.logger.log('No incomplete responses found for the given units.');
        await queryRunner.release();
        return statistics;
      }

      // Step 5: Validate variables - 50% progress
      const unitAliases = new Set(units.map(u => u.name.toUpperCase()));
      const unitAliasesArray = Array.from(unitAliases);
      const validVariableSets = await this.workspaceFilesFacade.getUnitVariableMap(workspace_id);

      if (progressCallback) {
        progressCallback(50);
      }

      // Step 6: Filter responses for valid variables
      const unitIdToNameMap = new Map<number, string>();
      units.forEach(unit => {
        unitIdToNameMap.set(unit.id, unit.name);
      });

      const filteredResponses = allResponses.filter(response => {
        const unitName = unitIdToNameMap.get(response.unitid)?.toUpperCase();
        const validVars = validVariableSets.get(unitName || '');
        return validVars?.has(response.variableid);
      });

      this.logger.log(
        `Filtered responses: ${allResponses.length} -> ${
          filteredResponses.length
        } (removed ${
          allResponses.length - filteredResponses.length
        } invalid variable responses)`
      );

      if (jobId && (await this.isJobCancelled(jobId))) {
        this.logger.log(
          `Job ${jobId} was cancelled or paused after filtering responses`
        );
        await queryRunner.release();
        return statistics;
      }

      // Step 7: Process responses and build maps - 60% progress
      const unitToResponsesMap = new Map<number, ResponseEntity[]>();
      for (const response of filteredResponses) {
        if (!unitToResponsesMap.has(response.unitid)) {
          unitToResponsesMap.set(response.unitid, []);
        }
        unitToResponsesMap.get(response.unitid)!.push(response);
      }

      if (progressCallback) {
        progressCallback(60);
      }

      if (jobId && (await this.isJobCancelled(jobId))) {
        this.logger.log(
          `Job ${jobId} was cancelled or paused after processing responses`
        );
        await queryRunner.release();
        return statistics;
      }

      // Step 8: Get test files - 70% progress
      const fileQueryStart = Date.now();
      const fileIdToTestFileMap = await this.getTestFilesWithCache(
        workspace_id,
        unitAliasesArray
      );
      metrics.fileQuery = Date.now() - fileQueryStart;

      if (progressCallback) {
        progressCallback(70);
      }

      if (jobId && (await this.isJobCancelled(jobId))) {
        this.logger.log(
          `Job ${jobId} was cancelled or paused after getting test files`
        );
        await queryRunner.release();
        return statistics;
      }

      // Step 9: Extract coding scheme references - 80% progress
      const schemeExtractStart = Date.now();
      const { codingSchemeRefs, unitToCodingSchemeRefMap } =
        await this.extractCodingSchemeReferences(
          units,
          fileIdToTestFileMap,
          jobId,
          queryRunner
        );
      metrics.schemeExtract = Date.now() - schemeExtractStart;

      if (progressCallback) {
        progressCallback(80);
      }

      if (jobId && (await this.isJobCancelled(jobId))) {
        this.logger.log(
          `Job ${jobId} was cancelled or paused after extracting scheme references`
        );
        await queryRunner.release();
        return statistics;
      }

      // Step 10: Get coding scheme files - 85% progress
      const schemeQueryStart = Date.now();
      const fileIdToCodingSchemeMap = await this.getCodingSchemeFiles(
        codingSchemeRefs,
        jobId,
        queryRunner
      );
      metrics.schemeQuery = Date.now() - schemeQueryStart;
      metrics.schemeParsing = 0;

      if (progressCallback) {
        progressCallback(85);
      }

      if (progressCallback) {
        progressCallback(90);
      }

      if (jobId && (await this.isJobCancelled(jobId))) {
        this.logger.log(
          `Job ${jobId} was cancelled or paused after parsing coding schemes`
        );
        await queryRunner.release();
        return statistics;
      }

      // Step 11: Process and code responses - 95% progress
      const processingStart = Date.now();

      const { allCodedResponses } = await this.codingProcessor.processAndCodeResponses(
        units,
        unitToResponsesMap,
        unitToCodingSchemeRefMap,
        fileIdToCodingSchemeMap,
        filteredResponses,
        statistics,
        autoCoderRun,
        jobId,
        queryRunner,
        progressCallback
      );

      metrics.processing = Date.now() - processingStart;

      if (jobId && (await this.isJobCancelled(jobId))) {
        this.logger.log(
          `Job ${jobId} was cancelled or paused after processing responses`
        );
        await queryRunner.release();
        return statistics;
      }

      // Step 12: Update responses in database - 100% progress
      const updateSuccess = await this.codingProcessor.updateResponsesInDatabase(
        allCodedResponses,
        queryRunner,
        jobId,
        progressCallback,
        metrics
      );

      if (!updateSuccess) {
        return statistics;
      }

      if (progressCallback) {
        progressCallback(100);
      }

      const totalTime = Date.now() - startTime;
      this.logger
        .log(`Performance metrics for processTestPersonsBatch (total: ${totalTime}ms):
        - Persons query: ${metrics.personsQuery}ms
        - Booklet query: ${metrics.bookletQuery}ms
        - Unit query: ${metrics.unitQuery}ms
        - Response query: ${metrics.responseQuery}ms
        - File query: ${metrics.fileQuery}ms
        - Scheme extraction: ${metrics.schemeExtract}ms
        - Scheme query: ${metrics.schemeQuery}ms
        - Scheme parsing: ${metrics.schemeParsing}ms
        - Response processing: ${metrics.processing}ms
        - Database updates: ${metrics.update || 0}ms`);

      await this.codingStatisticsService.invalidateIncompleteVariablesCache(workspace_id);
      await this.codingStatisticsService.refreshStatistics(workspace_id);

      return statistics;
    } catch (error) {
      this.logger.error('Fehler beim Verarbeiten der Personen:', error);

      try {
        await queryRunner.rollbackTransaction();
      } catch (rollbackError) {
        this.logger.error(
          'Fehler beim Rollback der Transaktion:',
          rollbackError.message
        );
      } finally {
        await queryRunner.release();
      }

      return statistics;
    }
  }

  private async isJobCancelled(jobId: string | number): Promise<boolean> {
    const job = await this.codingJobRepository.findOne({
      where: { id: Number(jobId) }
    });
    return !job || job.status === 'cancelled' || job.status === 'paused';
  }

  private async getTestFilesWithCache(
    workspaceId: number,
    unitAliases: string[]
  ): Promise<Map<string, FileUpload>> {
    return this.codingFileCache.getTestFilesWithCache(workspaceId, unitAliases);
  }

  private async extractCodingSchemeReferences(
    units: Unit[],
    fileIdToTestFileMap: Map<string, FileUpload>,
    jobId?: string,
    queryRunner?: QueryRunner
  ): Promise<{
      codingSchemeRefs: string[];
      unitToCodingSchemeRefMap: Map<number, string>;
    }> {
    const { codingSchemeRefs, unitToCodingSchemeRefMap } = await this.codingProcessor.extractCodingSchemeReferences(
      units,
      fileIdToTestFileMap,
      jobId,
      queryRunner
    );
    return {
      codingSchemeRefs: Array.from(codingSchemeRefs),
      unitToCodingSchemeRefMap
    };
  }

  private async getCodingSchemeFiles(
    codingSchemeRefs: string[],
    jobId?: string,
    queryRunner?: QueryRunner
  ): Promise<Map<string, CodingScheme>> {
    return this.codingProcessor.getCodingSchemeFiles(
      new Set(codingSchemeRefs),
      jobId,
      queryRunner
    );
  }
}
