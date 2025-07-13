import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import Persons from '../entities/persons.entity';
import { Booklet } from '../entities/booklet.entity';
import { Unit } from '../entities/unit.entity';
import { UnitLastState } from '../entities/unitLastState.entity';
import { BookletInfo } from '../entities/bookletInfo.entity';
import { ResponseEntity } from '../entities/response.entity';
import { ChunkEntity } from '../entities/chunk.entity';
import { BookletLog } from '../entities/bookletLog.entity';
import { Session } from '../entities/session.entity';
import { UnitLog } from '../entities/unitLog.entity';
import {
  Chunk,
  Log,
  Person,
  TcMergeBooklet,
  TcMergeLastState,
  TcMergeResponse,
  TcMergeSubForms,
  TcMergeUnit, Response
} from './shared-types';

@Injectable()
export class PersonService {
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
  ) {
  }

  logger = new Logger(PersonService.name);

  async getWorkspaceGroups(workspaceId: number): Promise<string[]> {
    try {
      const result = await this.personsRepository
        .createQueryBuilder('person')
        .select('DISTINCT person.group', 'group')
        .where('person.workspace_id = :workspaceId', { workspaceId })
        .getRawMany();

      return result.map(item => item.group);
    } catch (error) {
      this.logger.error(`Error fetching workspace groups: ${error.message}`);
      return [];
    }
  }

  async hasBookletLogsForGroup(workspaceId: number, groupName: string): Promise<boolean> {
    try {
      const count = await this.bookletLogRepository
        .createQueryBuilder('bookletlog')
        .innerJoin('bookletlog.booklet', 'booklet')
        .innerJoin('booklet.person', 'person')
        .where('person.workspace_id = :workspaceId', { workspaceId })
        .andWhere('person.group = :groupName', { groupName })
        .getCount();

      return count > 0;
    } catch (error) {
      this.logger.error(`Error checking booklet logs for group ${groupName}: ${error.message}`);
      return false;
    }
  }

  async getGroupsWithBookletLogs(workspaceId: number): Promise<Map<string, boolean>> {
    try {
      const groups = await this.getWorkspaceGroups(workspaceId);
      const groupsWithLogs = new Map<string, boolean>();
      for (const group of groups) {
        const hasLogs = await this.hasBookletLogsForGroup(workspaceId, group);
        groupsWithLogs.set(group, hasLogs);
      }

      return groupsWithLogs;
    } catch (error) {
      this.logger.error(`Error getting groups with booklet logs: ${error.message}`);
      return new Map<string, boolean>();
    }
  }

  async getImportStatistics(workspaceId: number): Promise<{
    persons: number;
    booklets: number;
    units: number;
  }> {
    try {
      const personsCount = await this.personsRepository.count({
        where: { workspace_id: workspaceId }
      });

      const bookletsCount = await this.bookletRepository
        .createQueryBuilder('booklet')
        .innerJoin('booklet.person', 'person')
        .where('person.workspace_id = :workspaceId', { workspaceId })
        .getCount();

      const unitsCount = await this.unitRepository
        .createQueryBuilder('unit')
        .innerJoin('unit.booklet', 'booklet')
        .innerJoin('booklet.person', 'person')
        .where('person.workspace_id = :workspaceId', { workspaceId })
        .getCount();

      return {
        persons: personsCount,
        booklets: bookletsCount,
        units: unitsCount
      };
    } catch (error) {
      this.logger.error(`Error fetching import statistics: ${error.message}`);
      return {
        persons: 0,
        booklets: 0,
        units: 0
      };
    }
  }

  async createPersonList(rows: Array<{ groupname: string; loginname: string; code: string }>, workspace_id: number): Promise<Person[]> {
    if (!Array.isArray(rows)) {
      this.logger.error('Invalid input: rows must be an array');
    }

    if (typeof workspace_id !== 'number' || workspace_id <= 0) {
      this.logger.error('Invalid input: workspace_id must be a positive number');
    }
    const personMap = new Map<string, Person>();
    rows.forEach((row, index) => {
      try {
        if (!row.groupname || !row.loginname || !row.code) {
          this.logger.warn(`Skipping incomplete row at index ${index}: ${JSON.stringify(row)}`);
          return;
        }

        const mapKey = `${row.groupname}-${row.loginname}-${row.code}`;
        if (!personMap.has(mapKey)) {
          personMap.set(mapKey, {
            workspace_id,
            group: row.groupname,
            login: row.loginname,
            code: row.code,
            booklets: []
          });
        }
      } catch (error) {
        this.logger.error(`Error processing row at index ${index}: ${error.message}`);
      }
    });

    if (personMap.size === 0) {
      this.logger.warn('No valid persons were created from the input rows');
    }

    return Array.from(personMap.values());
  }

  async assignBookletsToPerson(person: Person, rows: Response[]): Promise<Person> {
    const logger = new Logger('assignBookletsToPerson');
    const bookletIds = new Set<string>(); // To avoid duplicate booklets
    const booklets: TcMergeBooklet[] = []; // List of booklets to be assigned

    for (const row of rows) {
      try {
        if (row.groupname === person.group && row.loginname === person.login && row.code === person.code) {
          if (!row.bookletname) {
            logger.warn(`Missing booklet name in row: ${JSON.stringify(row)}`);
            continue;
          }
          if (!bookletIds.has(row.bookletname)) {
            bookletIds.add(row.bookletname);
            booklets.push({
              id: row.bookletname,
              logs: [],
              units: [],
              sessions: []
            });
          }
        }
      } catch (error) {
        logger.error(
          `Error processing a row [Group: ${row.groupname}, Login: ${row.loginname}, Code: ${row.code}]: ${error.message}`
        );
      }
    }
    person.booklets = booklets;
    logger.log(`Successfully assigned ${booklets.length} booklets to person ${person.login}.`);
    return person;
  }

  assignBookletLogsToPerson(person: Person, rows: Log[]): Person {
    const booklets: TcMergeBooklet[] = [];
    const bookletMap = new Map<string, TcMergeBooklet>();

    rows.forEach((row, index) => {
      try {
        if (
          row.groupname === person.group &&
          row.loginname === person.login &&
          row.code === person.code
        ) {
          const { bookletname, timestamp, logentry } = row;

          if (!bookletname || !logentry) {
            this.logger.warn(
              `Skipping incomplete log entry at index ${index} for person: ${person.login}`
            );
            return;
          }

          const [logEntryKey, logEntryValueRaw] = logentry.split(' : ');
          const logEntryKeyTrimmed = logEntryKey?.trim();
          const logEntryValue = logEntryValueRaw?.trim()?.replace(/"/g, '');

          if (!logEntryKeyTrimmed) {
            this.logger.warn(
              `Invalid log key detected at index ${index} for person: ${person.login}`
            );
            return;
          }

          let booklet = bookletMap.get(bookletname);
          if (!booklet) {
            booklet = {
              id: bookletname,
              logs: [],
              units: [],
              sessions: []
            };
            booklets.push(booklet);
            bookletMap.set(bookletname, booklet);
          }

          if (logEntryKeyTrimmed === 'LOADCOMPLETE' && logEntryValue) {
            const parsedResult = this.parseLoadCompleteLog(logEntryValue);
            if (parsedResult) {
              const {
                browserVersion = 'Unknown',
                browserName = 'Unknown',
                osName = 'Unknown',
                screenSizeWidth = '0',
                screenSizeHeight = '0',
                loadTime = '0'
              } = parsedResult;

              booklet.sessions.push({
                browser: `${browserName} ${browserVersion}`.trim(),
                os: osName.toString(),
                screen: `${screenSizeWidth} x ${screenSizeHeight}`,
                ts: timestamp,
                loadCompleteMS: Number(loadTime) || 0
              });
            } else {
              this.logger.warn(
                `Failed to parse LOADCOMPLETE entry at index ${index} for person: ${person.login}`
              );
            }
          }
          if (logEntryKeyTrimmed !== 'LOADCOMPLETE') {
            booklet.logs.push({
              ts: timestamp,
              key: logEntryKeyTrimmed || 'UNKNOWN',
              parameter: logEntryValue || ''
            });
          }
        }
      } catch (error) {
        this.logger.error(
          `Error processing log row at index ${index} for person: ${person.login}. Data: ${JSON.stringify(
            row
          )}. Error: ${error.message}`
        );
      }
    });

    person.booklets = booklets;
    return person;
  }

  private parseLoadCompleteLog(logEntry: string): { [key: string]: string | number | undefined } | null {
    try {
      const keyValues = logEntry.slice(1, -1).split(',');
      const parsedResult: { [key: string]: string | number | undefined } = {};

      keyValues.forEach(pair => {
        const [key, value] = pair.split(':', 2).map(part => part.trim());
        parsedResult[key] = !Number.isNaN(Number(value)) ? Number(value) : value || undefined;
      });

      return parsedResult;
    } catch (error) {
      this.logger.error(`Failed to parse LOADCOMPLETE log entry: ${logEntry} - ${error.message}`);
      return null;
    }
  }

  async assignUnitsToBookletAndPerson(person: Person, rows: Response[]): Promise<Person> {
    for (const row of rows) {
      try {
        if (!this.doesRowMatchPerson(row, person)) continue;

        const booklet = person.booklets.find(b => b.id === row.bookletname);
        if (!booklet) continue;

        const parsedResponses = this.parseResponses(row.responses);
        const subforms = this.extractSubforms(parsedResponses);
        const variables = this.extractVariablesFromSubforms(subforms);
        const laststate = this.parseLastState(row.laststate);

        person.booklets = person.booklets.map(b => (b.id === booklet.id ?
          { ...b, units: [...b.units, this.createUnit(row, laststate, subforms, variables, parsedResponses)] } :
          b)
        );
      } catch (error) {
        this.logger.error(`Error processing row for person ${person.login}: ${error.message}`, error.stack);
      }
    }
    return person;
  }

  private doesRowMatchPerson(row: Response, person: Person): boolean {
    return row.groupname === person.group &&
      row.loginname === person.login &&
      row.code === person.code;
  }

  private parseResponses(responses: string | Chunk[]): Chunk[] {
    if (Array.isArray(responses)) return responses;

    try {
      return JSON.parse(responses);
    } catch (error) {
      this.logger.error(`Error parsing responses: ${error.message}`);
      return [];
    }
  }

  private extractSubforms(parsedResponses: Chunk[]): TcMergeSubForms[] {
    return parsedResponses
      .map(chunk => {
        try {
          const chunkContent: TcMergeResponse[] = JSON.parse(chunk.content);
          return { id: chunk.id, responses: chunkContent };
        } catch (error) {
          this.logger.error(`Error parsing chunk content for chunk ID ${chunk.id}: ${error.message}`);
          return { id: chunk.id, responses: [] };
        }
      });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private extractVariablesFromSubforms(subforms: any[]): Set<string> {
    const variables = new Set<string>();
    subforms.forEach(subform => subform.responses.forEach(response => variables.add(response.id))
    );
    return variables;
  }

  private parseLastState(laststate: string): TcMergeLastState[] {
    try {
      if (!laststate || typeof laststate !== 'string' || laststate.trim() === '') {
        this.logger.warn('Last state is empty or invalid.');
        return [];
      }

      const parsed = JSON.parse(laststate);

      if (
        typeof parsed !== 'object' ||
        Array.isArray(parsed) ||
        parsed === null
      ) {
        this.logger.error('Parsed last state is not a valid object.');
        return [];
      }

      return Object.entries(parsed).map(([key, value]) => ({
        key,
        value: String(value)
      }));
    } catch (error) {
      this.logger.error(`Error parsing last state: ${error.message}`);
      return [];
    }
  }

  private createUnit(
    row: Response,
    laststate: TcMergeLastState[],
    subforms: TcMergeSubForms[],
    variables: Set<string>,
    parsedResponses: Chunk[]
  ): TcMergeUnit {
    return {
      id: row.unitname,
      alias: row.unitname,
      laststate,
      subforms,
      chunks: [
        {
          id: parsedResponses[0]?.id || '',
          type: parsedResponses[0]?.responseType || '',
          ts: parsedResponses[0]?.ts || 0,
          variables: Array.from(variables)
        }
      ],
      logs: []
    };
  }

  async processPersonBooklets(
    personList: Person[],
    workspace_id: number
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

      await this.personsRepository.upsert(personList, ['group', 'code', 'login']);
      const persons = await this.personsRepository.find({ where: { workspace_id } });

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
          continue; // Skip silently to reduce log noise
        }
        for (const booklet of person.booklets) {
          if (!booklet || !booklet.id) {
            continue; // Skip silently to reduce log noise
          }

          try {
            await this.processBookletWithTransaction(booklet, person);
            totalBookletsProcessed += 1;

            if (Array.isArray(booklet.units)) {
              totalUnitsProcessed += booklet.units.length;

              for (const unit of booklet.units) {
                if (unit.subforms) {
                  for (const subform of unit.subforms) {
                    if (subform.responses) {
                      // This is just an estimate as we don't have the actual count of saved vs skipped
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

  private async processBookletWithTransaction(
    booklet: TcMergeBooklet,
    person: Persons
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

    // Find or create booklet
    let savedBooklet = await this.bookletRepository.findOne({
      where: {
        personid: person.id,
        infoid: bookletInfo.id
      }
    });

    if (!person.id) {
      this.logger.error(`Person ID is missing for person: ${person.group}-${person.login}-${person.code}`);
      return;
    }

    if (!savedBooklet) {
      savedBooklet = await this.bookletRepository.save(
        this.bookletRepository.create({
          personid: person.id,
          infoid: bookletInfo.id,
          lastts: Date.now(),
          firstts: Date.now()
        })
      );
    }

    if (Array.isArray(booklet.units) && booklet.units.length > 0) {
      // Process units in batches to improve performance
      const batchSize = 10;
      for (let i = 0; i < booklet.units.length; i += batchSize) {
        const unitBatch = booklet.units.slice(i, i + batchSize);
        await Promise.all(
          unitBatch.map(async unit => {
            if (!unit || !unit.id) {
              return; // Skip invalid units silently
            }

            try {
              let savedUnit = await this.unitRepository.findOne({
                where: { alias: unit.alias, name: unit.id, bookletid: savedBooklet.id }
              });

              if (!savedUnit) {
                savedUnit = await this.unitRepository.save(
                  this.unitRepository.create({
                    alias: unit.alias,
                    name: unit.id,
                    bookletid: savedBooklet.id
                  })
                );
              }

              if (savedUnit) {
                await Promise.all([
                  this.saveUnitLastState(unit, savedUnit),
                  this.processSubforms(unit, savedUnit),
                  this.processChunks(unit, savedUnit, booklet)
                ]);
              }
            } catch (unitError) {
              this.logger.error(
                `Failed to process unit ${unit.id} in booklet ${booklet.id} for person ${person.id}: ${unitError.message}`
              );
            }
          })
        );
      }
    }
  }

  private async saveUnitLastState(unit: TcMergeUnit, savedUnit: Unit): Promise<void> {
    try {
      const currentLastState = await this.unitLastStateRepository.find({
        where: { unitid: savedUnit.id }
      });

      // Only save if no last state exists and we have data to save
      if (currentLastState.length === 0 && unit.laststate) {
        const lastStateEntries = Object.entries(unit.laststate).map(([key]) => ({
          unitid: savedUnit.id,
          key: unit.laststate[key].key,
          value: unit.laststate[key].value
        }));

        // Only proceed if we have entries to insert
        if (lastStateEntries.length > 0) {
          await this.unitLastStateRepository.insert(lastStateEntries);
          // Only log if we actually saved something
          if (lastStateEntries.length > 10) {
            this.logger.log(`Saved ${lastStateEntries.length} laststate entries for unit ${unit.id}`);
          }
        }
      }
    } catch (error) {
      this.logger.error(`Failed to save last state for unit ${unit.id}: ${error.message}`);
    }
  }

  private async processSubforms(
    unit: TcMergeUnit,
    savedUnit: Unit
  ): Promise<{ success: boolean; saved: number; skipped: number }> {
    try {
      const subforms = unit.subforms;
      if (subforms && subforms.length > 0) {
        return await this.saveSubformResponsesForUnit(savedUnit, subforms);
      }
      return { success: true, saved: 0, skipped: 0 };
    } catch (error) {
      this.logger.error(`Failed to process subform responses for unit: ${unit.id}: ${error.message}`);
      return { success: false, saved: 0, skipped: 0 };
    }
  }

  private async processChunks(unit: TcMergeUnit, savedUnit: Unit, booklet: TcMergeBooklet): Promise<void> {
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
      // Include booklet ID in error message for better context
      this.logger.error(`Failed to save chunks for unit ${unit.id} in booklet ${booklet.id}: ${error.message}`);
    }
  }

  async saveSubformResponsesForUnit(
    savedUnit: Unit,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    subforms: any[]
  ): Promise<{ success: boolean; saved: number; skipped: number }> {
    try {
      let totalResponsesSaved = 0;
      for (const subform of subforms) {
        if (subform.responses && subform.responses.length > 0) {
          const responseEntries = subform.responses.map(response => {
            let value = response.value;
            if (typeof value === 'string' && value.startsWith('{') && value.endsWith('}')) {
              value = `[${value.substring(1, value.length - 1)}]`;
            }

            return {
              unitid: Number(savedUnit.id),
              variableid: response.id,
              status: response.status,
              value: value,
              subform: subform.id
            };
          });

          if (responseEntries.length > 0) {
            const BATCH_SIZE = 1000;
            for (let i = 0; i < responseEntries.length; i += BATCH_SIZE) {
              const batch = responseEntries.slice(i, i + BATCH_SIZE);
              await this.responseRepository.save(batch);
            }
            totalResponsesSaved += responseEntries.length;
          }
        }
      }

      return {
        success: true,
        saved: totalResponsesSaved,
        skipped: 0
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

  assignUnitLogsToBooklet(booklet: TcMergeBooklet, rows: Log[]): TcMergeBooklet {
    if (!booklet || !Array.isArray(booklet.units)) {
      this.logger.error("Invalid booklet provided. Booklet must contain a valid 'units' array.");
    }

    if (!Array.isArray(rows)) {
      this.logger.error('Invalid rows provided. Expecting an array of Log items.');
    }

    const unitMap = new Map<string, TcMergeUnit>();
    booklet.units.forEach(unit => {
      if (unit && unit.id) {
        unitMap.set(unit.id, { ...unit, logs: Array.isArray(unit.logs) ? [...unit.logs] : [] });
      } else {
        this.logger.warn("Skipping invalid unit without 'id' in booklet units.");
      }
    });

    rows.forEach((row, index) => {
      try {
        if (!row || typeof row.bookletname !== 'string' || typeof row.unitname !== 'string') {
          this.logger.warn(`Skipping invalid row at index ${index}. Row must contain 'bookletname' and 'unitname'.`);
          return;
        }

        if (booklet.id !== row.bookletname) return;

        const logEntryParts = row.logentry?.split('=');
        if (!logEntryParts || logEntryParts.length < 2) {
          this.logger.warn(`Skipping invalid log entry in row at index ${index}: ${row.logentry}`);
          return;
        }

        const log = {
          ts: row.timestamp.toString(),
          key: logEntryParts[0]?.trim() || 'UNKNOWN',
          parameter: logEntryParts[1]?.trim()?.replace(/"/g, '') || ''
        };

        const existingUnit = unitMap.get(row.unitname);
        if (existingUnit) {
          existingUnit.logs.push(log);
        } else {
          const newUnit: TcMergeUnit = {
            id: row.unitname,
            alias: '',
            laststate: [],
            subforms: [],
            chunks: [],
            logs: [log]
          };
          unitMap.set(row.unitname, newUnit);
        }
      } catch (error) {
        this.logger.error(`Error processing row at index ${index}: ${error.message}`, row);
      }
    });

    booklet.units = Array.from(unitMap.values());
    return booklet;
  }

  async processPersonLogs(
    persons: Person[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    unitLogs: any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    bookletLogs: any,
    overwriteExistingLogs: boolean = true
  ): Promise<{
      success: boolean;
      totalBooklets: number;
      totalLogsSaved: number;
      totalLogsSkipped: number;
    }> {
    let totalBooklets = 0;
    let totalLogsSaved = 0;
    let totalLogsSkipped = 0;
    let success = true;

    try {
      const keys = persons.map(person => ({
        group: person.group,
        code: person.code,
        login: person.login,
        workspace_id: person.workspace_id
      }));

      const existingPersons = await this.personsRepository.find({
        where: keys,
        select: ['group', 'code', 'login', 'booklets']
      });
      const enrichedPersons = await Promise.all(
        existingPersons.map(async person => {
          const updatedPerson = this.assignBookletLogsToPerson(person, bookletLogs);

          if (updatedPerson.booklets?.length) {
            await Promise.all(updatedPerson.booklets.map(async booklet => {
              this.assignUnitLogsToBooklet(booklet, unitLogs);
            }));
          }
          return updatedPerson;
        })
      );

      for (const enrichedPerson of enrichedPersons) {
        const originalPerson = persons.find(
          p => p.group === enrichedPerson.group &&
            p.code === enrichedPerson.code &&
            p.login === enrichedPerson.login
        );

        if (!originalPerson) {
          this.logger.warn(
            `Original person matching enriched person not found: ${JSON.stringify(
              enrichedPerson
            )}`
          );
          continue;
        }

        if (!enrichedPerson.booklets || enrichedPerson.booklets.length === 0) {
          this.logger.warn(
            `No booklets found for person ${originalPerson.group}-${originalPerson.login}-${originalPerson.code}`
          );
          continue;
        }

        for (const booklet of enrichedPerson.booklets) {
          if (!booklet || !booklet.id) {
            this.logger.warn(
              `Skipping invalid booklet for person: ${originalPerson.group}-${originalPerson.login}-${originalPerson.code}`
            );
            continue;
          }
          const existingPerson = await this.personsRepository.findOne({
            where: {
              group: originalPerson.group,
              login: originalPerson.login,
              code: originalPerson.code
            }
          });

          if (!existingPerson) {
            this.logger.error(
              `Person not found in database: ${originalPerson.group}-${originalPerson.login}-${originalPerson.code}`
            );
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
              `Booklet not found in the repository: ${booklet.id}`
            );
            continue;
          }

          try {
            totalBooklets += 1;

            // Store booklet logs with overwrite flag
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
            await this.processUnits(booklet, existingBooklet, enrichedPerson, overwriteExistingLogs);
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
        totalLogsSkipped
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

  async storeBookletLogs(
    booklet: TcMergeBooklet,
    bookletId: number,
    overwriteExisting: boolean = true
  ): Promise<{ success: boolean; saved: number; skipped: number }> {
    if (!booklet.logs || booklet.logs.length === 0) {
      return { success: true, saved: 0, skipped: 0 };
    }

    try {
      // Check if logs already exist for this booklet
      const existingLogsCount = await this.bookletLogRepository.count({
        where: { bookletid: bookletId }
      });

      // If logs exist and we're not supposed to overwrite, skip
      if (existingLogsCount > 0 && !overwriteExisting) {
        this.logger.log(`Skipping ${booklet.logs.length} logs for booklet ${booklet.id} (logs already exist)`);
        return { success: true, saved: 0, skipped: booklet.logs.length };
      }

      // If logs exist and we're supposed to overwrite, delete existing logs first
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

  private async storeBookletSessions(
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

  private async processUnits(
    booklet: TcMergeBooklet,
    existingBooklet: Booklet,
    person: Person,
    overwriteExistingLogs: boolean = true
  ): Promise<void> {
    let totalLogsSaved = 0;
    let totalLogsSkipped = 0;

    for (const unit of booklet.units) {
      if (!unit || !unit.id) {
        this.logger.warn(
          `Skipping invalid unit in booklet ${booklet.id} for person ${person.group}-${person.login}-${person.code}`
        );
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

  private async saveUnitLogs(
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

      // Use batch processing for better performance with large datasets
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
