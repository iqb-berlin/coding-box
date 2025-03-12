import {
  Injectable, Logger
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import 'multer';
import { promises as fs, createReadStream, unlinkSync } from 'fs';
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
    // console.log('originalFiles', originalFiles);
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
            console.log('csv read', `${(endTime - startTime) / 1000}s`);
            const bookletLogs = [];
            const unitLogs = [];
            rowData.forEach(row => {
              if (row.unitname === '') {
                bookletLogs.push(row);
              } else {
                unitLogs.push(row);
              }
            });
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
              console.log('person', person);
              if (p !== null) {
                const booklets: TcMergeBooklet[] = p.booklets as TcMergeBooklet[];
                const mappedBooklets = booklets.map(b => ({
                  ...b,
                  logs: person.booklets.find(pb => pb.id === b.id)?.logs
                })
                );
                for (const booklet of mappedBooklets) {
                  this.assignUnitLogsToBooklet(booklet, unitLogs);
                }
                return {
                  id: p.id,
                  ...person,
                  booklets: mappedBooklets
                };
              }

              console.log('Person not found in responses');
            });

            const res = existingPersons;
            const resolvePromisesTime = performance.now();
            console.log('resolvePromisesTime', `${(resolvePromisesTime - startTime) / 1000}s`);
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
        console.log('responses');
        const rowData: Response[] = [];
        await fs.writeFile(`responses-${randomInteger}.csv`, file.buffer, 'binary');
        const stream = createReadStream(`responses-${randomInteger}.csv`);
        csv.parseStream(stream, { headers: true, delimiter: ';' })
          .on('error', error => {
            this.logger.log(error);
            unlinkSync(`responses-${randomInteger}.csv`);
          })
          .on('data', row => rowData.push(row))
          .on('end', () => {
            unlinkSync(`responses-${randomInteger}.csv`);
            console.log(rowData[0]);
            //  const cleanedRows = WorkspaceService.cleanResponses(mappedRowData);
            // cleanedRows.forEach(row => filePromises.push(
            //  this.responsesRepository.upsert(row, ['test_person', 'unit_id'])));

            this.createPersonList(rowData);
            const personList = this.persons.map(person => this.assignBookletsToPerson(person, rowData))
              .map(person => this.assignUnitsToBookletAndPerson(person, rowData)
              );
            this.personsRepository.upsert(personList, ['group', 'code', 'login']).then(() => {
              console.log('saved');
            });
          });
      }
    }
  }

  createPersonList(rows: Response[] | Log[] | Logs[]) {
    const personList : Person[] = [];
    rows.forEach(row => {
      const person = personList
        .find(p => p.group === row.groupname && p.login === row.loginname && p.code === row.code);
      if (!person) {
        personList.push(
          {
            group: row.groupname,
            login: row.loginname,
            code: row.code,
            booklets: []
          }
        );
      }
    });
    this.persons = personList;
  }

  assignBookletsToPerson(person: Person, rows: Response[]): Person {
    const booklets : TcMergeBooklet[] = [];
    rows.forEach(row => {
      if (row.groupname === person.group && row.loginname === person.login && row.code === person.code) {
        if (!booklets.find(b => b.id === row.bookletname)) {
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
    const booklets : TcMergeBooklet[] = [];
    rows.forEach(row => {
      if (row.groupname === person.group && row.loginname === person.login && row.code === person.code) {
        if (!booklets.find(b => b.id === row.bookletname)) {
          const logEntry = row.logentry.split(':', 2);
          booklets.push({
            id: row.bookletname,
            logs: [{
              ts: row.timestamp,
              key: logEntry[0].trim(),
              parameter: logEntry[1].trim().replace(/"/g, '')
            }],
            units: [],
            sessions: []
          });
        } else {
          const bookletIndex = booklets.findIndex(b => b.id === row.bookletname);
          const logEntryKey = row.logentry.substring(0, row.logentry.indexOf(':'));
          const logEntryValue = row.logentry.substring(row.logentry.indexOf(':') + 3, row.logentry.length - 1).trim().replace(/""/g, '"');

          if (logEntryKey.trim() === 'LOADCOMPLETE') {
            const parsedJSON = JSON.parse(logEntryValue);
            const {
              browserVersion, browserName, osName, screenSizeWidth, screenSizeHeight, loadTime
            } = parsedJSON;
            booklets[bookletIndex].sessions.push({
              browser: `${browserName} ${browserVersion}`,
              os: `${osName}`,
              screen: `${screenSizeWidth} ${screenSizeHeight}`,
              ts: row.timestamp,
              loadCompleteMS: loadTime
            });
          }
          booklets[bookletIndex].logs.push({
            ts: row.timestamp,
            key: logEntryKey.trim(),
            parameter: logEntryValue.trim().replace(/"/g, '')
          });
        }
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
      if (row.groupname === person.group &&
        row.loginname === person.login &&
        row.code === person.code) {
        const booklet = person.booklets.find(b => b.id === row.bookletname);
        const responseChunksCleaned = row.responses.replace(/""/g, '"');
        let parsedResponses : Chunk[] = [];
        try {
          parsedResponses = JSON.parse(responseChunksCleaned);
        } catch (e) {
          console.log('error', e);
        }
        const subforms : TcMergeSubForms[] = parsedResponses.filter(chunk => chunk?.id === 'elementCodes').map(chunk => {
          let chunkContent : TcMergeResponse[];
          try {
            chunkContent = JSON.parse(chunk.content);
          } catch (e) {
            console.log('error', e);
          }
          // chunkContent.forEach(cc => {
          //   try {
          //     if (cc.value.startsWith('data:application/octet-stream;base64')) {
          //       console.log('found Geogebra');
          //       // const writeStream = fs.createWriteStream('/', { encoding: 'base64' });
          //       const hash = crypto.createHash('sha256', { outputLength: 9 }).update(cc.value).digest('base64');
          //       fs.writeFile(`GeoGebra/${row.groupname}${row.loginname}${row.code}_${hash}.base64`, cc.value, 'base64', err => {
          //         console.log('written file');
          //       });
          //
          //       // this.logger.log('hash', hash);
          //     }
          //   } catch (e) {
          //     // console.log('error', e);
          //   }
          //   // console.log('response', response);
          // });
          return {
            id: chunk.id,
            responses: chunkContent
          };
        });
        const variables = new Set<string>();
        subforms.forEach(subform => {
          subform.responses.forEach(response => {
            variables.add(response.id);
          });
        });
        let parsedLastState = [];
        try {
          parsedLastState = JSON.parse(row.laststate);
        } catch (e) {
          console.log('error', e);
        }
        let laststate: TcMergeLastState[] = [];
        if (parsedLastState) {
          laststate = Object.entries(parsedLastState).map(ls => ({ key: ls[0], value: ls[1] as string }));
          console.log('laststate', laststate);
          //
        }
        person.booklets = person.booklets.map(b => {
          if (b.id === booklet.id) {
            b.units.push({
              id: row.unitname,
              alias: row.unitname,
              laststate: laststate,
              subforms: subforms,
              chunks: [
                {
                  id: 'elementCodes',
                  type: parsedResponses[0]?.responseType,
                  ts: parsedResponses[0]?.ts,
                  variables: Array.from(variables)
                }
              ],
              logs: []
            });
          }
          return b;
        });
      }
    });
    return person;
  }
}
