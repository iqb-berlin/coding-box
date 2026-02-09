import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Brackets, In, Repository } from 'typeorm';
import { ResponseStatusType } from '@iqbspecs/response/response.interface';
import {
  Log,
  Person,
  TcMergeBooklet,
  TcMergeSubForms,
  TcMergeUnit
} from '../shared';
import Persons from '../../entities/persons.entity';
import { Booklet } from '../../entities/booklet.entity';
import { Unit } from '../../entities/unit.entity';
import { UnitLastState } from '../../entities/unitLastState.entity';
import { BookletInfo } from '../../entities/bookletInfo.entity';
import { ResponseEntity } from '../../entities/response.entity';
import { ChunkEntity } from '../../entities/chunk.entity';
import { BookletLog } from '../../entities/bookletLog.entity';
import { Session } from '../../entities/session.entity';
import { UnitLog } from '../../entities/unitLog.entity';
import { statusStringToNumber } from '../../utils/response-status-converter';
import { TestResultsUploadIssueDto } from '../../../../../../../api-dto/files/test-results-upload-result.dto';

/**
 * PersonPersistenceService
 *
 * Responsibility: Write operations and transaction management
 *
 * This service handles all database write operations for person-related data,
 * including persons, booklets, units, responses, logs, and sessions.
 * It manages transactions and ensures data integrity during bulk operations.
 */
@Injectable()
export class PersonPersistenceService {
  private readonly logger = new Logger(PersonPersistenceService.name);

  constructor(
    @InjectRepository(Persons)
    private personsRepository: Repository<Persons>,
    @InjectRepository(Booklet)
    private bookletRepository: Repository<Booklet>,
    @InjectRepository(Unit)
    private unitRepository: Repository<Unit>,
    @InjectRepository(UnitLastState)
    private unitLastStateRepository: Repository<UnitLastState>,
    @InjectRepository(BookletInfo)
    private bookletInfoRepository: Repository<BookletInfo>,
    @InjectRepository(ResponseEntity)
    private responseRepository: Repository<ResponseEntity>,
    @InjectRepository(ChunkEntity)
    private chunkRepository: Repository<ChunkEntity>,
    @InjectRepository(BookletLog)
    private bookletLogRepository: Repository<BookletLog>,
    @InjectRepository(Session)
    private bookletSessionRepository: Repository<Session>,
    @InjectRepository(UnitLog)
    private unitLogRepository: Repository<UnitLog>
  ) { }

  /**
   * Mark persons as not to be considered
   *
   * @param workspaceId - The workspace identifier
   * @param logins - Array of login names to mark
   * @returns True if any persons were updated
   */
  async markPersonsAsNotConsidered(workspaceId: number, logins: string[]): Promise<boolean> {
    try {
      if (!workspaceId || !logins || logins.length === 0) {
        this.logger.warn('Invalid parameters for markPersonsAsNotConsidered');
        return false;
      }

      const result = await this.personsRepository.update(
        {
          workspace_id: workspaceId,
          login: In(logins)
        },
        { consider: false }
      );

      this.logger.log(`Marked ${result.affected} persons as not to be considered in workspace ${workspaceId}`);
      return result.affected > 0;
    } catch (error) {
      this.logger.error(`Error marking persons as not considered: ${error.message}`, error.stack);
      return false;
    }
  }

  /**
   * Mark persons as to be considered
   *
   * @param workspaceId - The workspace identifier
   * @param logins - Array of login names to mark
   * @returns True if any persons were updated
   */
  async markPersonsAsConsidered(workspaceId: number, logins: string[]): Promise<boolean> {
    try {
      if (!workspaceId || !logins || logins.length === 0) {
        this.logger.warn('Invalid parameters for markPersonsAsConsidered');
        return false;
      }

      const result = await this.personsRepository.update(
        {
          workspace_id: workspaceId,
          login: In(logins)
        },
        { consider: true }
      );

      this.logger.log(`Marked ${result.affected} persons as considered in workspace ${workspaceId}`);
      return result.affected > 0;
    } catch (error) {
      this.logger.error(`Error marking persons as considered: ${error.message}`, error.stack);
      return false;
    }
  }

