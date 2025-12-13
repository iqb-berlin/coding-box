import {
  Injectable, Logger
} from '@nestjs/common';
import 'multer';
import * as csv from 'fast-csv';
import { Readable } from 'stream';
import { FileIo } from '../../admin/workspace/file-io.interface';
import { Log, Person, Response } from './shared-types';
import { PersonService } from './person.service';
import {
  TestResultsUploadIssueDto,
  TestResultsUploadResultDto,
  TestResultsUploadStatsDto
} from '../../../../../../api-dto/files/test-results-upload-result.dto';

type PersonWithoutBooklets = Omit<Person, 'booklets'>;

@Injectable()
export class UploadResultsService {
  private readonly logger = new Logger(UploadResultsService.name);
  person: PersonWithoutBooklets[] = [];
  constructor(
    private readonly personService: PersonService
  ) {
  }

  private filterImportedPersons(
    persons: Person[],
    scope: 'person' | 'workspace' | 'group' | 'booklet' | 'unit' | 'response',
    filters?: { groupName?: string; bookletName?: string; unitNameOrAlias?: string; variableId?: string; subform?: string }
  ): Person[] {
    if (!Array.isArray(persons) || persons.length === 0) {
      return [];
    }

    const groupName = (filters?.groupName || '').trim();
    const bookletName = (filters?.bookletName || '').trim();
    const unitNameOrAlias = (filters?.unitNameOrAlias || '').trim();
    const variableId = (filters?.variableId || '').trim();
    const subform = (filters?.subform || '').trim();

    let filtered = persons;

    if (scope === 'group') {
      if (!groupName) {
        return [];
      }
      filtered = filtered.filter(p => (p.group || '') === groupName);
    }

    if (scope === 'booklet' || scope === 'unit' || scope === 'response') {
      if (scope === 'booklet' && !bookletName) return [];
      if (scope === 'unit' && !unitNameOrAlias) return [];
      if (scope === 'response' && (!variableId || subform === undefined)) return [];

      filtered = filtered.map(p => ({
        ...p,
        booklets: (p.booklets || [])
          .filter(b => {
            if (scope === 'booklet') {
              return (b.id || '') === bookletName;
            }
            return true;
          })
          .map(b => ({
            ...b,
            units: (b.units || [])
              .filter(u => {
                if (scope === 'unit') {
                  return (u.id || '') === unitNameOrAlias || (u.alias || '') === unitNameOrAlias;
                }
                return true;
              })
              .map(u => {
                if (scope !== 'response') {
                  return u;
                }
                return {
                  ...u,
                  subforms: (u.subforms || []).map(sf => {
                    if ((sf.id || '') !== subform) {
                      return { ...sf, responses: [] };
                    }
                    return {
                      ...sf,
                      responses: (sf.responses || []).filter(r => (r.id || '') === variableId)
                    };
                  })
                };
              })
          }))
      }));

      // Clean empty structures
      filtered = filtered
        .map(p => ({
          ...p,
          booklets: (p.booklets || [])
            .map(b => ({
              ...b,
              units: (b.units || []).filter(u => {
                if (scope !== 'response') return true;
                return (u.subforms || []).some(sf => (sf.responses || []).length > 0);
              })
            }))
            .filter(b => (b.units || []).length > 0)
        }))
        .filter(p => (p.booklets || []).length > 0);
    }

    return filtered;
  }

  private zeroStats(): TestResultsUploadStatsDto {
    return {
      testPersons: 0,
      testGroups: 0,
      uniqueBooklets: 0,
      uniqueUnits: 0,
      uniqueResponses: 0
    };
  }

  private mergeStatusCounts(
    base: Record<string, number> | undefined,
    other: Record<string, number> | undefined
  ): Record<string, number> {
    const out: Record<string, number> = { ...(base || {}) };
    for (const [status, count] of Object.entries(other || {})) {
      out[status] = (out[status] || 0) + Number(count || 0);
    }
    return out;
  }

