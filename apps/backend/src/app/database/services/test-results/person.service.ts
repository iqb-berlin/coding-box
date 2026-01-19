import { Injectable, Logger } from '@nestjs/common';
import {
  Chunk,
  Log,
  Person,
  TcMergeBooklet,
  TcMergeLastState,
  TcMergeResponse,
  TcMergeSubForms,
  TcMergeUnit, Response
} from '../shared';
import { TestResultsUploadStatsDto } from '../../../../../../../api-dto/files/test-results-upload-result.dto';
import { PersonQueryService } from './person-query.service';
import { PersonPersistenceService } from './person-persistence.service';

@Injectable()
export class PersonService {
  constructor(
    private readonly personQueryService: PersonQueryService,
    private readonly personPersistenceService: PersonPersistenceService
  ) {
  }

  logger = new Logger(PersonService.name);

  async getWorkspaceGroups(workspaceId: number): Promise<string[]> {
    return this.personQueryService.getWorkspaceGroups(workspaceId);
  }

  async getWorkspaceUploadStats(workspaceId: number): Promise<TestResultsUploadStatsDto> {
    return this.personQueryService.getWorkspaceUploadStats(workspaceId);
  }

  async getWorkspaceGroupCodingStats(
    workspaceId: number
  ): Promise<{ groupName: string; testPersonCount: number; responsesToCode: number }[]> {
    return this.personQueryService.getWorkspaceGroupCodingStats(workspaceId);
  }

  async hasBookletLogsForGroup(workspaceId: number, groupName: string): Promise<boolean> {
    return this.personQueryService.hasBookletLogsForGroup(workspaceId, groupName);
  }

  async getGroupsWithBookletLogs(workspaceId: number): Promise<Map<string, boolean>> {
    return this.personQueryService.getGroupsWithBookletLogs(workspaceId);
  }

  async markPersonsAsNotConsidered(workspaceId: number, logins: string[]): Promise<boolean> {
    return this.personPersistenceService.markPersonsAsNotConsidered(workspaceId, logins);
  }

  async markPersonsAsConsidered(workspaceId: number, logins: string[]): Promise<boolean> {
    return this.personPersistenceService.markPersonsAsConsidered(workspaceId, logins);
  }

  async getImportStatistics(workspaceId: number): Promise<{
    persons: number;
    booklets: number;
    units: number;
  }> {
    return this.personQueryService.getImportStatistics(workspaceId);
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
        // Allow empty values for groupname, loginname, and code
        // Use empty string as fallback for missing values
        const groupname = row.groupname || '';
        const loginname = row.loginname || '';
        const code = row.code || '';

        const mapKey = `${groupname}-${loginname}-${code}`;
        if (!personMap.has(mapKey)) {
          personMap.set(mapKey, {
            workspace_id,
            group: groupname,
            login: loginname,
            code: code,
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
    const bookletIds = new Set<string>();
    const booklets: TcMergeBooklet[] = [];

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
              booklet.sessions.push({
                browser: `${parsedResult.browserName} ${parsedResult.browserVersion}`.trim(),
                os: parsedResult.osName,
                screen: `${parsedResult.screenSizeWidth} x ${parsedResult.screenSizeHeight}`,
                ts: timestamp,
                loadCompleteMS: parsedResult.loadTime
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

  private parseLoadCompleteLog(logEntry: string): {
    browserVersion: string,
    browserName: string,
    osName: string,
    device: string,
    screenSizeWidth: number,
    screenSizeHeight: number,
    loadTime: number
  } | null {
    try {
      const keyValues = logEntry.slice(1, -1).split(',');
      const parsedResult: { [key: string]: string | number | undefined } = {};
      keyValues.forEach(pair => {
        const [key, value] = pair.split(':', 2).map(part => part.trim().replace(/\\/g, ''));
        parsedResult[key] = !Number.isNaN(Number(value)) ? Number(value) : value || undefined;
      });

      return {
        browserVersion: parsedResult.browserVersion?.toString() || 'Unknown',
        browserName: parsedResult.browserName?.toString() || 'Unknown',
        osName: parsedResult.osName?.toString() || 'Unknown',
        device: parsedResult.device?.toString() || 'Unknown',
        screenSizeWidth: Number(parsedResult.screenSizeWidth) || 0,
        screenSizeHeight: Number(parsedResult.screenSizeHeight) || 0,
        loadTime: Number(parsedResult.loadTime) || 0
      };
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
          return { id: chunk.subForm, responses: chunkContent };
        } catch (error) {
          this.logger.error(`Error parsing chunk content for chunk ID ${chunk.id}: ${error.message}`);
          return { id: chunk.subForm, responses: [] };
        }
      });
  }

  private extractVariablesFromSubforms(subforms: TcMergeSubForms[]): Set<string> {
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
    workspace_id: number,
    overwriteMode: 'skip' | 'merge' | 'replace' = 'skip',
    scope: 'person' | 'workspace' = 'person'
  ): Promise<void> {
    return this.personPersistenceService.processPersonBooklets(personList, workspace_id, overwriteMode, scope);
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
    unitLogs: Log[],
    bookletLogs: Log[],
    overwriteExistingLogs: boolean = true
  ): Promise<{
      success: boolean;
      totalBooklets: number;
      totalLogsSaved: number;
      totalLogsSkipped: number;
    }> {
    return this.personPersistenceService.processPersonLogs(persons, unitLogs, bookletLogs, overwriteExistingLogs);
  }
}