  /**
   * Process and persist person booklets with their units and responses
   *
   * @param personList - List of persons with booklet data
   * @param workspace_id - The workspace identifier
   * @param overwriteMode - How to handle existing data: 'skip', 'merge', or 'replace'
   * @param scope - Process scope: 'person' (only uploaded persons) or 'workspace' (all persons)
   */
  async processPersonBooklets(
    personList: Person[],
    workspace_id: number,
    overwriteMode: 'skip' | 'merge' | 'replace' = 'skip',
    scope: 'person' | 'workspace' = 'person',
    issues: TestResultsUploadIssueDto[] = []
  ): Promise<void> {
    try {
      if (!Array.isArray(personList) || personList.length === 0) {
        this.logger.warn('Person list is empty or invalid');
        return;
      }
      if (!workspace_id || workspace_id <= 0) {
        this.logger.error('Invalid workspace ID provided');
        return;
      }

      this.logger.log(`Starting to process ${personList.length} persons for workspace ${workspace_id}`);

      await this.personsRepository.upsert(personList, ['group', 'code', 'login', 'workspace_id']);

      let persons: Persons[] = [];
      if (scope === 'workspace') {
        persons = await this.personsRepository.find({ where: { workspace_id } });
      } else {
        // Person-scope default: process only persons that were part of the uploaded file.
        // This avoids unintentionally re-processing all persons in the workspace.
        const uniqueKeys = Array.from(new Set(
          personList.map(p => `${p.group}@@${p.login}@@${p.code}`)
        ));

        const BATCH_SIZE = 200;
        for (let i = 0; i < uniqueKeys.length; i += BATCH_SIZE) {
          const batchKeys = uniqueKeys.slice(i, i + BATCH_SIZE)
            .map(k => {
              const [group, login, code] = k.split('@@');
              return { group, login, code };
            });

          const batchPersons = await this.personsRepository
            .createQueryBuilder('person')
            .where('person.workspace_id = :workspaceId', { workspaceId: workspace_id })
            .andWhere(new Brackets(qb => {
              batchKeys.forEach((k, idx) => {
                const clause = `(person.group = :g${idx} AND person.login = :l${idx} AND person.code = :c${idx})`;
                if (idx === 0) {
                  qb.where(clause, { [`g${idx}`]: k.group, [`l${idx}`]: k.login, [`c${idx}`]: k.code });
                } else {
                  qb.orWhere(clause, { [`g${idx}`]: k.group, [`l${idx}`]: k.login, [`c${idx}`]: k.code });
                }
              });
            }))
            .getMany();

          persons.push(...batchPersons);
        }
      }

      if (!persons || persons.length === 0) {
        this.logger.warn(`No persons found for workspace_id: ${workspace_id}`);
        return;
      }

      this.logger.log(`Found ${persons.length} persons for workspace ${workspace_id}`);

      let totalBookletsProcessed = 0;
      let totalUnitsProcessed = 0;
      let totalResponsesProcessed = 0;
      const totalResponsesSkipped = 0;

      for (const person of persons) {
        if (!person.booklets || person.booklets.length === 0) {
          continue;
        }
        for (const booklet of person.booklets) {
          if (!booklet || !booklet.id) {
            continue;
          }

          try {
            await this.processBookletWithTransaction(booklet, person, overwriteMode, issues);
            totalBookletsProcessed += 1;

            if (Array.isArray(booklet.units)) {
              totalUnitsProcessed += booklet.units.length;

              for (const unit of booklet.units) {
                if (unit.subforms) {
                  for (const subform of unit.subforms) {
                    if (subform.responses) {
                      totalResponsesProcessed += subform.responses.length;
                    }
                  }
                }
              }
            }
          } catch (bookletError) {
            this.logger.error(
              `Failed to process booklet ${booklet.id} for person ${person.id}: ${bookletError.message}`
            );
          }
        }
      }

      this.logger.log(
        `Completed processing for workspace ${workspace_id}: ` +
        `${totalBookletsProcessed} booklets, ${totalUnitsProcessed} units, ` +
        `${totalResponsesProcessed} responses processed, ${totalResponsesSkipped} responses skipped.`
      );
    } catch (error) {
      this.logger.error(`Failed to process person booklets: ${error.message}`);
    }
  }

