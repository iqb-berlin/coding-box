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
import { extractVariableLocation } from '../../utils/voud/extractVariableLocation';

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
    const startTime = Date.now();
    const metrics: { [key: string]: number } = {};

    if (!workspace_id || !testPersonIds || testPersonIds.trim() === '') {
      this.logger.warn('Ungültige Eingabeparameter: workspace_id oder testPersonIds fehlen.');
      return { totalResponses: 0, statusCounts: {} };
    }

    const ids = testPersonIds.split(',').filter(id => id.trim() !== '');
    if (ids.length === 0) {
      this.logger.warn('Keine gültigen Personen-IDs angegeben.');
      return { totalResponses: 0, statusCounts: {} };
    }

    this.logger.log(`Verarbeite Personen ${testPersonIds} für Workspace ${workspace_id}`);

    const statistics: CodingStatistics = {
      totalResponses: 0,
      statusCounts: {}
    };

    const queryRunner = this.responseRepository.manager.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction('READ COMMITTED');

    try {
      const personsQueryStart = Date.now();
      const persons = await this.personsRepository.find({
        where: { workspace_id, id: In(ids) },
        select: ['id', 'group', 'login', 'code', 'uploaded_at']
      });
      metrics.personsQuery = Date.now() - personsQueryStart;

      if (!persons || persons.length === 0) {
        this.logger.warn('Keine Personen gefunden mit den angegebenen IDs.');
        await queryRunner.release();
        return statistics;
      }

      const personIds = persons.map(person => person.id);
      const bookletQueryStart = Date.now();
      const booklets = await this.bookletRepository.find({
        where: { personid: In(personIds) },
        select: ['id', 'personid'] // Only select needed fields
      });
      metrics.bookletQuery = Date.now() - bookletQueryStart;

      if (!booklets || booklets.length === 0) {
        this.logger.log('Keine Booklets für die angegebenen Personen gefunden.');
        await queryRunner.release();
        return statistics;
      }

      const bookletIds = booklets.map(booklet => booklet.id);
      const unitQueryStart = Date.now();
      const units = await this.unitRepository.find({
        where: { bookletid: In(bookletIds) },
        select: ['id', 'bookletid', 'name', 'alias'] // Only select needed fields
      });
      metrics.unitQuery = Date.now() - unitQueryStart;

      if (!units || units.length === 0) {
        this.logger.log('Keine Einheiten für die angegebenen Booklets gefunden.');
        await queryRunner.release();
        return statistics;
      }

      const bookletToUnitsMap = new Map();
      const unitIds = new Set<number>();
      const unitAliasesSet = new Set<string>();

      for (const unit of units) {
        if (!bookletToUnitsMap.has(unit.bookletid)) {
          bookletToUnitsMap.set(unit.bookletid, []);
        }
        bookletToUnitsMap.get(unit.bookletid).push(unit);
        unitIds.add(unit.id);
        unitAliasesSet.add(unit.alias.toUpperCase());
      }

      const unitIdsArray = Array.from(unitIds);
      const unitAliasesArray = Array.from(unitAliasesSet);

      const responseQueryStart = Date.now();
      const allResponses = await this.responseRepository.find({
        where: { unitid: In(unitIdsArray), status: In(['VALUE_CHANGED']) },
        select: ['id', 'unitid', 'variableid', 'value', 'status'] // Only select needed fields
      });
      metrics.responseQuery = Date.now() - responseQueryStart;

      if (!allResponses || allResponses.length === 0) {
        this.logger.log('Keine zu kodierenden Antworten gefunden.');
        await queryRunner.release();
        return statistics;
      }

      const unitToResponsesMap = new Map();
      for (const response of allResponses) {
        if (!unitToResponsesMap.has(response.unitid)) {
          unitToResponsesMap.set(response.unitid, []);
        }
        unitToResponsesMap.get(response.unitid).push(response);
      }

      const fileQueryStart = Date.now();
      const testFiles = await this.fileUploadRepository.find({
        where: { workspace_id: workspace_id, file_id: In(unitAliasesArray) },
        select: ['file_id', 'data', 'filename'] // Only select needed fields
      });
      metrics.fileQuery = Date.now() - fileQueryStart;

      const fileIdToTestFileMap = new Map();
      testFiles.forEach(file => {
        fileIdToTestFileMap.set(file.file_id, file);
      });
      const schemeExtractStart = Date.now();
      const codingSchemeRefs = new Set<string>();
      const unitToCodingSchemeRefMap = new Map();
      const batchSize = 50;
      for (let i = 0; i < units.length; i += batchSize) {
        const unitBatch = units.slice(i, i + batchSize);

        for (const unit of unitBatch) {
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
      }
      metrics.schemeExtract = Date.now() - schemeExtractStart;

      const schemeQueryStart = Date.now();
      const codingSchemeFiles = await this.fileUploadRepository.find({
        where: { file_id: In([...codingSchemeRefs]) },
        select: ['file_id', 'data', 'filename']
      });
      metrics.schemeQuery = Date.now() - schemeQueryStart;
      const schemeParsing = Date.now();
      const fileIdToCodingSchemeMap = new Map();
      const emptyScheme = new Autocoder.CodingScheme({});

      codingSchemeFiles.forEach(file => {
        try {
          const data = typeof file.data === 'string' ? JSON.parse(file.data) : file.data;
          const scheme = new Autocoder.CodingScheme(data);
          fileIdToCodingSchemeMap.set(file.file_id, scheme);
        } catch (error) {
          this.logger.error(`--- Fehler beim Verarbeiten des Kodierschemas ${file.filename}: ${error.message}`);
        }
      });
      metrics.schemeParsing = Date.now() - schemeParsing;

      const processingStart = Date.now();

      const allCodedResponses = [];
      const estimatedResponseCount = allResponses.length;
      allCodedResponses.length = estimatedResponseCount;
      let responseIndex = 0;

      for (let i = 0; i < units.length; i += batchSize) {
        const unitBatch = units.slice(i, i + batchSize);

        for (const unit of unitBatch) {
          const responses = unitToResponsesMap.get(unit.id) || [];
          if (responses.length === 0) continue;

          statistics.totalResponses += responses.length;

          const codingSchemeRef = unitToCodingSchemeRefMap.get(unit.id);
          const scheme = codingSchemeRef ?
            (fileIdToCodingSchemeMap.get(codingSchemeRef) || emptyScheme) :
            emptyScheme;

          for (const response of responses) {
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

            allCodedResponses[responseIndex] = {
              id: response.id,
              code: codedResult[0]?.code,
              codedstatus: codedStatus,
              score: codedResult[0]?.score
            };
            responseIndex += 1;
          }
        }
      }

      allCodedResponses.length = responseIndex;
      metrics.processing = Date.now() - processingStart;

      // Update responses in batches with transaction support
      if (allCodedResponses.length > 0) {
        const updateStart = Date.now();
        try {
          const updateBatchSize = 500;
          const batches = [];
          for (let i = 0; i < allCodedResponses.length; i += updateBatchSize) {
            batches.push(allCodedResponses.slice(i, i + updateBatchSize));
          }

          this.logger.log(`Starte die Aktualisierung von ${allCodedResponses.length} Responses in ${batches.length} Batches (sequential).`);

          for (let index = 0; index < batches.length; index++) {
            const batch = batches[index];
            this.logger.log(`Starte Aktualisierung für Batch #${index + 1} (Größe: ${batch.length}).`);

            try {
              if (batch.length > 0) {
                const updatePromises = batch.map(response => queryRunner.manager.update(
                  ResponseEntity,
                  response.id,
                  {
                    code: response.code,
                    codedstatus: response.codedstatus,
                    score: response.score
                  }
                ));

                await Promise.all(updatePromises);
              }

              this.logger.log(`Batch #${index + 1} (Größe: ${batch.length}) erfolgreich aktualisiert.`);
            } catch (error) {
              this.logger.error(`Fehler beim Aktualisieren von Batch #${index + 1} (Größe: ${batch.length}):`, error.message);
              // Rollback transaction on error
              await queryRunner.rollbackTransaction();
              await queryRunner.release();
              throw error;
            }
          }

          // Commit transaction if all updates were successful
          await queryRunner.commitTransaction();
          this.logger.log(`${allCodedResponses.length} Responses wurden erfolgreich aktualisiert.`);
        } catch (error) {
          this.logger.error('Fehler beim Aktualisieren der Responses:', error.message);
          // Ensure transaction is rolled back on error
          try {
            await queryRunner.rollbackTransaction();
          } catch (rollbackError) {
            this.logger.error('Fehler beim Rollback der Transaktion:', rollbackError.message);
          }
        } finally {
          // Always release the query runner
          await queryRunner.release();
        }
        metrics.update = Date.now() - updateStart;
      } else {
        // Release query runner if no updates were performed
        await queryRunner.release();
      }

      // Log performance metrics
      const totalTime = Date.now() - startTime;
      this.logger.log(`Performance metrics for codeTestPersons (total: ${totalTime}ms):
        - Persons query: ${metrics.personsQuery}ms
        - Booklet query: ${metrics.bookletQuery}ms
        - Unit query: ${metrics.unitQuery}ms
        - Response query: ${metrics.responseQuery}ms
        - File query: ${metrics.fileQuery}ms
        - Scheme extraction: ${metrics.schemeExtract}ms
        - Scheme query: ${metrics.schemeQuery}ms
        - Scheme parsing: ${metrics.schemeParsing}ms
        - Response processing: ${metrics.processing}ms
        - Database updates: ${metrics.update || 0}ms`);

      return statistics;
    } catch (error) {
      this.logger.error('Fehler beim Verarbeiten der Personen:', error);

      // Ensure transaction is rolled back on error
      try {
        await queryRunner.rollbackTransaction();
      } catch (rollbackError) {
        this.logger.error('Fehler beim Rollback der Transaktion:', rollbackError.message);
      } finally {
        // Always release the query runner
        await queryRunner.release();
      }

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
        const MAX_LIMIT = 10000000;
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
          .take(MAX_LIMIT) // Set a very high limit to fetch all items
          .orderBy('response.id', 'ASC');

        const [responses, total] = await queryBuilder.getManyAndCount();

        const result = await Promise.all(responses.map(async response => {
          const unit = response.unit;
          const booklet = unit?.booklet;
          const person = booklet?.person;
          const bookletInfo = booklet?.bookletinfo;
          const loginName = person?.login || '';
          const loginCode = person?.code || '';
          // const loginGroup = person.group || '';
          const bookletId = bookletInfo?.name || '';
          const unitKey = unit?.name || '';
          const unitAlias = unit?.alias || '';
          let variablePage = '0';
          const variableAnchor = response.variableid || 0;
          const voudFile = voudFileMap.get(`${unitKey}.VOUD`);
          if (voudFile) {
            try {
              const respDefinition = {
                definition: voudFile.data
              };
              // const transformResult = prepareDefinition(respDefinition);
              const variableLocation = extractVariableLocation([respDefinition]);
              const variablePageInfo = variableLocation[0].variable_pages.find(
                pageInfo => pageInfo.variable_ref === response.variableid
              );
              const variablePageAlwaysVisible = variableLocation[0].variable_pages.find(
                pageInfo => pageInfo.variable_page_always_visible === true
              );

              if (variablePageInfo) {
                if (variablePageAlwaysVisible && variablePageInfo.variable_page_always_visible === true) {
                  variablePage = (variablePageInfo.variable_path.pages - 1).toString();
                }
                variablePage = variablePageInfo?.variable_path?.pages.toString();
              }

              this.logger.log(`Processed VOUD file for unit ${unitKey}, variable ${response.variableid}, page ${variablePage}`);
            } catch (error) {
              this.logger.error(`Error processing VOUD file for unit ${unitKey}: ${error.message}`);
            }
          } else {
            this.logger.warn(`VOUD file not found for unit ${unitKey}`);
          }

          const url = `${server}/#/replay/${loginName}@${loginCode}@${bookletId}/${unitKey}/${variablePage}/${variableAnchor}?auth=${authToken}`;

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
        // const loginGroup = person.group || '';
        const bookletId = bookletInfo?.name || '';
        const unitKey = unit?.name || '';
        const unitAlias = unit?.alias || '';
        let variablePage = '0';
        const variableAnchor = response.variableid || 0;
        const voudFile = voudFileMap.get(`${unitKey}.VOUD`);

        if (voudFile) {
          try {
            const respDefinition = {
              definition: voudFile.data
            };
            // const transformResult = prepareDefinition(respDefinition);
            const variableLocation = extractVariableLocation([respDefinition]);
            const variablePageInfo = variableLocation[0].variable_pages.find(
              pageInfo => pageInfo.variable_ref === response.variableid
            );
            const variablePageAlwaysVisible = variableLocation[0].variable_pages.find(
              pageInfo => pageInfo.variable_page_always_visible === true
            );

            if (variablePageInfo) {
              if (variablePageAlwaysVisible && variablePageInfo.variable_page_always_visible === true) {
                variablePage = (variablePageInfo.variable_path.pages - 1).toString();
              }
              variablePage = variablePageInfo?.variable_path?.pages.toString();
            }

            this.logger.log(`Processed VOUD file for unit ${unitKey}, variable ${response.variableid}, page ${variablePage}`);
          } catch (error) {
            this.logger.error(`Error processing VOUD file for unit ${unitKey}: ${error.message}`);
          }
        } else {
          this.logger.warn(`VOUD file not found for unit ${unitKey}`);
        }

        const url = `${server}/#/replay/${loginName}@${loginCode}@${bookletId}/${unitKey}/${variablePage}/${variableAnchor}?auth=${authToken}`;
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
        const count = parseInt(result.count, 10);
        // Ensure count is a valid number
        statistics.statusCounts[result.statusValue] = Number.isNaN(count) ? 0 : count;
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
    return this.getCodingListAsCsv(workspace_id);
  }
}
