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
  async createPersonList(rows: any[], workspace_id: number): Promise<Person[]> {
    const personMap = new Map<string, Person>();
    rows.forEach(row => {
      const mapKey = `${row.groupname}-${row.loginname}-${row.code}`;
      if (!personMap.has(mapKey)) {
        personMap.set(mapKey, {
          workspace_id: workspace_id,
          group: row.groupname,
          login: row.loginname,
          code: row.code,
          booklets: []
        });
      }
    });
    return Array.from(personMap.values());
  }

  async assignBookletsToPerson(person: Person, rows: Response[]): Promise<Person> {
    const bookletIds = new Set<string>();
    const booklets: TcMergeBooklet[] = [];

    await Promise.all(rows.map(async row => {
      if (row.groupname === person.group && row.loginname === person.login && row.code === person.code) {
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
    }));

    person.booklets = booklets;
    return person;
  }

  assignBookletLogsToPerson(person: Person, rows: Log[]): Person {
    const booklets: TcMergeBooklet[] = [];
    const bookletMap = new Map<string, TcMergeBooklet>();

    rows.forEach((row) => {
      try {
        if (
          row.groupname === person.group &&
          row.loginname === person.login &&
          row.code === person.code
        ) {
          const { bookletname, timestamp, logentry } = row;

          if (!bookletname || !logentry) {
            console.warn(`Skipping incomplete log entry for person: ${person.login}`);
            return;
          }

          const [logEntryKey, logEntryValueRaw] = logentry.split(' : ');
          const logEntryKeyTrimmed = logEntryKey?.trim();
          const logEntryValue = logEntryValueRaw?.trim().replace(/"/g, '');

          let booklet = bookletMap.get(bookletname);
          if (!booklet) {
            booklet = {
              id: bookletname,
              logs: [],
              units: [],
              sessions: [],
            };
            booklets.push(booklet);
            bookletMap.set(bookletname, booklet);
          }

          if (logEntryKeyTrimmed === 'LOADCOMPLETE' && logEntryValue) {
            const parsedResult = this.parseLoadCompleteLog(logEntryValue);
            if (parsedResult) {
              const {
                browserVersion,
                browserName,
                osName,
                screenSizeWidth,
                screenSizeHeight,
                loadTime,
              } = parsedResult;

              booklet.sessions.push({
                browser: `${browserName || 'Unknown'} ${browserVersion || ''}`.trim(),
                os: osName?.toString() || 'Unknown',
                screen: `${screenSizeWidth || '0'} ${screenSizeHeight || '0'}`,
                ts: timestamp,
                loadCompleteMS: Number(loadTime) || 0,
              });
            }
          }

          booklet.logs.push({
            ts: timestamp,
            key: logEntryKeyTrimmed || 'UNKNOWN',
            parameter: logEntryValue || '',
          });
        }
      } catch (error) {
        this.logger.error(`Error processing log row: ${JSON.stringify(row)} - ${error.message}`);
      }
    });

    person.booklets = booklets;
    return person;
  }

  /**
   * Hilfsfunktion zum Parsen des LOADCOMPLETE-Logeintrags.
   */
  private parseLoadCompleteLog(logEntry: string): { [key: string]: string | number | undefined } | null {
    try {
      const keyValues = logEntry.slice(1, -1).split(',');
      const parsedResult: { [key: string]: string | number | undefined } = {};

      keyValues.forEach((pair) => {
        const [key, value] = pair.split(':', 2).map((part) => part.trim());
        parsedResult[key] = !isNaN(Number(value)) ? Number(value) : value || undefined;
      });

      return parsedResult;
    } catch (error) {
      this.logger.error(`Failed to parse LOADCOMPLETE log entry: ${logEntry} - ${error.message}`);
      return null;
    }
  }


  async assignUnitsToBookletAndPerson(person: Person, rows: Response[]): Promise<Person> {
    for (const row of rows) {
      const matchesPerson =
        row.groupname === person.group &&
        row.loginname === person.login &&
        row.code === person.code;

      if (!matchesPerson) continue;

      const booklet = person.booklets.find(b => b.id === row.bookletname);
      if (!booklet) continue;
      let parsedResponses: Chunk[] = [];
      if (typeof row.responses === 'string') {
        const responseChunksCleaned = row.responses.replace(/""/g, '"');
        try {
          parsedResponses = JSON.parse(responseChunksCleaned);
        } catch (e) {
          this.logger.error('Error parsing responses:');
        }
      } else {
        parsedResponses = row.responses;
      }
      const subforms: TcMergeSubForms[] = parsedResponses
        .filter(chunk => chunk?.id === 'elementCodes')
        .map(chunk => {
          let chunkContent: TcMergeResponse[] = [];
          try {
            chunkContent = JSON.parse(chunk.content);
          } catch (e) {
            this.logger.error('Error parsing chunk content:');
          }
          return { id: chunk.id, responses: chunkContent };
        });

      // Gather variables from responses
      const variables = new Set<string>();
      subforms.forEach(subform => subform.responses.forEach(response => variables.add(response.id))
      );

      let laststate: TcMergeLastState[] = [];
      try {
        const parsedLastState = JSON.parse(row.laststate);
        laststate = Object.entries(parsedLastState).map(([key, value]) => ({
          key,
          value: value as string
        }));
      } catch (e) {
        this.logger.error('Error parsing last state:');
      }

      // Map and update booklets
      person.booklets = person.booklets.map(b => {
        if (b.id !== booklet.id) return b;

        const newUnit: TcMergeUnit = {
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

        b.units.push(newUnit);
        return b;
      });
    }
    return person;
  }

  async processPersonBooklets(personList: Person[], workspace_id:number): Promise<void> {
    await this.personsRepository.upsert(personList, ['group', 'code', 'login']);
    const persons = await this.personsRepository.find({ where: { workspace_id: workspace_id } });

    for (const person of persons) {
      for (const booklet of person.booklets) {
        if (!booklet || !booklet.id) {
          this.logger.warn(`Skipping booklet for person: ${person.group}-${person.login}-${person.code} because it's invalid`);
          continue;
        }

        let bookletInfo = await this.bookletInfoRepository.findOne({
          where: { name: booklet.id }
        });

        if (!bookletInfo) {
          bookletInfo = this.bookletInfoRepository.create({
            name: booklet.id,
            size: 0
          });
          bookletInfo = await this.bookletInfoRepository.save(bookletInfo);
        }

        const existingBooklet = await this.bookletRepository.findOne({
          where: {
            personid: person.id,
            infoid: bookletInfo.id
          }
        });

        let savedBooklet;
        if (!existingBooklet) {
          const newBooklet = this.bookletRepository.create({
            personid: person.id,
            infoid: bookletInfo.id,
            lastts: 0,
            firstts: 0
          });
          savedBooklet = await this.bookletRepository.save(newBooklet);
        } else {
          this.logger.log(`Booklet already exists for person ${person.id}`);
          savedBooklet = existingBooklet;
        }

        for (const unit of booklet.units) {
          if (!unit || !unit.id) {
            this.logger.warn(`Skipping unit in booklet ${booklet.id} for person: ${person.group}-${person.login}-${person.code} because it's invalid`);
            continue;
          }

          const existingUnit = await this.unitRepository.findOne({
            where: {
              alias: unit.alias,
              name: unit.id,
              bookletid: savedBooklet.id
            }
          });

          let savedUnit;
          if (!existingUnit) {
            const newUnit = this.unitRepository.create({
              alias: unit.alias,
              name: unit.id,
              bookletid: savedBooklet.id
            });
            savedUnit = await this.unitRepository.save(newUnit);
            this.logger.log(`Saved new unit ${savedUnit.id} for booklet ${booklet.id} and person ${person.id}`);
          } else {
            this.logger.log(`Unit already exists: ${unit.id} for booklet ${booklet.id} of person ${person.id}`);
            savedUnit = existingUnit;
          }

          if (savedUnit) {
            await this.saveUnitLastState(unit, savedUnit, booklet, person);
            await this.processSubforms(unit, savedUnit, booklet, person);
            await this.processChunks(unit, savedUnit, booklet, person);
          }
        }
      }
    }
  }

  /**
   * Saves last state of the unit if it does not exist already.
   */
  private async saveUnitLastState(unit: any, savedUnit: any, booklet: any, person: any): Promise<void> {
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

  /**
   * Processes subforms of a unit.
   */
  private async processSubforms(unit: any, savedUnit: any, booklet: any, person: any): Promise<void> {
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

  /**
   * Processes chunks for a unit.
   */
  private async processChunks(unit: any, savedUnit: any, booklet: any, person: any): Promise<void> {
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

  async saveSubformResponsesForUnit(savedUnit: TcMergeUnit, subforms: TcMergeSubForms[], personId: number) {
    try {
      for (const subform of subforms) {
        if (subform.responses && subform.responses.length > 0) {
          const responseEntries = subform.responses.map(response => ({
            unitid: Number(savedUnit.id),
            variableid: response.id,
            status: response.status,
            value: response.value,
            subform: subform.id,
            code: 0,
            score: 0
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
    const unitMap = new Map<string, TcMergeUnit>();

    booklet.units.forEach(unit => {
      unitMap.set(unit.id, { ...unit, logs: [...unit.logs] });
    });

    rows.forEach(row => {
      if (booklet?.id !== row.bookletname) return;

      const logEntryParts = row.logentry.split('='); // Einmal Split durchführen
      const log = {
        ts: row.timestamp,
        key: logEntryParts[0]?.trim(),
        parameter: logEntryParts[1]?.trim()?.replace(/"/g, '')
      };

      const existingUnit = unitMap.get(row.unitname);
      if (existingUnit) {
        existingUnit.logs.push(log);
      } else {
        const newUnit = { id: row.unitname, logs: [log] } as TcMergeUnit;
        unitMap.set(row.unitname, newUnit);
      }
    });

    booklet.units = Array.from(unitMap.values());
    return booklet;
  }

  async processPersonLogs(persons: Person[], unitLogs:Log[], bookletLogs:Log[]): Promise<void> {
    const keys = persons.map(person => ({
      group: person.group,
      code: person.code,
      login: person.login,
      workspace_id: person.workspace_id
    }));

    const existingPersons = await this.personsRepository.find({
      where: keys, select: ['group', 'code', 'login', 'booklets']
    });

    const bookletLogEnrichedPersons: any[] = existingPersons.map(person => this.assignBookletLogsToPerson(person, bookletLogs));
    bookletLogEnrichedPersons.forEach((p, i) => {
      const person = persons[i];
      this.logger.log('person', person.code);
      if (p) {
        const booklets: TcMergeBooklet[] = p.booklets as TcMergeBooklet[];
        const logEnrichedBooklets = booklets.map(b => {
          const enriched = this.assignUnitLogsToBooklet(b, unitLogs);
          const logs = person.booklets.find(pb => pb.id === b.id)?.logs;
          return { enriched, logs };
        });
        return {
          id: p.id,
          ...person,
          booklets: logEnrichedBooklets
        };
      }
      console.log('Person not found in responses');
    });

    for (const person of bookletLogEnrichedPersons) {
      for (const booklet of person.booklets) {
        if (!booklet || !booklet.id) {
          this.logger.warn(
            `Skipping booklet for person: ${person.group}-${person.login}-${person.code} because it's invalid`
          );
          continue;
        }

        const existingPerson = await this.personsRepository.findOne({
          where: {
            group: person.group,
            login: person.login,
            code: person.code
          }
        });

        if (!existingPerson) {
          this.logger.error(
            `Person not found in database: ${person.group}-${person.login}-${person.code}`
          );
          continue;
        }

        const bookletInfo = await this.bookletInfoRepository.findOne({
          where: { name: booklet.id.toUpperCase() }
        });

        if (!bookletInfo || !bookletInfo.id) {
          this.logger.warn('BookletInfo ist ungültig oder hat keine ID.');
          continue;
        }

        const existingBooklet = await this.bookletRepository.findOne({
          where: {
            personid: existingPerson.id,
            infoid: bookletInfo.id
          }
        });

        if (!existingBooklet || !existingBooklet.id) {
          continue;
        }

        try {
          if (existingBooklet && existingBooklet.id) {
            const bookletLogEntries = booklet.logs.map(log => ({
              key: log.key,
              parameter: log.parameter,
              bookletid: existingBooklet.id,
              ts: log.ts
            })) as unknown as BookletLog[];

            const bookletSessions = booklet.sessions.map(log => ({
              browser: log.browser,
              os: log.os,
              screen: log.screen,
              loadcompletems: log.loadCompleteMS,
              ts: log.ts,
              booklet: existingBooklet
            }));

            await this.bookletLogRepository.save(bookletLogEntries as BookletLog[]);
            this.logger.log(
              `Saved booklet log for booklet ${booklet.id} and person ${existingPerson.id}`
            );

            await this.bookletSessionRepository.save(
              bookletSessions as unknown as Session[]
            );
            this.logger.log(
              `Saved booklet session for booklet ${booklet.id} and person ${existingPerson.id}`
            );
          }
        } catch (error) {
          this.logger.error(
            `Failed to save logs for booklet ${booklet.id} and person ${existingPerson.id}:`,
            error.message
          );
        }

        for (const unit of booklet.units) {
          if (!unit || !unit.id) {
            this.logger.warn(
              `Skipping unit in booklet ${booklet.id} for person: ${person.group}-${person.login}-${person.code} because it's invalid`
            );
            continue;
          }

          const existingUnit = await this.unitRepository.findOne({
            where: {
              alias: unit.alias,
              name: unit.id,
              bookletid: existingBooklet.id
            }
          });

          if (existingUnit) {
            try {
              const unitLogEntries = unit.logs.map(log => ({
                key: log.key,
                parameter: log.parameter,
                unitid: existingUnit.id,
                ts: log.ts
              })) as unknown as UnitLog[];

              await this.unitLogRepository.insert(unitLogEntries);
              this.logger.log(
                `Saved log for unit ${unit.id} of booklet ${booklet.id} for person ${existingPerson.id}`
              );
            } catch (error) {
              this.logger.error(
                `Failed to save last state for unit ${unit.id}:`,
                error.message
              );
            }
          }
        }
      }
    }
  }
}