  /**
   * Process a single booklet with transaction handling
   *
   * @param booklet - The booklet data to process
   * @param person - The person entity
   * @param overwriteMode - How to handle existing data
   */
  async processBookletWithTransaction(
    booklet: TcMergeBooklet,
    person: Persons,
    overwriteMode: 'skip' | 'merge' | 'replace' = 'skip',
    issues: TestResultsUploadIssueDto[] = []
  ): Promise<void> {
    let bookletInfo = await this.bookletInfoRepository.findOne({ where: { name: booklet.id } });
    if (!bookletInfo) {
      bookletInfo = await this.bookletInfoRepository.save(
        this.bookletInfoRepository.create({
          name: booklet.id,
          size: 0
        })
      );
    }

    const existingBooklet = await this.bookletRepository.findOne({
      where: {
        personid: person.id,
        infoid: bookletInfo.id
      }
    });

    if (!person.id) {
      this.logger.error(`Person ID is missing for person: ${person.group}-${person.login}-${person.code}`);
      return;
    }

    const targetBooklet = existingBooklet || await this.bookletRepository.save(
      this.bookletRepository.create({
        personid: person.id,
        infoid: bookletInfo.id,
        lastts: Date.now(),
        firstts: Date.now()
      })
    );

    if (existingBooklet && overwriteMode === 'skip') {
      this.logger.log(`Booklet ${booklet.id} already exists for person ${person.id}, proceeding to merge new units (overwriteMode=skip)`);
    }

    if (Array.isArray(booklet.units) && booklet.units.length > 0) {
      const batchSize = 10;
      for (let i = 0; i < booklet.units.length; i += batchSize) {
        const unitBatch = booklet.units.slice(i, i + batchSize);
        await Promise.all(
          unitBatch.map(async unit => {
            if (!unit || !unit.id) {
              return;
            }
            try {
              const existingUnit = await this.unitRepository.findOne({
                where: { alias: unit.alias, name: unit.id, bookletid: targetBooklet.id }
              });

              if (existingUnit && overwriteMode === 'skip') {
                return;
              }

              const targetUnit = existingUnit || await this.unitRepository.save(
                this.unitRepository.create({
                  alias: unit.alias,
                  name: unit.id,
                  bookletid: targetBooklet.id
                })
              );

              if (targetUnit) {
                await Promise.all([
                  this.saveUnitLastState(unit, targetUnit),
                  this.processSubforms(unit, targetUnit, overwriteMode),
                  this.processChunks(unit, targetUnit, booklet)
                ]);
              }
            } catch (unitError) {
              const msg = `Failed to process unit ${unit.id} in booklet ${booklet.id} for person ${person.id}: ${unitError.message}`;
              this.logger.error(msg);
              issues.push({ level: 'error', message: msg, category: 'other' });
            }
          })
        );
      }
    }
  }

  /**
   * Save unit last state entries
   *
   * @param unit - The unit data with last state
   * @param savedUnit - The persisted unit entity
   */
  async saveUnitLastState(unit: TcMergeUnit, savedUnit: Unit): Promise<void> {
    try {
      const currentLastState = await this.unitLastStateRepository.find({
        where: { unitid: savedUnit.id }
      });

      if (currentLastState.length === 0 && unit.laststate) {
        const lastStateEntries = Object.entries(unit.laststate).map(([key]) => ({
          unitid: savedUnit.id,
          key: unit.laststate[key].key,
          value: unit.laststate[key].value
        }));

        if (lastStateEntries.length > 0) {
          await this.unitLastStateRepository.insert(lastStateEntries);
          if (lastStateEntries.length > 10) {
            this.logger.log(`Saved ${lastStateEntries.length} laststate entries for unit ${unit.id}`);
          }
        }
      }
    } catch (error) {
      this.logger.error(`Failed to save last state for unit ${unit.id}: ${error.message}`);
    }
  }

