import {
  Injectable, Logger
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import 'multer';
import * as csv from 'fast-csv';
import { Readable } from 'stream';
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
import Logs from '../entities/logs.entity';

@Injectable()
export class UploadResultsService {
  private readonly logger = new Logger(UploadResultsService.name);
  constructor(
    @InjectRepository(Persons)
    private personsRepository: Repository<Persons>
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

            // Trennt die Daten direkt mit `reduce`, um die Logs in einem Schritt zu sortieren.
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

            const persons = this.persons.map(person => this.assignBookletLogsToPerson(person, bookletLogs));
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
        bufferStream.push(null); // Signalisiert das Ende der Daten;
        csv.parseStream(bufferStream, { headers: true, delimiter: ';' })
          .on('error', error => {
            this.logger.log(error);
          })
          .on('data', row => rowData.push(row))
          .on('end', () => {
            this.createPersonList(rowData);
            const personList = this.persons.map(person => this.assignBookletsToPerson(person, rowData))
              .map(person => this.assignUnitsToBookletAndPerson(person, rowData)
              );
            this.personsRepository.upsert(personList, ['group', 'code', 'login']).then(() => {
              console.log(`Saved ${personList.length} test persons`);
            });
          });
      }
    }
  }

  createPersonList(rows: Response[] | Log[] | Logs[]): void {
    // Verwendung einer Map für eine effizientere Suche.
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

    // Konvertiere die Map-Werte in ein Array und weise es zu.
    this.persons = Array.from(personMap.values());
  }

  assignBookletsToPerson(person: Person, rows: Response[]): Person {
    const bookletIds = new Set<string>(); // Verfolgt eindeutige Booklet-IDs
    const booklets: TcMergeBooklet[] = [];

    rows.forEach(row => {
      if (row.groupname === person.group && row.loginname === person.login && row.code === person.code) {
        if (!bookletIds.has(row.bookletname)) { // Prüft effizient, ob `bookletname` bereits hinzugefügt wurde
          bookletIds.add(row.bookletname);
          booklets.push({
            id: row.bookletname,
            logs: [],
            units: [],
            sessions: []
          });
        }
      }
    });

    person.booklets = booklets;
    return person;
  }

  assignBookletLogsToPerson(person: Person, rows: Log[]): Person {
    const booklets: TcMergeBooklet[] = [];
    const bookletMap = new Map<string, TcMergeBooklet>(); // Map für schnelles Nachschlagen

    rows.forEach(row => {
      if (row.groupname === person.group && row.loginname === person.login && row.code === person.code) {
        const { bookletname, timestamp, logentry } = row;
        const [logEntryKey, logEntryValueRaw] = logentry.split(':', 2);
        const logEntryValue = logEntryValueRaw?.trim().replace(/"/g, '');

        // Überprüfen, ob das Booklet bereits existiert
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

  assignUnitLogsToBooklet(booklet: TcMergeBooklet, rows: Log[]): TcMergeBooklet {
    // Map für eindeutigen Zugriff auf Units erstellen
    const unitMap = new Map<string, TcMergeUnit>();

    // Direkten Lookup für Units im Booklet vorbereiten
    booklet.units.forEach(unit => {
      unitMap.set(unit.id, { ...unit, logs: [...unit.logs] });
    });

    // Logs verarbeiten und zu den Units hinzufügen
    rows.forEach(row => {
      if (booklet?.id !== row.bookletname) return;

      const logEntryParts = row.logentry.split('='); // Einmal Split durchführen
      const log = {
        ts: row.timestamp,
        key: logEntryParts[0]?.trim(),
        parameter: logEntryParts[1]?.trim()?.replace(/"/g, '')
      };

      // Einheit aus der Map holen oder neuen Eintrag hinzufügen
      const existingUnit = unitMap.get(row.unitname);
      if (existingUnit) {
        existingUnit.logs.push(log);
      } else {
        // Neue Einheit erstellen und in die Map einfügen
        const newUnit = { id: row.unitname, logs: [log] } as TcMergeUnit;
        unitMap.set(row.unitname, newUnit);
      }
    });

    // Map wieder in ein Array umwandeln, um dem ursprünglichen Format zu entsprechen
    booklet.units = Array.from(unitMap.values());
    return booklet;
  }

  assignUnitsToBookletAndPerson(person: Person, rows: Response[]): Person {
    rows.forEach(row => {
      const matchesPerson = row.groupname === person.group &&
        row.loginname === person.login &&
        row.code === person.code;

      if (!matchesPerson) return;

      const booklet = person.booklets.find(b => b.id === row.bookletname);
      if (!booklet) return;

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
    });
    return person;
  }
}
