import { Injectable, Logger } from '@nestjs/common';
import {
  Chunk,
  Log,
  Person,
  Response,
  TcMergeBooklet,
  TcMergeLastState,
  TcMergeResponse,
  TcMergeSubForms,
  TcMergeUnit
} from '../shared/types';

/**
 * PersonDataProcessingService
 *
 * Responsibility: Transform and prepare data structures (no database access)
 *
 * This service contains pure functions for data transformation and processing.
 * It does not interact with the database or external services.
 */
@Injectable()
export class PersonDataProcessingService {
  private readonly logger = new Logger(PersonDataProcessingService.name);

  /**
   * Build Person objects from CSV rows
   *
   * @param rows - Array of row data containing groupname, loginname, and code
   * @param workspace_id - The workspace identifier
   * @returns Array of Person objects with unique combinations
   */
  createPersonList(
    rows: Array<{ groupname: string; loginname: string; code: string }>,
    workspace_id: number
  ): Person[] {
    if (!Array.isArray(rows)) {
      this.logger.error('Invalid input: rows must be an array');
      return [];
    }

    if (typeof workspace_id !== 'number' || workspace_id <= 0) {
      this.logger.error('Invalid input: workspace_id must be a positive number');
      return [];
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

  /**
   * Map booklets to person
   *
   * @param person - The person object to assign booklets to
   * @param rows - Array of response rows
   * @returns Person object with assigned booklets
   */
  assignBookletsToPerson(person: Person, rows: Response[]): Person {
    const bookletIds = new Set<string>();
    const booklets: TcMergeBooklet[] = [];

    for (const row of rows) {
      try {
        if (row.groupname === person.group && row.loginname === person.login && row.code === person.code) {
          if (!row.bookletname) {
            this.logger.warn(`Missing booklet name in row: ${JSON.stringify(row)}`);
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
        this.logger.error(
          `Error processing a row [Group: ${row.groupname}, Login: ${row.loginname}, Code: ${row.code}]: ${error.message}`
        );
      }
    }

    person.booklets = booklets;
    this.logger.log(`Successfully assigned ${booklets.length} booklets to person ${person.login}.`);
    return person;
  }

  /**
   * Map logs to person's booklets
   *
   * @param person - The person object to assign logs to
   * @param rows - Array of log rows
   * @returns Person object with assigned booklet logs
   */
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

  /**
   * Map units to booklet and person
   *
   * @param person - The person object to assign units to
   * @param rows - Array of response rows
   * @returns Person object with assigned units
   */
  assignUnitsToBookletAndPerson(person: Person, rows: Response[]): Person {
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

  /**
   * Map unit logs to booklet
   *
   * @param booklet - The booklet object to assign unit logs to
   * @param rows - Array of log rows
   * @returns Booklet object with assigned unit logs
   */
  assignUnitLogsToBooklet(booklet: TcMergeBooklet, rows: Log[]): TcMergeBooklet {
    if (!booklet || !Array.isArray(booklet.units)) {
      this.logger.error("Invalid booklet provided. Booklet must contain a valid 'units' array.");
      return booklet;
    }

    if (!Array.isArray(rows)) {
      this.logger.error('Invalid rows provided. Expecting an array of Log items.');
      return booklet;
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

  /**
   * Parse JSON responses
   *
   * @param responses - String or array of chunks
   * @returns Parsed array of chunks
   */
  parseResponses(responses: string | Chunk[]): Chunk[] {
    if (Array.isArray(responses)) return responses;

    try {
      return JSON.parse(responses);
    } catch (error) {
      this.logger.error(`Error parsing responses: ${error.message}`);
      return [];
    }
  }

  /**
   * Extract subform data from parsed responses
   *
   * @param parsedResponses - Array of parsed chunks
   * @returns Array of subforms with responses
   */
  extractSubforms(parsedResponses: Chunk[]): TcMergeSubForms[] {
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

  /**
   * Get variable set from subforms
   *
   * @param subforms - Array of subforms
   * @returns Set of variable IDs
   */
  extractVariablesFromSubforms(subforms: TcMergeSubForms[]): Set<string> {
    const variables = new Set<string>();
    subforms.forEach(subform => subform.responses.forEach(response => variables.add(response.id))
    );
    return variables;
  }

  /**
   * Parse state JSON
   *
   * @param laststate - JSON string of last state
   * @returns Array of last state entries
   */
  parseLastState(laststate: string): TcMergeLastState[] {
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

  /**
   * Parse session info from LOADCOMPLETE log entry
   *
   * @param logEntry - The LOADCOMPLETE log entry string
   * @returns Parsed session information or null if parsing fails
   */
  parseLoadCompleteLog(logEntry: string): {
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

  /**
   * Build unit object from row data
   *
   * @param row - Response row data
   * @param laststate - Parsed last state
   * @param subforms - Extracted subforms
   * @param variables - Set of variables
   * @param parsedResponses - Parsed response chunks
   * @returns Complete unit object
   */
  createUnit(
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

  /**
   * Match predicate to check if row matches person
   *
   * @param row - Response row to check
   * @param person - Person to match against
   * @returns True if row matches person
   */
  doesRowMatchPerson(row: Response, person: Person): boolean {
    return row.groupname === person.group &&
      row.loginname === person.login &&
      row.code === person.code;
  }
}