  /**
   * Process subforms for a unit
   *
   * @param unit - The unit data with subforms
   * @param savedUnit - The persisted unit entity
   * @param overwriteMode - How to handle existing data
   * @returns Processing result with counts
   */
  async processSubforms(
    unit: TcMergeUnit,
    savedUnit: Unit,
    overwriteMode: 'skip' | 'merge' | 'replace' = 'skip'
  ): Promise<{ success: boolean; saved: number; skipped: number }> {
    try {
      const subforms = unit.subforms;
      if (subforms && subforms.length > 0) {
        return await this.saveSubformResponsesForUnit(savedUnit, subforms, overwriteMode);
      }
      return { success: true, saved: 0, skipped: 0 };
    } catch (error) {
      this.logger.error(`Failed to process subform responses for unit: ${unit.id}: ${error.message}`);
      return { success: false, saved: 0, skipped: 0 };
    }
  }

  /**
   * Process and save chunks for a unit
   *
   * @param unit - The unit data with chunks
   * @param savedUnit - The persisted unit entity
   * @param booklet - The booklet containing the unit
   */
  async processChunks(unit: TcMergeUnit, savedUnit: Unit, booklet: TcMergeBooklet): Promise<void> {
    try {
      if (unit.chunks && unit.chunks.length > 0) {
        const chunkEntries = unit.chunks.map(chunk => ({
          unitid: savedUnit.id,
          key: chunk.id,
          type: chunk.type,
          ts: chunk.ts,
          variables: Array.isArray(chunk.variables) ? chunk.variables.join(',') : ''
        }));

        if (chunkEntries.length > 0) {
          await this.chunkRepository.insert(chunkEntries);
          if (chunkEntries.length > 5) {
            this.logger.log(`Saved ${chunkEntries.length} chunks for unit ${unit.id}`);
          }
        }
      }
    } catch (error) {
      this.logger.error(`Failed to save chunks for unit ${unit.id} in booklet ${booklet.id}: ${error.message}`);
    }
  }

  /**
   * Save subform responses for a unit
   *
   * @param savedUnit - The persisted unit entity
   * @param subforms - Array of subforms with responses
   * @param overwriteMode - How to handle existing data
   * @returns Processing result with counts
   */
  async saveSubformResponsesForUnit(
    savedUnit: Unit,
    subforms: TcMergeSubForms[],
    overwriteMode: 'skip' | 'merge' | 'replace' = 'skip'
  ): Promise<{ success: boolean; saved: number; skipped: number }> {
    try {
      let totalResponsesSaved = 0;
      let totalResponsesSkipped = 0;
      for (const subform of subforms) {
        if (subform.responses && subform.responses.length > 0) {
          const responseEntries = subform.responses.map(response => {
            let value: string | null;
            if (response.value === null) {
              value = null;
            } else if (typeof response.value === 'object' || Array.isArray(response.value)) {
              // For objects and arrays, use JSON.stringify to properly serialize
              value = JSON.stringify(response.value);
            } else {
              // For primitive values (string, number, boolean), convert to string without extra quotes
              value = String(response.value);
            }

            return {
              unitid: Number(savedUnit.id),
              variableid: response.id,
              status: statusStringToNumber(response.status as ResponseStatusType) || 0,
              value: value,
              subform: subform.id
            };
          });

          if (responseEntries.length > 0) {
            const variables = Array.from(new Set(responseEntries.map(r => r.variableid)));

            if (overwriteMode === 'replace') {
              await this.responseRepository
                .createQueryBuilder()
                .delete()
                .from(ResponseEntity)
                .where('unitid = :unitid', { unitid: savedUnit.id })
                .andWhere('subform = :subform', { subform: subform.id })
                .andWhere('variableid IN (:...variables)', { variables })
                .execute();
            }

            let filteredEntries = responseEntries;
            if (overwriteMode === 'skip' || overwriteMode === 'merge') {
              const existing = await this.responseRepository.find({
                where: {
                  unitid: Number(savedUnit.id),
                  subform: subform.id,
                  variableid: In(variables)
                },
                select: ['variableid', 'subform']
              });
              const existingKeys = new Set(existing.map(r => `${r.variableid}@@${r.subform || ''}`));
              filteredEntries = responseEntries.filter(r => {
                const k = `${r.variableid}@@${r.subform || ''}`;
                return !existingKeys.has(k);
              });
              totalResponsesSkipped += (responseEntries.length - filteredEntries.length);
            }

            if (filteredEntries.length === 0) {
              continue;
            }
            const BATCH_SIZE = 1000;
            for (let i = 0; i < filteredEntries.length; i += BATCH_SIZE) {
              const batch = filteredEntries.slice(i, i + BATCH_SIZE);
              await this.responseRepository.save(batch);
            }
            totalResponsesSaved += filteredEntries.length;
          }
        }
      }

      return {
        success: true,
        saved: totalResponsesSaved,
        skipped: totalResponsesSkipped
      };
    } catch (error) {
      this.logger.error(`Failed to save responses for unit: ${savedUnit.id}: ${error.message}`);
      return {
        success: false,
        saved: 0,
        skipped: 0
      };
    }
  }

