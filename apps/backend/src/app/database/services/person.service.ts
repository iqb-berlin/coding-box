import { Injectable, Logger } from '@nestjs/common';
// eslint-disable-next-line import/no-cycle
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
// eslint-disable-next-line import/no-cycle
import {
  Chunk,
  Log, Person, Response, TcMergeBooklet, TcMergeLastState, TcMergeResponse, TcMergeSubForms, TcMergeUnit
} from './workspace.service';
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
                screen: `${screenSizeWidth} ${screenSizeHeight}`,
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
      .filter(chunk => chunk?.id === 'elementCodes')
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
          id: 'elementCodes',
          type: parsedResponses[0]?.responseType || '',
          ts: parsedResponses[0]?.ts || 0,
          variables: Array.from(variables)
        }
      ],
      logs: []
    };
  }

  async processPersonBooklets(personList: Person[], workspace_id: number): Promise<void> {
    try {
      if (!Array.isArray(personList) || personList.length === 0) {
        this.logger.warn('Person list is empty or invalid');
        return;
      }
      if (!workspace_id || workspace_id <= 0) {
        this.logger.error('Invalid workspace ID provided');
        return;
      }

      await this.personsRepository.upsert(personList, ['group', 'code', 'login']);
      const persons = await this.personsRepository.find({ where: { workspace_id } });

      if (!persons || persons.length === 0) {
        this.logger.warn(`No persons found for workspace_id: ${workspace_id}`);
        return;
      }

      for (const person of persons) {
        if (!person.booklets || person.booklets.length === 0) {
          this.logger.warn(`No booklets found for person: ${person.group}-${person.login}-${person.code}`);
          continue;
        }

        for (const booklet of person.booklets) {
          if (!booklet || !booklet.id) {
            this.logger.warn(`Skipping invalid booklet for person: ${person.group}-${person.login}-${person.code}`);
            continue;
          }

          try {
            let bookletInfo = await this.bookletInfoRepository.findOne({ where: { name: booklet.id } });
            if (!bookletInfo) {
              bookletInfo = await this.bookletInfoRepository.save(
                this.bookletInfoRepository.create({
                  name: booklet.id,
                  size: 0
                })
              );
            }

            let savedBooklet = await this.bookletRepository.findOne({
              where: {
                personid: person.id,
                infoid: bookletInfo.id
              }
            });
            this.logger.log(`Processing booklet for person: ${JSON.stringify(person)} with person.id: ${person.id}`);
            if (!person.id) {
              this.logger.error(`Person ID is missing for person: ${JSON.stringify(person)}`);
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
              for (const unit of booklet.units) {
                if (!unit || !unit.id) {
                  this.logger.warn(
                    `Skipping invalid unit in booklet ${booklet.id} for person: ${person.group}-${person.login}-${person.code}`
                  );
                  continue;
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
                      this.saveUnitLastState(unit, savedUnit, booklet, person),
                      this.processSubforms(unit, savedUnit, booklet, person),
                      this.processChunks(unit, savedUnit, booklet)
                    ]);
                  }
                } catch (unitError) {
                  this.logger.error(
                    `Failed to process unit ${unit.id} in booklet ${booklet.id} for person ${person.id}: ${unitError.message}`
                  );
                }
              }
            } else {
              this.logger.warn(`No valid units found in booklet ${booklet.id} for person ${person.id}`);
            }
          } catch (bookletError) {
            this.logger.error(
              `Failed to process booklet ${booklet.id} for person ${person.id}: ${bookletError.message}`
            );
          }
        }
      }
    } catch (error) {
      this.logger.error(`Failed to process person booklets: ${error.message}`);
    }
  }

  private async saveUnitLastState(unit: TcMergeUnit, savedUnit: Unit, booklet: TcMergeBooklet, person: Persons): Promise<void> {
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
        await this.unitLastStateRepository.insert(lastStateEntries);
        this.logger.log(`Saved laststate for unit ${unit.id} of booklet ${booklet.id} for person ${person.id}`);
      } else {
        this.logger.log(`Laststate already exists for unit ${unit.id} of booklet ${booklet.id} for person ${person.id}`);
      }
    } catch (error) {
      this.logger.error(`Failed to save last state for unit ${unit.id}: ${error.message}`);
    }
  }

  private async processSubforms(unit: TcMergeUnit, savedUnit: Unit, booklet: TcMergeBooklet, person: Persons): Promise<void> {
    try {
      const subforms = unit.subforms;
      if (subforms && subforms.length > 0) {
        await this.saveSubformResponsesForUnit(savedUnit, subforms, person.id);
      }
      this.logger.log(`Processed subform responses for unit ${unit.id} of booklet ${booklet.id}`);
    } catch (error) {
      this.logger.error(`Failed to process subform responses for unit: ${unit.id}: ${error.message}`);
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
        await this.chunkRepository.insert(chunkEntries);
        this.logger.log(`Saved ${chunkEntries.length} chunks for unit ${unit.id} in booklet ${booklet.id}`);
      } else {
        this.logger.log(`No chunks to save for unit ${unit.id} in booklet ${booklet.id}`);
      }
    } catch (error) {
      this.logger.error(`Failed to save chunks for unit ${unit.id} in booklet ${booklet.id}: ${error.message}`);
    }
  }

  async saveSubformResponsesForUnit(savedUnit: Unit, subforms: TcMergeSubForms[], personId: number) {
    try {
      for (const subform of subforms) {
        if (subform.responses && subform.responses.length > 0) {
          const responseEntries = subform.responses.map(response => ({
            unitid: Number(savedUnit.id),
            variableid: response.id,
            status: response.status,
            value: response.value,
            subform: subform.id
          }));

          await this.responseRepository.insert(responseEntries);
          this.logger.log(`Saved ${responseEntries.length} responses for unit ${savedUnit.id} and person ${personId}`);
        }
      }
    } catch (error) {
      this.logger.error(`Failed to save responses for unit: ${savedUnit.id} ->`, error.message);
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
    unitLogs: Log[],
    bookletLogs: Log[]
  ): Promise<void> {
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
            await this.storeBookletLogs(booklet, existingBooklet.id);
            await this.storeBookletSessions(booklet, existingBooklet);
            await this.processUnits(booklet, existingBooklet, enrichedPerson);
          } catch (error) {
            this.logger.error(
              `Failed to process booklet ${booklet.id} for person ${originalPerson.code}: ${error.message}`
            );
          }
        }
      }
    } catch (error) {
      this.logger.error(
        `Critical error while processing person logs: ${error.message}`
      );
    }
  }

  private async storeBookletLogs(booklet: TcMergeBooklet, bookletId: number): Promise<void> {
    if (!booklet.logs || booklet.logs.length === 0) {
      return;
    }

    const bookletLogEntries = booklet.logs.map(log => ({
      key: log.key,
      parameter: log.parameter,
      bookletid: bookletId,
      ts: Number(log.ts)
    }));

    try {
      await this.bookletLogRepository.save(bookletLogEntries);
      this.logger.log(`Saved ${booklet.logs.length} logs for booklet ${booklet.id}`);
    } catch (error) {
      this.logger.error(
        `Failed to save logs for booklet ${booklet.id}: ${error.message}`
      );
      throw error;
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
    person: Person
  ): Promise<void> {
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
      }

      // await this.saveUnitLogs(unit, existingUnit);
    }
  }

  private async saveUnitLogs(unit: TcMergeUnit, existingUnit: Unit): Promise<void> {
    if (!unit.logs || unit.logs.length === 0) {
      return;
    }

    const unitLogEntries = unit.logs.map(log => ({
      key: log.key,
      parameter: log.parameter,
      unitid: existingUnit.id,
      ts: Number(log.ts)
    }));

    try {
      await this.unitLogRepository.insert(unitLogEntries);
      this.logger.log(
        `Saved ${unit.logs.length} logs for unit ${unit.id}`
      );
    } catch (error) {
      this.logger.error(
        `Failed to save logs for unit ${unit.id}: ${error.message}`
      );
      throw error;
    }
  }
}
