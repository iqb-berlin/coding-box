import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Like, Repository } from 'typeorm';
import * as Autocoder from '@iqb/responses';
import * as cheerio from 'cheerio';
import * as fastCsv from 'fast-csv';
import { ResponseStatusType } from '@iqb/responses';
import FileUpload from '../entities/file_upload.entity';
import Persons from '../entities/persons.entity';
import { Unit } from '../entities/unit.entity';
import { Booklet } from '../entities/booklet.entity';
import { ResponseEntity } from '../entities/response.entity';
import { CodingStatistics } from './shared-types';
import { prepareDefinition } from '../../utils/voud/transform';

@Injectable()
export class WorkspaceCodingService {
  private readonly logger = new Logger(WorkspaceCodingService.name);

  constructor(
    @InjectRepository(FileUpload)
    private fileUploadRepository: Repository<FileUpload>,
    @InjectRepository(Persons)
    private personsRepository: Repository<Persons>,
    @InjectRepository(Unit)
    private unitRepository: Repository<Unit>,
    @InjectRepository(Booklet)
    private bookletRepository: Repository<Booklet>,
    @InjectRepository(ResponseEntity)
    private responseRepository: Repository<ResponseEntity>
  ) {}

  async codeTestPersons(workspace_id: number, testPersonIds: string): Promise<CodingStatistics> {
    const ids = testPersonIds.split(',');
    this.logger.log(`Verarbeite Personen ${testPersonIds} für Workspace ${workspace_id}`);

    const statistics: CodingStatistics = {
      totalResponses: 0,
      statusCounts: {}
    };

    try {
      const persons = await this.personsRepository.find({
        where: { workspace_id, id: In(ids) }, select: ['id', 'group', 'login', 'code', 'uploaded_at']
      });

      if (!persons || persons.length === 0) {
        this.logger.warn('Keine Personen gefunden mit den angegebenen IDs.');
        return statistics;
      }

      const personIds = persons.map(person => person.id);

      const booklets = await this.bookletRepository.find({
        where: { personid: In(personIds) }
      });

      if (!booklets || booklets.length === 0) {
        this.logger.log('Keine Booklets für die angegebenen Personen gefunden.');
        return statistics;
      }

      const bookletIds = booklets.map(booklet => booklet.id);

      const units = await this.unitRepository.find({
        where: { bookletid: In(bookletIds) }
      });

      if (!units || units.length === 0) {
        this.logger.log('Keine Einheiten für die angegebenen Booklets gefunden.');
        return statistics;
      }

      const bookletToUnitsMap = new Map();
      units.forEach(unit => {
        if (!bookletToUnitsMap.has(unit.bookletid)) {
          bookletToUnitsMap.set(unit.bookletid, []);
        }
        bookletToUnitsMap.get(unit.bookletid).push(unit);
      });

      const unitIds = units.map(unit => unit.id);
      const unitAliases = units.map(unit => unit.alias.toUpperCase());

      const allResponses = await this.responseRepository.find({
        where: { unitid: In(unitIds), status: In(['VALUE_CHANGED']) }
      });

      const unitToResponsesMap = new Map();
      allResponses.forEach(response => {
        if (!unitToResponsesMap.has(response.unitid)) {
          unitToResponsesMap.set(response.unitid, []);
        }
        unitToResponsesMap.get(response.unitid).push(response);
      });
      const testFiles = await this.fileUploadRepository.find({
        where: { workspace_id: workspace_id, file_id: In(unitAliases) }
      });

      const fileIdToTestFileMap = new Map();
      testFiles.forEach(file => {
        fileIdToTestFileMap.set(file.file_id, file);
      });

      const codingSchemeRefs = new Set<string>();
      const unitToCodingSchemeRefMap = new Map();
      for (const unit of units) {
        const testFile = fileIdToTestFileMap.get(unit.alias.toUpperCase());
        if (!testFile) continue;

        try {
          const $ = cheerio.load(testFile.data);
          const codingSchemeRefText = $('codingSchemeRef').text();
          if (codingSchemeRefText) {
            codingSchemeRefs.add(codingSchemeRefText.toUpperCase());
            unitToCodingSchemeRefMap.set(unit.id, codingSchemeRefText.toUpperCase());
          }
        } catch (error) {
          this.logger.error(`--- Fehler beim Verarbeiten der Datei ${testFile.filename}: ${error.message}`);
        }
      }
      const codingSchemeFiles = await this.fileUploadRepository.find({
        where: { file_id: In([...codingSchemeRefs]) },
        select: ['file_id', 'data', 'filename']
      });

      const fileIdToCodingSchemeMap = new Map();
      codingSchemeFiles.forEach(file => {
        try {
          const scheme = new Autocoder.CodingScheme(JSON.parse(JSON.stringify(file.data)));
          fileIdToCodingSchemeMap.set(file.file_id, scheme);
        } catch (error) {
          this.logger.error(`--- Fehler beim Verarbeiten des Kodierschemas ${file.filename}: ${error.message}`);
        }
      });

      const allCodedResponses = [];

      for (const unit of units) {
        const responses = unitToResponsesMap.get(unit.id) || [];
        if (responses.length === 0) continue;

        statistics.totalResponses += responses.length;

        let scheme = new Autocoder.CodingScheme({});
        const codingSchemeRef = unitToCodingSchemeRefMap.get(unit.id);
        if (codingSchemeRef) {
          scheme = fileIdToCodingSchemeMap.get(codingSchemeRef) || scheme;
        }

        const codedResponses = responses.map(response => {
          const codedResult = scheme.code([{
            id: response.variableid,
            value: response.value,
            status: response.status as ResponseStatusType
          }]);

          const codedStatus = codedResult[0]?.status;
          if (!statistics.statusCounts[codedStatus]) {
            statistics.statusCounts[codedStatus] = 0;
          }
          statistics.statusCounts[codedStatus] += 1;

          return {
            ...response, // Enthält die ursprüngliche 'id' und andere Felder der Response
            code: codedResult[0]?.code,
            codedstatus: codedStatus,
            score: codedResult[0]?.score
          };
        });

        allCodedResponses.push(...codedResponses);
      }
      if (allCodedResponses.length > 0) {
        try {
          const batchSize = 10000;
          const batches = [];
          for (let i = 0; i < allCodedResponses.length; i += batchSize) {
            batches.push(allCodedResponses.slice(i, i + batchSize));
          }

          this.logger.log(`Starte die Aktualisierung von ${allCodedResponses.length} Responses in ${batches.length} Batches (concurrent).`);

          const updateBatchPromises = batches.map(async (batch, index) => {
            this.logger.log(`Starte Aktualisierung für Batch #${index + 1} (Größe: ${batch.length}).`);
            const individualUpdatePromises = batch.map(codedResponse => this.responseRepository.update(
              codedResponse.id,
              {
                code: codedResponse.code,
                codedstatus: codedResponse.codedstatus,
                score: codedResponse.score
              }
            )
            );
            try {
              await Promise.all(individualUpdatePromises);
              this.logger.log(`Batch #${index + 1} (Größe: ${batch.length}) erfolgreich aktualisiert.`);
            } catch (error) {
              this.logger.error(`Fehler beim Aktualisieren von Batch #${index + 1} (Größe: ${batch.length}):`, error.message);
              throw error;
            }
          });

          await Promise.all(updateBatchPromises);

          this.logger.log(`${allCodedResponses.length} Responses wurden erfolgreich aktualisiert.`);
        } catch (error) {
          this.logger.error('Fehler beim Aktualisieren der Responses:', error.message);
        }
      }

      return statistics;
    } catch (error) {
      this.logger.error('Fehler beim Verarbeiten der Personen:', error);
      return statistics;
    }
  }