  /**
   * Process and persist logs for persons
   *
   * @param persons - Array of persons
   * @param unitLogs - Array of unit logs
   * @param bookletLogs - Array of booklet logs
   * @param overwriteExistingLogs - Whether to overwrite existing logs
   * @returns Processing result with counts
   */
  async processPersonLogs(
    persons: Person[],
    unitLogs: Log[],
    bookletLogs: Log[],
    overwriteExistingLogs: boolean = true
  ): Promise<{
      success: boolean;
      totalBooklets: number;
      totalLogsSaved: number;
      totalLogsSkipped: number;
      issues?: TestResultsUploadIssueDto[];
    }> {
    let totalBooklets = 0;
    let totalLogsSaved = 0;
    let totalLogsSkipped = 0;
    let success = true;
    const issues: TestResultsUploadIssueDto[] = [];

    try {
      const keys = persons.map(person => ({
        group: person.group,
        code: person.code,
        login: person.login,
        workspace_id: person.workspace_id
      }));

      const existingPersons = await this.personsRepository.find({
        where: keys,
        select: ['group', 'code', 'login', 'workspace_id', 'booklets']
      });

      for (const originalPerson of persons) {
        const enrichedPerson = existingPersons.find(
          p => p.group === originalPerson.group &&
            p.code === originalPerson.code &&
            p.login === originalPerson.login &&
            p.workspace_id === originalPerson.workspace_id
        );

        if (!enrichedPerson) {
          this.logger.warn(
            `Enriched person not found in database: ${originalPerson.group}-${originalPerson.login}-${originalPerson.code}`
          );
          continue;
        }

        if (!originalPerson.booklets || originalPerson.booklets.length === 0) {
          this.logger.debug(
            `No booklets in import data for person ${originalPerson.group}-${originalPerson.login}-${originalPerson.code}`
          );
          continue;
        }

        for (const booklet of originalPerson.booklets) {
          if (!booklet || !booklet.id) {
            continue;
          }

          const existingPerson = await this.personsRepository.findOne({
            where: {
              group: originalPerson.group,
              login: originalPerson.login,
              code: originalPerson.code,
              workspace_id: originalPerson.workspace_id
            }
          });

          if (!existingPerson) {
            continue;
          }

          const bookletInfo = await this.bookletInfoRepository.findOne({
            where: { name: booklet.id }
          });

          if (!bookletInfo) {
            this.logger.warn(`BookletInfo not found for booklet ID: ${booklet.id}`);
            continue;
          }

          const existingBooklet = await this.bookletRepository.findOne({
            where: {
              personid: existingPerson.id,
              infoid: bookletInfo.id
            }
          });

          if (!existingBooklet) {
            this.logger.warn(
              `Booklet not found in the repository: ${booklet.id}. Logs for this booklet will be skipped.`
            );
            continue;
          }

          try {
            totalBooklets += 1;
            const logsResult = await this.storeBookletLogs(
              booklet,
              existingBooklet.id,
              overwriteExistingLogs
            );

            if (logsResult.success) {
              totalLogsSaved += logsResult.saved;
              totalLogsSkipped += logsResult.skipped;
            } else {
              success = false;
            }

            await this.storeBookletSessions(booklet, existingBooklet);
            await this.processUnits(booklet, existingBooklet, originalPerson, overwriteExistingLogs, issues);
          } catch (error) {
            success = false;
            this.logger.error(
              `Failed to process booklet ${booklet.id} for person ${originalPerson.code}: ${error.message}`
            );
          }
        }
      }

      this.logger.log(
        `Processed logs for ${totalBooklets} booklets: ` +
        `${totalLogsSaved} logs saved, ${totalLogsSkipped} logs skipped`
      );

      return {
        success,
        totalBooklets,
        totalLogsSaved,
        totalLogsSkipped,
        issues: issues.length > 0 ? issues : undefined
      };
    } catch (error) {
      this.logger.error(
        `Critical error while processing person logs: ${error.message}`
      );
      return {
        success: false,
        totalBooklets,
        totalLogsSaved,
        totalLogsSkipped
      };
    }
  }