  async uploadTestResults(
    workspace_id: number,
    originalFiles: FileIo[],
    resultType:'logs' | 'responses',
    overwriteExisting: boolean = true,
    personMatchMode?: 'strict' | 'loose',
    overwriteMode: 'skip' | 'merge' | 'replace' = 'skip',
    scope: 'person' | 'workspace' | 'group' | 'booklet' | 'unit' | 'response' = 'person',
    scopeFilters: { groupName?: string; bookletName?: string; unitNameOrAlias?: string; variableId?: string; subform?: string } | undefined = undefined
  ): Promise<TestResultsUploadResultDto> {
    this.logger.log(`Uploading test results for workspace ${workspace_id} (overwrite existing: ${overwriteExisting})`);
    const before = await this.personService.getWorkspaceUploadStats(workspace_id);

    const effectivePersonMatchMode: 'strict' | 'loose' = personMatchMode || 'strict';

    const MAX_FILES_LENGTH = 1000;
    if (originalFiles.length > MAX_FILES_LENGTH) {
      this.logger.error(`Too many files to upload: ${originalFiles.length}`);
      const after = await this.personService.getWorkspaceUploadStats(workspace_id);
      return {
        expected: this.zeroStats(),
        before,
        after,
        delta: {
          testPersons: after.testPersons - before.testPersons,
          testGroups: after.testGroups - before.testGroups,
          uniqueBooklets: after.uniqueBooklets - before.uniqueBooklets,
          uniqueUnits: after.uniqueUnits - before.uniqueUnits,
          uniqueResponses: after.uniqueResponses - before.uniqueResponses
        },
        responseStatusCounts: {},
        issues: [{ level: 'error', message: `Too many files: ${originalFiles.length}` }]
      };
    }

    const expectedAgg = {
      persons: new Set<string>(),
      groups: new Set<string>(),
      booklets: new Set<string>(),
      units: new Set<string>(),
      responses: new Set<string>()
    };
    let statusCounts: Record<string, number> = {};
    const issues: TestResultsUploadIssueDto[] = [];

    for (const file of originalFiles) {
      const res = await this.uploadFile(
        file,
        workspace_id,
        resultType,
        overwriteExisting,
        expectedAgg,
        issues,
        effectivePersonMatchMode,
        overwriteMode,
        scope,
        scopeFilters
      );
      statusCounts = this.mergeStatusCounts(statusCounts, res);
    }

    const after = await this.personService.getWorkspaceUploadStats(workspace_id);

    const expected: TestResultsUploadStatsDto = {
      testPersons: expectedAgg.persons.size,
      testGroups: expectedAgg.groups.size,
      uniqueBooklets: expectedAgg.booklets.size,
      uniqueUnits: expectedAgg.units.size,
      uniqueResponses: expectedAgg.responses.size
    };

    const delta: TestResultsUploadStatsDto = {
      testPersons: after.testPersons - before.testPersons,
      testGroups: after.testGroups - before.testGroups,
      uniqueBooklets: after.uniqueBooklets - before.uniqueBooklets,
      uniqueUnits: after.uniqueUnits - before.uniqueUnits,
      uniqueResponses: after.uniqueResponses - before.uniqueResponses
    };

    return {
      expected,
      before,
      after,
      delta,
      responseStatusCounts: Object.keys(statusCounts).length ? statusCounts : undefined,
      issues: issues.length ? issues : undefined
    };
  }