  async getManualTestPersons(workspace_id: number, personIds?: string): Promise<unknown> {
    this.logger.log(
      `Fetching responses for workspace_id = ${workspace_id} ${
        personIds ? `and personIds = ${personIds}` : ''
      }.`
    );

    try {
      const persons = await this.personsRepository.find({
        where: { workspace_id: workspace_id }
      });

      if (!persons.length) {
        this.logger.log(`No persons found for workspace_id = ${workspace_id}.`);
        return [];
      }

      const filteredPersons = personIds ?
        persons.filter(person => personIds.split(',').includes(String(person.id))) :
        persons;

      if (!filteredPersons.length) {
        this.logger.log(`No persons match the personIds in workspace_id = ${workspace_id}.`);
        return [];
      }

      const personIdsArray = filteredPersons.map(person => person.id);

      const booklets = await this.bookletRepository.find({
        where: { personid: In(personIdsArray) },
        select: ['id']
      });

      const bookletIds = booklets.map(booklet => booklet.id);

      if (!bookletIds.length) {
        this.logger.log(
          `No booklets found for persons = [${personIdsArray.join(', ')}] in workspace_id = ${workspace_id}.`
        );
        return [];
      }

      const units = await this.unitRepository.find({
        where: { bookletid: In(bookletIds) },
        select: ['id', 'name']
      });

      const unitIdToNameMap = new Map(units.map(unit => [unit.id, unit.name]));
      const unitIds = Array.from(unitIdToNameMap.keys());

      if (!unitIds.length) {
        this.logger.log(
          `No units found for booklets = [${bookletIds.join(', ')}] in workspace_id = ${workspace_id}.`
        );
        return [];
      }

      const responses = await this.responseRepository.find({
        where: {
          unitid: In(unitIds),
          codedstatus: In(['CODING_INCOMPLETE', 'INTENDED_INCOMPLETE', 'CODE_SELECTION_PENDING'])
        }
      });

      const enrichedResponses = responses.map(response => ({
        ...response,
        unitname: unitIdToNameMap.get(response.unitid) || 'Unknown Unit'
      }));

      this.logger.log(
        `Fetched ${responses.length} responses for the given criteria in workspace_id = ${workspace_id}.`
      );

      return enrichedResponses;
    } catch (error) {
      this.logger.error(`Failed to fetch responses: ${error.message}`, error.stack);
      throw new Error('Could not retrieve responses. Please check the database connection or query.');
    }
  }