  /**
   * Store booklet logs
   *
   * @param booklet - The booklet with logs
   * @param bookletId - The booklet database ID
   * @param overwriteExisting - Whether to overwrite existing logs
   * @returns Processing result with counts
   */
  async storeBookletLogs(
    booklet: TcMergeBooklet,
    bookletId: number,
    overwriteExisting: boolean = true
  ): Promise<{ success: boolean; saved: number; skipped: number }> {
    if (!booklet.logs || booklet.logs.length === 0) {
      return { success: true, saved: 0, skipped: 0 };
    }

    try {
      const existingLogsCount = await this.bookletLogRepository.count({
        where: { bookletid: bookletId }
      });

      if (existingLogsCount > 0 && !overwriteExisting) {
        this.logger.log(`Skipping ${booklet.logs.length} logs for booklet ${booklet.id} (logs already exist)`);
        return { success: true, saved: 0, skipped: booklet.logs.length };
      }

      if (existingLogsCount > 0 && overwriteExisting) {
        await this.bookletLogRepository.delete({ bookletid: bookletId });
        this.logger.log(`Deleted ${existingLogsCount} existing logs for booklet ${booklet.id}`);
      }

      const bookletLogEntries = booklet.logs.map(log => ({
        key: log.key,
        parameter: log.parameter,
        bookletid: bookletId,
        ts: Number(log.ts)
      }));

      await this.bookletLogRepository.save(bookletLogEntries);
      this.logger.log(`Saved ${booklet.logs.length} logs for booklet ${booklet.id}`);

      return { success: true, saved: booklet.logs.length, skipped: 0 };
    } catch (error) {
      this.logger.error(
        `Failed to save logs for booklet ${booklet.id}: ${error.message}`
      );
      return { success: false, saved: 0, skipped: booklet.logs.length };
    }
  }

  /**
   * Store booklet sessions
   *
   * @param booklet - The booklet with sessions
   * @param existingBooklet - The persisted booklet entity
   */
  async storeBookletSessions(
    booklet: TcMergeBooklet,
    existingBooklet: Booklet
  ): Promise<void> {
    if (!booklet.sessions || booklet.sessions.length === 0) {
      return;
    }

    const sessionEntries = booklet.sessions.map(session => ({
      browser: session.browser,
      os: session.os,
      screen: session.screen,
      loadcompletems: session.loadCompleteMS,
      ts: Number(session.ts),
      booklet: existingBooklet
    }));

    try {
      await this.bookletSessionRepository.save(sessionEntries);
      this.logger.log(
        `Saved ${sessionEntries.length} sessions for booklet ${booklet.id}`
      );
    } catch (error) {
      this.logger.error(
        `Failed to save sessions for booklet ${booklet.id}: ${error.message}`
      );
      throw error;
    }
  }