  async uploadFile(
    file: FileIo,
    workspace_id: number,
    resultType: 'logs' | 'responses',
    overwriteExisting: boolean = true,
    expectedAgg?: {
      persons: Set<string>;
      groups: Set<string>;
      booklets: Set<string>;
      units: Set<string>;
      responses: Set<string>;
    },
    issues?: TestResultsUploadIssueDto[],
    personMatchMode: 'strict' | 'loose' = 'strict',
    overwriteMode: 'skip' | 'merge' | 'replace' = 'skip',
    scope: 'person' | 'workspace' | 'group' | 'booklet' | 'unit' | 'response' = 'person',
    scopeFilters: { groupName?: string; bookletName?: string; unitNameOrAlias?: string; variableId?: string; subform?: string } | undefined = undefined
  ): Promise<Record<string, number> | undefined> {
    const statusCounts: Record<string, number> = {};

    if (file.mimetype === 'text/csv') {
      const bufferStream = new Readable();
      bufferStream.push(file.buffer);
      bufferStream.push(null);
      if (resultType === 'logs') {
        await this.handleCsvStream<Log>(bufferStream, resultType, async rowData => {
          rowData.forEach((row, rowIndex) => {
            const groupname = row.groupname || '';
            const loginname = row.loginname || '';
            const code = row.code || '';
            const personKey = personMatchMode === 'loose' ? `${loginname}@@${code}` : `${groupname}@@${loginname}@@${code}`;
            expectedAgg?.persons.add(personKey);
            expectedAgg?.groups.add(groupname);
            if (row.bookletname) {
              expectedAgg?.booklets.add(row.bookletname);
            }
            const unitKey = row.originalUnitId || row.unitname || '';
            if (unitKey) {
              expectedAgg?.units.add(unitKey);
            }

            if (!groupname || !loginname || !code) {
              issues?.push({
                level: 'warning',
                message: 'Missing group/login/code in row',
                fileName: file.originalname,
                rowIndex
              });
            }
          });

          const { bookletLogs, unitLogs } = rowData.reduce(
            (acc, row) => {
              row.unitname === '' ? acc.bookletLogs.push(row) : acc.unitLogs.push(row);
              return acc;
            },
            { bookletLogs: [], unitLogs: [] }
          );
          const personList = await this.personService.createPersonList(rowData, workspace_id);
          await this.personService.processPersonLogs(personList, unitLogs, bookletLogs, overwriteExisting);
        });
      } else if (resultType === 'responses') {
        await this.handleCsvStream<Response>(bufferStream, resultType, async rowData => {
          rowData.forEach((row, rowIndex) => {
            const groupname = row.groupname || '';
            const loginname = row.loginname || '';
            const code = row.code || '';
            const bookletname = row.bookletname || '';
            const unitKey = row.originalUnitId || row.unitname || '';

            const personKey = personMatchMode === 'loose' ? `${loginname}@@${code}` : `${groupname}@@${loginname}@@${code}`;
            expectedAgg?.persons.add(personKey);
            expectedAgg?.groups.add(groupname);
            if (bookletname) {
              expectedAgg?.booklets.add(bookletname);
            }
            if (unitKey) {
              expectedAgg?.units.add(unitKey);
            }

            // Compute unique responses and status counts from response chunks
            try {
              const chunks = typeof row.responses === 'string' ? JSON.parse(row.responses) : row.responses;
              if (Array.isArray(chunks)) {
                chunks.forEach(chunk => {
                  if (!chunk || typeof chunk !== 'object') return;
                  const subForm = (chunk as { subForm?: string }).subForm || '';
                  const content = (chunk as { content?: string }).content;
                  if (!content || typeof content !== 'string') return;
                  try {
                    const chunkResponses = JSON.parse(content) as Array<{ id?: string; status?: string }>;
                    if (!Array.isArray(chunkResponses)) return;
                    chunkResponses.forEach(r => {
                      const responseId = r?.id || '';
                      if (!responseId) return;
                      const uniqueKey = `${personKey}@@${bookletname}@@${unitKey}@@${subForm}@@${responseId}`;
                      expectedAgg?.responses.add(uniqueKey);
                      const status = r?.status || 'UNKNOWN';
                      statusCounts[status] = (statusCounts[status] || 0) + 1;
                    });
                  } catch {
                    issues?.push({
                      level: 'warning',
                      message: 'Malformed chunk content JSON',
                      fileName: file.originalname,
                      rowIndex
                    });
                  }
                });
              }
            } catch {
              issues?.push({
                level: 'warning',
                message: 'Malformed responses JSON',
                fileName: file.originalname,
                rowIndex
              });
            }
          });

          const basePersons = await this.personService.createPersonList(rowData, workspace_id);
          const personsWithUnits = await Promise.all(
            basePersons.map(async person => {
              const personWithBooklets = await this.personService.assignBookletsToPerson(person, rowData);
              return this.personService.assignUnitsToBookletAndPerson(personWithBooklets, rowData);
            })
          );

          const filteredPersons = this.filterImportedPersons(personsWithUnits, scope, scopeFilters);
          await this.personService.processPersonBooklets(filteredPersons, workspace_id, overwriteMode, scope === 'workspace' ? 'workspace' : 'person');
        });
      }
    }

    return Object.keys(statusCounts).length > 0 ? statusCounts : undefined;
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
