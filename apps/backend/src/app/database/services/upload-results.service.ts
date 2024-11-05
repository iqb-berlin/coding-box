import {
  Injectable, Logger
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import 'multer';
import { promises as fs, createReadStream, unlinkSync } from 'fs';
import * as csv from 'fast-csv';
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
        const rowData: Log[] = [];
        await fs.writeFile(`logs-${randomInteger}.csv`, file.buffer);
        const stream = createReadStream(`logs-${randomInteger}.csv`);
        const csvParserStream = csv.parseStream(stream, {
          headers: true,
          delimiter: ';',
          quote: null
        });
        csvParserStream.transform(
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
            unlinkSync(`logs-${randomInteger}.csv`);
            this.logger.log(error);
          })
          .on('data', row => rowData.push(row))
          .on('end', async () => {
            unlinkSync(`logs-${randomInteger}.csv`);
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
            const persons = this.persons.map(person => this.assignBookletLogsToPerson(person, bookletLogs, unitLogs));
            const updateListPromises = [];
            for (let i = 0; i < persons.length; i++) {
              const person = persons[i];
              updateListPromises.push(this.personsRepository.findOneBy(
                {
                  group: person.group,
                  code: person.code,
                  login: person.login
                }
              )
                .then(p => {
                  if (p !== null) {
                    const booklets: TcMergeBooklet[] = p.booklets as TcMergeBooklet[];
                    const mappedBooklets = booklets.map(b =>
                      // const mappedUnits = b.units.map(u => {
                      //   unitLogs.forEach(log => {
                      //     if (log.unitname === u.id && log.bookletname === b.id) {
                      //       u.logs.push({
                      //         ts: log.timestamp,
                      //         key: log.logentry.split('=')[0]?.trim(),
                      //         parameter: log.logentry.split('=')[1]?.trim()
                      //           .replace(/"/g, '')
                      //       });
                      //     }
                      //   });
                      //   return u;
                      // })
                      ({
                        ...b,
                        logs: person.booklets.find(pb => pb.id === b.id).logs
                      })
                    );
                    mappedBooklets.map(booklet => this.assignUnitLogsToBooklet(booklet, unitLogs));
                    return {
                      id: p.id,
                      ...person,
                      booklets: mappedBooklets
                    };
                  }

                  console.log('Person not found in responses');
                }

                ));
            }
            const res = await Promise.all(updateListPromises);

            const chunks = (arr, size) => Array.from(
              { length: Math.ceil(arr.length / size) },
              (v, i) => arr.slice(i * size, i * size + size)
            );
            for (let i = 0; i < chunks(res, 10).length; i++) {
              const chunk = chunks(res, 10)[i];
              this.personsRepository
                .upsert(chunk, ['group', 'code', 'login']).then(() => {
                  console.log('updated');
                });
            }
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

  assignBookletLogsToPerson(person: Person, rows: Log[], unitLogs:Log[]): Person {
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
    const units : TcMergeUnit[] = [];

    rows.forEach(row => {
      if (booklet?.id === row.bookletname) {
        const existingUnit = units.find(u => u?.id === row.unitname);
        const existingUnitIndex = units.findIndex(u => u?.id === row.unitname);

        if (existingUnit) {
          existingUnit.logs = [...existingUnit.logs, {
            ts: row.timestamp,
            key: row.logentry.split('=')[0]?.trim(),
            parameter: row.logentry.split('=')[1]?.trim().replace(/"/g, '')
          }];
          units[existingUnitIndex] = existingUnit;
        } else {
          const foundUnit = booklet.units.find(u => u?.id === row.unitname);
          if (foundUnit) {
            foundUnit.logs.push({
              ts: row.timestamp,
              key: row.logentry.split('=')[0]?.trim(),
              parameter: row.logentry.split('=')[1]?.trim().replace(/"/g, '')
            });
          }
          units.push(foundUnit);
        }
      }
      //
      // booklet.units.forEach(unit => {
      //   if (!units.find(u => row.unitname === u.id)) {
      //     units.push({
      //       ...unit,
      //       logs: [{
      //         ts: row.timestamp,
      //         key: row.logentry.split('=')[0]?.trim(),
      //         parameter: row.logentry.split('=')[1]?.trim().replace(/"/g, '')
      //       }]
      //     });
      //   } else {
      //     const unitIndex = units.findIndex(u => u.id === row.unitname);
      //     const logEntry = row.logentry.split('=');
      //     units[unitIndex].logs.push({
      //       ts: row.timestamp,
      //       key: logEntry[0]?.trim(),
      //       parameter: logEntry[1]?.trim().replace(/"/g, '')
      //     });
      //   }
      // });
    });
    booklet.units = units;
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