  /**
   * Process units and their logs
   *
   * @param booklet - The booklet with units
   * @param existingBooklet - The persisted booklet entity
   * @param person - The person data
   * @param overwriteExistingLogs - Whether to overwrite existing logs
   * @param issues - Array to collect issues
   */
  async processUnits(
    booklet: TcMergeBooklet,
    existingBooklet: Booklet,
    person: Person,
    overwriteExistingLogs: boolean = true,
    issues?: TestResultsUploadIssueDto[]
  ): Promise<void> {
    let totalLogsSaved = 0;
    let totalLogsSkipped = 0;

    for (const unit of booklet.units) {
      if (!unit || !unit.id) {
        this.logger.warn(
          `Skipping invalid unit in booklet ${booklet.id} for person ${person.group}-${person.login}-${person.code}`
        );
        issues?.push({
          level: 'warning',
          category: 'invalid_unit',
          message: `Skipping invalid unit in booklet "${booklet.id}" for person ${person.group}-${person.login}-${person.code}. Unit has no ID.`
        });
        continue;
      }

      const existingUnit = await this.unitRepository.findOne({
        where: {
          alias: unit.id,
          name: unit.id,
          bookletid: existingBooklet.id
        }
      });

      if (!existingUnit) {
        this.logger.warn(
          `Unit not found for alias: ${unit.alias}, name: ${unit.id} ${booklet.id} ${existingBooklet.id} ID${unit.id} ALIAS${unit.alias}`
        );
        issues?.push({
          level: 'warning',
          category: 'unit_not_found',
          message: `Unit not found in database: "${unit.id}" (alias: "${unit.alias}") in booklet "${booklet.id}". The unit may not have been imported with responses.`
        });
        continue;
      }

      const result = await this.saveUnitLogs(unit, existingUnit, overwriteExistingLogs);
      if (result.success) {
        totalLogsSaved += result.saved;
        totalLogsSkipped += result.skipped;
      }
    }

    this.logger.log(
      `Processed unit logs for booklet ${booklet.id}: ` +
      `${totalLogsSaved} logs saved, ${totalLogsSkipped} logs skipped`
    );
  }

  /**
   * Save unit logs
   *
   * @param unit - The unit with logs
   * @param existingUnit - The persisted unit entity
   * @param overwriteExisting - Whether to overwrite existing logs
   * @returns Processing result with counts
   */
  async saveUnitLogs(
    unit: TcMergeUnit,
    existingUnit: Unit,
    overwriteExisting: boolean = true
  ): Promise<{ success: boolean; saved: number; skipped: number }> {
    if (!unit.logs || unit.logs.length === 0) {
      return { success: true, saved: 0, skipped: 0 };
    }

    try {
      const existingLogsCount = await this.unitLogRepository.count({
        where: { unitid: existingUnit.id }
      });

      if (existingLogsCount > 0 && !overwriteExisting) {
        this.logger.log(`Skipping ${unit.logs.length} logs for unit ${unit.id} (logs already exist)`);
        return { success: true, saved: 0, skipped: unit.logs.length };
      }

      if (existingLogsCount > 0 && overwriteExisting) {
        await this.unitLogRepository.delete({ unitid: existingUnit.id });
        this.logger.log(`Deleted ${existingLogsCount} existing logs for unit ${unit.id}`);
      }

      const unitLogEntries = unit.logs.map(log => ({
        key: log.key,
        parameter: log.parameter,
        unitid: existingUnit.id,
        ts: Number(log.ts)
      }));

      const BATCH_SIZE = 1000;
      for (let i = 0; i < unitLogEntries.length; i += BATCH_SIZE) {
        const batch = unitLogEntries.slice(i, i + BATCH_SIZE);
        await this.unitLogRepository.save(batch);
      }

      this.logger.log(`Saved ${unit.logs.length} logs for unit ${unit.id}`);
      return { success: true, saved: unit.logs.length, skipped: 0 };
    } catch (error) {
      this.logger.error(
        `Failed to save logs for unit ${unit.id}: ${error.message}`
      );
      return { success: false, saved: 0, skipped: unit.logs.length };
    }
  }
}
