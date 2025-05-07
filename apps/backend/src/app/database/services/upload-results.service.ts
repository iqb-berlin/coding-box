import {
  Injectable, Logger
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import 'multer';
import * as csv from 'fast-csv';
import { Readable } from 'stream';
import { Booklet } from '../entities/booklet.entity';
import { FileIo } from '../../admin/workspace/file-io.interface';
import {
  Chunk,
  Log,
  Person,
  Response,
  TcMergeBooklet, TcMergeLastState,
  TcMergeResponse,
  TcMergeSubForms,
  TcMergeUnit
} from './workspace.service';
import Persons from '../entities/persons.entity';
import { Person as PersonEntity } from '../entities/person.entity';
import Logs from '../entities/logs.entity';
import { BookletInfo } from '../entities/bookletInfo.entity';
import { Unit } from '../entities/unit.entity';
import { UnitLastState } from '../entities/unitLastState.entity';
import { ResponseEntity } from '../entities/response.entity';
import { ChunkEntity } from '../entities/chunk.entity';

type PersonWithoutBooklets = Omit<Person, 'booklets'>;

@Injectable()
export class UploadResultsService {
  private readonly logger = new Logger(UploadResultsService.name);
  person: PersonWithoutBooklets[] = []; // Typ ohne 'booklets'

  constructor(
    @InjectRepository(Persons)
    private personsRepository: Repository<Persons>,
    @InjectRepository(PersonEntity)
    private personRepository: Repository<PersonEntity>,
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
    private chunkRepository: Repository<ChunkEntity>
  ) {
  }

  persons: Person[] = [];

  async uploadTestResults(workspace_id: number, originalFiles: FileIo[]): Promise<boolean> {
    this.logger.log(`Uploading test results for workspace ${workspace_id}`);
    if (!Array.isArray(originalFiles)) {
      originalFiles = [originalFiles];
    }
    const MAX_FILES_LENGTH = 1000; // Define a reasonable maximum length
    if (originalFiles.length > MAX_FILES_LENGTH) {
      this.logger.error(`Too many files to upload: ${originalFiles.length}`);
      return false;
    }
    const filePromises = [];
    for (let i = 0; i < originalFiles.length; i++) {
      const file = originalFiles[i];
      filePromises.push(this.uploadFile(file));
    }
    await Promise.all(filePromises);
    return true;
  }

  async uploadFile(file:FileIo) {
    if (file.mimetype === 'text/csv') {
      const randomInteger = Math.floor(Math.random() * 10000);
      if (file.originalname.includes('logs')) {
        console.log('logs');
        const bufferStream = new Readable();
        bufferStream.push(file.buffer);
        bufferStream.push(null); // Signalisiert das Ende der Daten
        const startTime = performance.now();
        const rowData: Log[] = [];
        const csvParserStream = csv
          .parseStream(bufferStream, {
            headers: true,
            delimiter: ';',
            quote: null
          })
          .transform(
            (data: Log): Log => ({
              groupname: data.groupname?.replace(/"/g, ''),
              loginname: data.loginname?.replace(/"/g, ''),
              code: data.code?.replace(/"/g, ''),
              bookletname: data.bookletname?.replace(/"/g, ''),
              unitname: data.unitname?.replace(/"/g, ''),
              timestamp: data.timestamp?.replace(/"/g, ''),
              logentry: data.logentry
            })

          )
          .on('error', error => {
            this.logger.log(error);
          })
          .on('data', row => rowData.push(row))
          .on('end', async () => {
            const endTime = performance.now();
            console.log('CSV read duration:', `${(endTime - startTime) / 1000}s`);
            const { bookletLogs, unitLogs } = rowData.reduce(
              (acc, row) => {
                row.unitname === '' ? acc.bookletLogs.push(row) : acc.unitLogs.push(row);
                return acc;
              },
              { bookletLogs: [], unitLogs: [] }
            );
            this.createPersonList(rowData);
            const personTime = performance.now();
            console.log('personTime', `${(personTime - startTime) / 1000}s`);
            const persons = this.persons
              .map(person => this.assignBookletLogsToPerson(person, bookletLogs));
            const loggedPersonTime = performance.now();
            console.log('loggedPersonTime', `${(loggedPersonTime - startTime) / 1000}s`);
            const keys = persons.map(person => ({
              group: person.group,
              code: person.code,
              login: person.login
            }));

            const existingPersons = await this.personsRepository.find({
              where: keys
            });

            existingPersons.forEach((p, i) => {
              const person = persons[i];
              console.log('person', person.code);

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

            const res = existingPersons;
            const manipulatedPersonsTime = performance.now();
            console.log('manipulatedPersons', `${(manipulatedPersonsTime - startTime) / 1000}s`);
            const chunks = <T>(arr: T[], size: number): T[][] => Array.from({ length: Math.ceil(arr.length / size) }, (_, i) => arr.slice(i * size, i * size + size));
            const chunkedData = chunks(res, 10);
            await Promise.all(
              chunkedData.map(async chunk => {
                await this.personsRepository.upsert(chunk, ['group', 'code', 'login']);
                console.log('updated');
              })
            );
          });
      } else {
        console.log('Start to import responses. ');
        const rowData: Response[] = [];
        const bufferStream = new Readable();
        bufferStream.push(file.buffer);
        bufferStream.push(null);
        csv.parseStream(bufferStream, { headers: true, delimiter: ';' })
          .on('error', error => {
            this.logger.log(error);
          })
          .on('data', row => rowData.push(row))
          .on('end', async () => {
            console.log('Anzahl der Antworten', rowData.length);
            this.createPersonList(rowData);
            const personList = await Promise.all(
              this.persons.map(async person => {
                const personWithBooklets = await this.assignBookletsToPerson(person, rowData);
                return this.assignUnitsToBookletAndPerson(personWithBooklets, rowData);
              })
            );

            await this.personsRepository.upsert(personList, ['group', 'code', 'login']);

            const persons = await this.personsRepository.find();
            for (const person of persons) {
              for (const booklet of person.booklets) {
                // Sicherstellen, dass es ein `booklet` gibt
                if (!booklet || !booklet.id) {
                  this.logger.warn(`Skipping booklet for person: ${person.group}-${person.login}-${person.code} because it's invalid`);
                  continue;
                }

                // Überprüfen, ob `BookletInfo` bereits existiert
                let bookletInfo = await this.bookletInfoRepository.findOne({
                  where: { name: booklet.id } // `name` ist das `id` des Booklets
                });

                if (!bookletInfo) {
                  // Wenn es nicht existiert, ein neues erstellen
                  bookletInfo = this.bookletInfoRepository.create({
                    name: booklet.id,
                    size: 0 // Standardwert
                  });
                  bookletInfo = await this.bookletInfoRepository.save(bookletInfo);
                }

                // Prüfen, ob das Booklet mit der Person gespeichert wurde
                const existingBooklet = await this.bookletRepository.findOne({
                  where: {
                    personid: person.id,
                    infoid: bookletInfo.id
                  }
                });

                let savedBooklet;
                if (!existingBooklet) {
                  // Neues Booklet erstellen
                  const newBooklet = this.bookletRepository.create({
                    personid: person.id,
                    infoid: bookletInfo.id,
                    lastts: 0,
                    firstts: 0
                  });

                  // Booklet speichern
                  savedBooklet = await this.bookletRepository.save(newBooklet);
                } else {
                  this.logger.log(`Booklet already exists for person ${person.id}`);
                  savedBooklet = existingBooklet;
                }

                // **Units speichern**
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
                    savedUnit = existingUnit; // Bereits bestehende Unit verwenden
                  }

                  if (savedUnit) {
                    try {
                      const currentLastState = await this.unitLastStateRepository.find({
                        where: { unitid: savedUnit.id }
                      });

                      if (currentLastState.length === 0 && unit.laststate) {
                        const lastStateEntries = Object.entries(unit.laststate).map(([key, value]) => ({
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
                      this.logger.error(`Failed to save last state for unit ${unit.id}:`, error.message);
                    }
                  }
                  if (savedUnit) {
                    try {
                      const subforms = unit.subforms;
                      if (subforms && subforms.length > 0) {
                        await this.saveSubformResponsesForUnit(savedUnit, subforms, person.id);
                      }
                      this.logger.log(`Processed subform responses for unit ${unit.id} of booklet ${booklet.id}`);
                    } catch (error) {
                      this.logger.error(`Failed to process subform responses for unit: ${unit.id}`, error.message);
                    }
                  }
                  if (savedUnit) {
                    try {
                      if (unit.chunks && unit.chunks.length > 0) {
                        const chunkEntries = unit.chunks.map(chunk => ({
                          unitid: savedUnit.id,
                          key: chunk.id,
                          type: chunk.type,
                          ts: chunk.ts,
                          variables: Array.isArray(chunk.variables) ? chunk.variables.join(',') : ''
                        }));
                        await this.chunkRepository.insert(chunkEntries); // Annahme: chunkRepository existiert
                        this.logger.log(`Saved ${chunkEntries.length} chunks for unit ${unit.id} in booklet ${booklet.id}`);
                      } else {
                        this.logger.log(`No chunks to save for unit ${unit.id} in booklet ${booklet.id}`);
                      }
                    } catch (error) {
                      this.logger.error(`Failed to save chunks for unit ${unit.id} in booklet ${booklet.id}:`, error.message);
                    }
                  }
                }
              }
            }
          });
      }
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

  createPersonList(rows: Response[] | Log[] | Logs[]): void {
    const personMap = new Map<string, Person>();
    rows.forEach(row => {
      const mapKey = `${row.groupname}-${row.loginname}-${row.code}`;
      if (!personMap.has(mapKey)) {
        personMap.set(mapKey, {
          group: row.groupname,
          login: row.loginname,
          code: row.code,
          booklets: []
        });
      }
    });
    this.persons = Array.from(personMap.values());
  }

  // eslint-disable-next-line class-methods-use-this
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

  // eslint-disable-next-line class-methods-use-this
  assignBookletLogsToPerson(person: Person, rows: Log[]): Person {
    const booklets: TcMergeBooklet[] = [];
    const bookletMap = new Map<string, TcMergeBooklet>();

    rows.forEach(row => {
      if (row.groupname === person.group && row.loginname === person.login && row.code === person.code) {
        const { bookletname, timestamp, logentry } = row;
        const [logEntryKey, logEntryValueRaw] = logentry.split(':', 2);
        const logEntryValue = logEntryValueRaw?.trim().replace(/"/g, '');

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

        // "LOADCOMPLETE"-Handling
        if (logEntryKey.trim() === 'LOADCOMPLETE' && logEntryValue) {
          let parsedJSON;
          try {
            parsedJSON = JSON.parse(logEntryValue);
          } catch (e) {
            console.error('Error parsing JSON:', e);
            parsedJSON = {};
          }
          const {
            browserVersion,
            browserName,
            osName,
            screenSizeWidth,
            screenSizeHeight,
            loadTime
          } = parsedJSON;

          booklet.sessions.push({
            browser: `${browserName} ${browserVersion}`,
            os: osName,
            screen: `${screenSizeWidth} ${screenSizeHeight}`,
            ts: timestamp,
            loadCompleteMS: loadTime
          });
        }

        // Log hinzufügen
        booklet.logs.push({
          ts: timestamp,
          key: logEntryKey.trim(),
          parameter: logEntryValue || ''
        });
      }
    });

    person.booklets = booklets;
    return person;
  }

  // eslint-disable-next-line class-methods-use-this
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

  async assignUnitsToBookletAndPerson(person: Person, rows: Response[]): Promise<Person> {
    for (const row of rows) {
      const matchesPerson =
        row.groupname === person.group &&
        row.loginname === person.login &&
        row.code === person.code;

      if (!matchesPerson) continue;

      const booklet = person.booklets.find(b => b.id === row.bookletname);
      if (!booklet) continue;

      // Parse responses
      const responseChunksCleaned = row.responses.replace(/""/g, '"');
      let parsedResponses: Chunk[] = [];
      try {
        parsedResponses = JSON.parse(responseChunksCleaned);
      } catch (e) {
        console.error('Error parsing responses:', e);
      }

      // Extract and map subforms
      const subforms: TcMergeSubForms[] = parsedResponses
        .filter(chunk => chunk?.id === 'elementCodes')
        .map(chunk => {
          let chunkContent: TcMergeResponse[] = [];
          try {
            chunkContent = JSON.parse(chunk.content);
          } catch (e) {
            console.error('Error parsing chunk content:', e);
          }
          return { id: chunk.id, responses: chunkContent };
        });

      // Gather variables from responses
      const variables = new Set<string>();
      subforms.forEach(subform => subform.responses.forEach(response => variables.add(response.id))
      );

      // Parse laststate
      let laststate: TcMergeLastState[] = [];
      try {
        const parsedLastState = JSON.parse(row.laststate);
        laststate = Object.entries(parsedLastState).map(([key, value]) => ({
          key,
          value: value as string
        }));
      } catch (e) {
        console.error('Error parsing last state:', e);
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
}