  async getCodingList(workspace_id: number, authToken: string, serverUrl?: string, options?: { page: number; limit: number }): Promise<[{
    unit_key: string;
    unit_alias: string;
    login_name: string;
    login_code: string;
    booklet_id: string;
    variable_id: string;
    variable_page: string;
    variable_anchor: string;
    url: string;
  }[], number]> {
    try {
      const server = serverUrl;

      const voudFiles = await this.fileUploadRepository.find({
        where: {
          workspace_id: workspace_id,
          file_type: 'Resource',
          filename: Like('%.voud')
        }
      });

      this.logger.log(`Found ${voudFiles.length} VOUD files for workspace ${workspace_id}`);

      const voudFileMap = new Map<string, FileUpload>();
      voudFiles.forEach(file => {
        voudFileMap.set(file.file_id, file);
      });

      if (options) {
        const { page, limit } = options;
        const MAX_LIMIT = 500;
        const validPage = Math.max(1, page);
        const validLimit = Math.min(Math.max(1, limit), MAX_LIMIT);
        const queryBuilder = this.responseRepository.createQueryBuilder('response')
          .leftJoinAndSelect('response.unit', 'unit')
          .leftJoinAndSelect('unit.booklet', 'booklet')
          .leftJoinAndSelect('booklet.person', 'person')
          .leftJoinAndSelect('booklet.bookletinfo', 'bookletinfo')
          .where('response.codedStatus = :status', { status: 'CODING_INCOMPLETE' })
          .andWhere('person.workspace_id = :workspace_id', { workspace_id })
          .skip((validPage - 1) * validLimit)
          .take(validLimit)
          .orderBy('response.id', 'ASC');

        const [responses, total] = await queryBuilder.getManyAndCount();

        const result = await Promise.all(responses.map(async response => {
          const unit = response.unit;
          const booklet = unit?.booklet;
          const person = booklet?.person;
          const bookletInfo = booklet?.bookletinfo;
          const loginName = person?.login || '';
          const loginCode = person?.code || '';
          const loginGroup = person?.group || '';
          const bookletId = bookletInfo?.name || '';
          const unitKey = unit?.name || '';
          const unitAlias = unit?.alias || '';
          let variablePage = '0';

          const voudFile = voudFileMap.get(`${unitKey}.VOUD`);
          if (voudFile) {
            try {
              const respDefinition = {
                definition: voudFile.data
              };
              const transformResult = prepareDefinition(respDefinition);
              const variablePageInfo = transformResult.variablePages.find(
                pageInfo => pageInfo.variable_ref === response.variableid
              );

              if (variablePageInfo) {
                variablePage = variablePageInfo.variable_page.toString();
              }

              this.logger.log(`Processed VOUD file for unit ${unitKey}, variable ${response.variableid}, page ${variablePage}`);
            } catch (error) {
              this.logger.error(`Error processing VOUD file for unit ${unitKey}: ${error.message}`);
            }
          } else {
            this.logger.warn(`VOUD file not found for unit ${unitKey}`);
          }

          const url = `${server}/#/replay/${loginGroup}@${loginCode}@${bookletId}/${unitKey}/${variablePage}?auth=${authToken}`;

          return {
            unit_key: unitKey,
            unit_alias: unitAlias,
            login_name: loginName,
            login_code: loginCode,
            booklet_id: bookletId,
            variable_id: response.variableid || '',
            variable_page: variablePage,
            variable_anchor: response.variableid || '',
            url
          };
        }));

        const sortedResult = result.sort((a, b) => {
          const unitKeyComparison = a.unit_key.localeCompare(b.unit_key);
          if (unitKeyComparison !== 0) {
            return unitKeyComparison;
          }
          // If unit_key is the same, sort by variable_id
          return a.variable_id.localeCompare(b.variable_id);
        });

        this.logger.log(`Found ${sortedResult.length} coding items (page ${validPage}, limit ${validLimit}, total ${total})`);
        return [sortedResult, total];
      }

      const queryBuilder = this.responseRepository.createQueryBuilder('response')
        .leftJoinAndSelect('response.unit', 'unit')
        .leftJoinAndSelect('unit.booklet', 'booklet')
        .leftJoinAndSelect('booklet.person', 'person')
        .leftJoinAndSelect('booklet.bookletinfo', 'bookletinfo')
        .where('response.codedStatus = :status', { status: 'CODING_INCOMPLETE' })
        .andWhere('person.workspace_id = :workspace_id', { workspace_id })
        .orderBy('response.id', 'ASC');

      const responses = await queryBuilder.getMany();

      const result = await Promise.all(responses.map(async response => {
        const unit = response.unit;
        const booklet = unit?.booklet;
        const person = booklet?.person;
        const bookletInfo = booklet?.bookletinfo;
        const loginName = person?.login || '';
        const loginCode = person?.code || '';
        const loginGroup = person?.group || '';
        const bookletId = bookletInfo?.name || '';
        const unitKey = unit?.name || '';
        const unitAlias = unit?.alias || '';
        let variablePage = '0';
        const voudFile = voudFileMap.get(`${unitKey}.VOUD`);

        if (voudFile) {
          try {
            const respDefinition = {
              definition: voudFile.data
            };
            const transformResult = prepareDefinition(respDefinition);

            const variablePageInfo = transformResult.variablePages.find(
              pageInfo => pageInfo.variable_ref === response.variableid
            );

            if (variablePageInfo) {
              variablePage = variablePageInfo.variable_page.toString();
            }

            this.logger.log(`Processed VOUD file for unit ${unitKey}, variable ${response.variableid}, page ${variablePage}`);
          } catch (error) {
            this.logger.error(`Error processing VOUD file for unit ${unitKey}: ${error.message}`);
          }
        } else {
          this.logger.warn(`VOUD file not found for unit ${unitKey}`);
        }

        const url = `${server}/#/replay/${loginGroup}@${loginCode}@${bookletId}/${unitKey}/${variablePage}?auth=${authToken}`;
        return {
          unit_key: unitKey,
          unit_alias: unitAlias,
          login_name: loginName,
          login_code: loginCode,
          booklet_id: bookletId,
          variable_id: response.variableid || '',
          variable_page: variablePage,
          variable_anchor: response.variableid || '',
          url
        };
      }));

      const sortedResult = result.sort((a, b) => {
        const unitKeyComparison = a.unit_key.localeCompare(b.unit_key);
        if (unitKeyComparison !== 0) {
          return unitKeyComparison;
        }
        // If unit_key is the same, sort by variable_id
        return a.variable_id.localeCompare(b.variable_id);
      });

      this.logger.log(`Found ${sortedResult.length} coding items`);
      return [sortedResult, sortedResult.length];
    } catch (error) {
      this.logger.error(`Error fetching coding list: ${error.message}`);
      return [[], 0];
    }
  }

