import {
  Injectable, Logger
} from '@nestjs/common';
import 'multer';
import * as csv from 'fast-csv';
import { Readable } from 'stream';
import { FileIo } from '../../admin/workspace/file-io.interface';
import { Log, Person, Response } from './shared-types';
import { PersonService } from './person.service';

type PersonWithoutBooklets = Omit<Person, 'booklets'>;

@Injectable()
export class UploadResultsService {
  private readonly logger = new Logger(UploadResultsService.name);
  person: PersonWithoutBooklets[] = [];
  constructor(
    private readonly personService: PersonService
  ) {
  }

  async uploadTestResults(
    workspace_id: number,
    originalFiles: FileIo[],
    resultType:'logs' | 'responses',
    overwriteExisting: boolean = true
  ): Promise<boolean> {
    this.logger.log(`Uploading test results for workspace ${workspace_id} (overwrite existing: ${overwriteExisting})`);
    const MAX_FILES_LENGTH = 1000;
    if (originalFiles.length > MAX_FILES_LENGTH) {
      this.logger.error(`Too many files to upload: ${originalFiles.length}`);
      return false;
    }
    const filePromises = [];
    for (let i = 0; i < originalFiles.length; i++) {
      const file = originalFiles[i];
      filePromises.push(this.uploadFile(file, workspace_id, resultType, overwriteExisting));
    }
    await Promise.all(filePromises);
    return true;
  }

  async uploadFile(
    file: FileIo,
    workspace_id: number,
    resultType: 'logs' | 'responses',
    overwriteExisting: boolean = true
  ): Promise<void> {
    if (file.mimetype === 'text/csv') {
      const bufferStream = new Readable();
      bufferStream.push(file.buffer);
      bufferStream.push(null);
      if (resultType === 'logs') {
        await this.handleCsvStream<Log>(bufferStream, resultType, async rowData => {
          const { bookletLogs, unitLogs } = rowData.reduce(
            (acc, row) => {
              row.unitname === '' ? acc.bookletLogs.push(row) : acc.unitLogs.push(row);
              return acc;
            },
            { bookletLogs: [], unitLogs: [] }
          );
          const persons = await this.personService.createPersonList(rowData, workspace_id);
          await this.personService.processPersonLogs(persons, unitLogs, bookletLogs, overwriteExisting);
        });
      } else if (resultType === 'responses') {
        await this.handleCsvStream<Response>(bufferStream, resultType, async rowData => {
          const persons = await this.personService.createPersonList(rowData, workspace_id);
          const personList = await Promise.all(
            persons.map(async person => {
              const personWithBooklets = await this.personService.assignBookletsToPerson(person, rowData);
              return this.personService.assignUnitsToBookletAndPerson(personWithBooklets, rowData);
            })
          );
          await this.personService.processPersonBooklets(personList, workspace_id);
        });
      }
    }
  }

  private handleCsvStream<T>(
    bufferStream: Readable,
    resultType: 'logs' | 'responses',
    onDataProcessed: (rowData: T[]) => Promise<void>
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const rowData: T[] = [];
      this.logger.log(`Processing CSV stream for ${resultType}`);

      csv.parseStream(bufferStream, { headers: true, delimiter: ';', quote: resultType === 'logs' ? null : '"' })
        .transform((row: T) => {
          if (resultType === 'logs') {
            Object.keys(row).forEach(key => {
              if (typeof row[key] === 'string') {
                row[key] = row[key].replace(/"/g, '');
              }
            });
          }
          return row;
        })
        .on('data', (row: T) => { rowData.push(row); })
        .on('error', error => {
          this.logger.error(`CSV Parsing Error: ${error.message}`);
          reject(error);
        })
        .on('end', async () => {
          try {
            await onDataProcessed(rowData);
            resolve();
          } catch (processError) {
            reject(processError);
          }
        });
    });
  }
}