  async getCodingStatistics(workspace_id: number): Promise<CodingStatistics> {
    this.logger.log(`Getting coding statistics for workspace ${workspace_id}`);

    const statistics: CodingStatistics = {
      totalResponses: 0,
      statusCounts: {}
    };

    try {
      const queryBuilder = this.responseRepository.createQueryBuilder('response')
        .innerJoin('response.unit', 'unit')
        .innerJoin('unit.booklet', 'booklet')
        .innerJoin('booklet.person', 'person')
        .where('response.status = :status', { status: 'VALUE_CHANGED' })
        .andWhere('person.workspace_id = :workspace_id', { workspace_id });

      statistics.totalResponses = await queryBuilder.getCount();

      const statusCountResults = await queryBuilder
        .select('COALESCE(response.codedstatus, null)', 'statusValue')
        .addSelect('COUNT(response.id)', 'count')
        .groupBy('COALESCE(response.codedstatus, null)')
        .getRawMany();

      statusCountResults.forEach(result => {
        statistics.statusCounts[result.statusValue] = parseInt(result.count, 10);
      });

      return statistics;
    } catch (error) {
      this.logger.error(`Error getting coding statistics: ${error.message}`);

      return statistics;
    }
  }

  async getCodingListAsCsv(workspace_id: number): Promise<Buffer> {
    this.logger.log(`Generating CSV export for workspace ${workspace_id}`);
    const [items] = await this.getCodingList(workspace_id, '', '');

    if (!items || items.length === 0) {
      this.logger.warn('No coding list items found for CSV export');
      return Buffer.from('No data available');
    }

    const csvStream = fastCsv.format({ headers: true });
    const chunks: Buffer[] = [];

    return new Promise<Buffer>((resolve, reject) => {
      csvStream.on('data', chunk => {
        chunks.push(Buffer.from(chunk));
      });

      csvStream.on('end', () => {
        const csvBuffer = Buffer.concat(chunks);
        this.logger.log(`CSV export generated successfully with ${items.length} items`);
        resolve(csvBuffer);
      });

      csvStream.on('error', error => {
        this.logger.error(`Error generating CSV export: ${error.message}`);
        reject(error);
      });

      items.forEach(item => {
        csvStream.write({
          unit_key: item.unit_key,
          unit_alias: item.unit_alias,
          login_name: item.login_name,
          login_code: item.login_code,
          booklet_id: item.booklet_id,
          variable_id: item.variable_id,
          variable_page: item.variable_page,
          variable_anchor: item.variable_anchor
        });
      });

      csvStream.end();
    });
  }

  async getCodingListAsExcel(workspace_id: number): Promise<Buffer> {
    this.logger.log(`Generating Excel export for workspace ${workspace_id}`);
    const csvData = await this.getCodingListAsCsv(workspace_id);
    return csvData;
  }
}
