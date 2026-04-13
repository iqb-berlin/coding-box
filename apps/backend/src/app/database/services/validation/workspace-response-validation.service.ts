import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { parseStringPromise } from 'xml2js';
import * as cheerio from 'cheerio';

import FileUpload from '../../entities/file_upload.entity';
import { ResponseEntity } from '../../entities/response.entity';
import { Unit } from '../../entities/unit.entity';
import Persons from '../../entities/persons.entity';
import { Booklet } from '../../entities/booklet.entity';
import Workspace from '../../entities/workspace.entity';
import { WorkspaceSettingsDto } from '../../../../../../../api-dto/workspaces/workspace-settings-dto';

import { InvalidVariableDto } from '../../../../../../../api-dto/files/variable-validation.dto';
import {
  DuplicateResponseDto,
  DuplicateResponsesResultDto
} from '../../../../../../../api-dto/files/duplicate-response.dto';
import { statusNumberToString } from '../../utils/response-status-converter';

@Injectable()
export class WorkspaceResponseValidationService {
  private readonly logger = new Logger(WorkspaceResponseValidationService.name);

  constructor(
    @InjectRepository(ResponseEntity)
    private responseRepository: Repository<ResponseEntity>,
    @InjectRepository(Unit)
    private unitRepository: Repository<Unit>,
    @InjectRepository(Persons)
    private personsRepository: Repository<Persons>,
    @InjectRepository(Booklet)
    private bookletRepository: Repository<Booklet>,
    @InjectRepository(FileUpload)
    private filesRepository: Repository<FileUpload>,
    @InjectRepository(Workspace)
    private workspaceRepository: Repository<Workspace> = {
      findOne: async () => null
    } as unknown as Repository<Workspace>
  ) {}

  private static normalizeExclusionKey(value: string | null | undefined): string {
    return String(value || '').trim().toUpperCase();
  }

  private static normalizeUnitKey(value: string | null | undefined): string {
    return WorkspaceResponseValidationService
      .normalizeExclusionKey(value)
      .replace(/\.XML$/i, '');
  }

  private async resolveExclusionsForValidation(workspaceId: number): Promise<{
    globalIgnoredUnits: string[];
    ignoredBooklets: string[];
    testletIgnoredUnits: { bookletId: string; unitId: string }[];
  }> {
    const workspace = await this.workspaceRepository.findOne({
      where: { id: workspaceId }
    });
    const settings = (workspace?.settings || {}) as WorkspaceSettingsDto;

    const globalIgnoredUnits = (settings.ignoredUnits || []).map(
      item => WorkspaceResponseValidationService.normalizeUnitKey(item)
    );
    const ignoredBooklets = (settings.ignoredBooklets || []).map(
      item => WorkspaceResponseValidationService.normalizeExclusionKey(item)
    );
    const testletIgnoredUnits: { bookletId: string; unitId: string }[] = [];

    if ((settings.ignoredTestlets || []).length === 0) {
      return { globalIgnoredUnits, ignoredBooklets, testletIgnoredUnits };
    }

    const ignoredTestlets = settings.ignoredTestlets || [];
    const bookletsToParse = Array.from(
      new Set(
        ignoredTestlets.map(item => WorkspaceResponseValidationService.normalizeExclusionKey(item.bookletId))
      )
    );

    const bookletFiles = await this.filesRepository.find({
      where: {
        workspace_id: workspaceId,
        file_type: 'Booklet'
      }
    });

    for (const bookletFile of bookletFiles) {
      const bookletId = WorkspaceResponseValidationService
        .normalizeExclusionKey(bookletFile.file_id);
      if (!bookletId || !bookletsToParse.includes(bookletId)) {
        continue;
      }
      try {
        const $ = cheerio.load(bookletFile.data, { xmlMode: true });
        const testletsToIgnore = ignoredTestlets
          .filter(item => WorkspaceResponseValidationService.normalizeExclusionKey(item.bookletId) === bookletId)
          .map(item => WorkspaceResponseValidationService.normalizeExclusionKey(item.testletId));

        $('Unit, unit').each((_, element) => {
          const unitIdRaw = $(element).attr('id');
          const unitId =
            WorkspaceResponseValidationService.normalizeUnitKey(unitIdRaw);
          if (!unitId) {
            return;
          }

          let current = $(element).parent();
          while (
            current.length &&
            String(current[0].tagName || '').toLowerCase() === 'testlet'
          ) {
            const testletId = WorkspaceResponseValidationService
              .normalizeExclusionKey(current.attr('id'));
            if (testletId && testletsToIgnore.includes(testletId)) {
              testletIgnoredUnits.push({ bookletId, unitId });
              break;
            }
            current = current.parent();
          }
        });
      } catch (e) {
        /* empty */
      }
    }

    return { globalIgnoredUnits, ignoredBooklets, testletIgnoredUnits };
  }

  async validateVariables(
    workspaceId: number,
    page: number = 1,
    limit: number = 10,
    onProgress?: (progress: number) => void
  ): Promise<{
      data: InvalidVariableDto[];
      total: number;
      page: number;
      limit: number;
    }> {
    if (!workspaceId) {
      this.logger.error('Workspace ID is required');
      return {
        data: [],
        total: 0,
        page,
        limit
      };
    }

    if (onProgress) onProgress(15);

    const unitFiles = await this.filesRepository.find({
      where: { workspace_id: workspaceId, file_type: 'Unit' }
    });
    const unitVariables = new Map<
    string,
    {
      aliases: Set<string>;
      ids: Set<string>;
      noValueAliases: Set<string>;
      noValueIds: Set<string>;
    }
    >();
    for (const unitFile of unitFiles) {
      try {
        const xmlContent = unitFile.data.toString();
        const parsedXml = await parseStringPromise(xmlContent, {
          explicitArray: false
        });
        if (
          parsedXml.Unit &&
          parsedXml.Unit.Metadata &&
          parsedXml.Unit.Metadata.Id
        ) {
          const unitName = parsedXml.Unit.Metadata.Id;
          const variables = {
            aliases: new Set<string>(),
            ids: new Set<string>(),
            noValueAliases: new Set<string>(),
            noValueIds: new Set<string>()
          };
          if (
            parsedXml.Unit.BaseVariables &&
            parsedXml.Unit.BaseVariables.Variable
          ) {
            const baseVariables = Array.isArray(
              parsedXml.Unit.BaseVariables.Variable
            ) ?
              parsedXml.Unit.BaseVariables.Variable :
              [parsedXml.Unit.BaseVariables.Variable];
            for (const variable of baseVariables) {
              const isNoValue = variable.$?.type === 'no-value';
              if (variable.$?.alias) {
                variables.aliases.add(variable.$.alias);
                if (isNoValue) variables.noValueAliases.add(variable.$.alias);
              }
              if (variable.$?.id) {
                variables.ids.add(variable.$.id);
                if (isNoValue) variables.noValueIds.add(variable.$.id);
              }
            }
          }
          if (
            parsedXml.Unit.DerivedVariables &&
            parsedXml.Unit.DerivedVariables.Variable
          ) {
            const derivedVariables = Array.isArray(
              parsedXml.Unit.DerivedVariables.Variable
            ) ?
              parsedXml.Unit.DerivedVariables.Variable :
              [parsedXml.Unit.DerivedVariables.Variable];
            for (const variable of derivedVariables) {
              const isNoValue = variable.$?.type === 'no-value';
              if (variable.$?.alias) {
                variables.aliases.add(variable.$.alias);
                if (isNoValue) variables.noValueAliases.add(variable.$.alias);
              }
              if (variable.$?.id) {
                variables.ids.add(variable.$.id);
                if (isNoValue) variables.noValueIds.add(variable.$.id);
              }
            }
          }
          unitVariables.set(unitName, variables);
        }
      } catch (e) {
        /* empty */
      }
    }

    if (onProgress) onProgress(25);

    const invalidVariables: InvalidVariableDto[] = [];

    const persons = await this.personsRepository.find({
      where: { workspace_id: workspaceId, consider: true }
    });

    if (persons.length === 0) {
      this.logger.warn(`No persons found for workspace ${workspaceId}`);
      return {
        data: [],
        total: 0,
        page,
        limit
      };
    }

    if (onProgress) onProgress(35);

    const personIds = persons.map(person => person.id);

    if (personIds.length === 0) {
      this.logger.warn(`No person IDs found for workspace ${workspaceId}`);
      return {
        data: [],
        total: 0,
        page,
        limit
      };
    }

    const batchSize = 1000;
    let allUnits: Unit[] = [];

    for (let i = 0; i < personIds.length; i += batchSize) {
      const personIdsBatch = personIds.slice(i, i + batchSize);

      const unitsBatch = await this.unitRepository
        .createQueryBuilder('unit')
        .innerJoin('unit.booklet', 'booklet')
        .where('booklet.personid IN (:...personIdsBatch)', { personIdsBatch })
        .getMany();

      allUnits = [...allUnits, ...unitsBatch];
    }

    if (onProgress) onProgress(45);

    if (allUnits.length === 0) {
      this.logger.warn(
        `No units found for persons in workspace ${workspaceId}`
      );
      return {
        data: [],
        total: 0,
        page,
        limit
      };
    }

    const exclusions = await this.resolveExclusionsForValidation(workspaceId);
    const ignoredUnits = new Set(
      (exclusions.globalIgnoredUnits || []).map(
        WorkspaceResponseValidationService.normalizeUnitKey
      )
    );
    const ignoredBooklets = new Set(
      (exclusions.ignoredBooklets || []).map(
        WorkspaceResponseValidationService.normalizeExclusionKey
      )
    );
    const testletIgnoredUnits = new Set(
      (exclusions.testletIgnoredUnits || []).map(
        t => `${WorkspaceResponseValidationService.normalizeExclusionKey(t.bookletId)}|${WorkspaceResponseValidationService.normalizeUnitKey(t.unitId)}`
      )
    );

    const hasBookletBasedExclusions =
      ignoredBooklets.size > 0 || testletIgnoredUnits.size > 0;
    const bookletIds = Array.from(
      new Set(
        allUnits
          .map(unit => unit.bookletid)
          .filter((id): id is number => typeof id === 'number')
      )
    );
    const bookletNameById = new Map<number, string>();

    if (hasBookletBasedExclusions && bookletIds.length > 0) {
      for (let i = 0; i < bookletIds.length; i += batchSize) {
        const bookletIdsBatch = bookletIds.slice(i, i + batchSize);
        const bookletsBatch = await this.bookletRepository.find({
          where: { id: In(bookletIdsBatch) }
        });
        bookletsBatch.forEach(booklet => {
          bookletNameById.set(
            booklet.id,
            WorkspaceResponseValidationService.normalizeExclusionKey(
              booklet.bookletinfo?.name
            )
          );
        });
      }
    }

    allUnits = allUnits.filter(unit => {
      const unitKey = WorkspaceResponseValidationService.normalizeUnitKey(
        unit.name
      );
      if (ignoredUnits.has(unitKey)) {
        return false;
      }
      if (!hasBookletBasedExclusions) {
        return true;
      }
      const bookletKey = bookletNameById.get(unit.bookletid) || '';
      if (bookletKey && ignoredBooklets.has(bookletKey)) {
        return false;
      }
      if (
        bookletKey &&
        testletIgnoredUnits.has(`${bookletKey}|${unitKey}`)
      ) {
        return false;
      }
      return true;
    });

    if (allUnits.length === 0) {
      this.logger.warn(
        `No units found for persons in workspace ${workspaceId} after exclusion filtering`
      );
      return {
        data: [],
        total: 0,
        page,
        limit
      };
    }

    const unitIds = allUnits.map(unit => unit.id);

    if (unitIds.length === 0) {
      this.logger.warn(
        `No unit IDs found for persons in workspace ${workspaceId}`
      );
      return {
        data: [],
        total: 0,
        page,
        limit
      };
    }

    let allResponses: ResponseEntity[] = [];

    for (let i = 0; i < unitIds.length; i += batchSize) {
      const unitIdsBatch = unitIds.slice(i, i + batchSize);

      const responsesBatch = await this.responseRepository.find({
        where: { unitid: In(unitIdsBatch) },
        relations: ['unit']
      });

      allResponses = [...allResponses, ...responsesBatch];
    }

    if (onProgress) onProgress(60);

    if (allResponses.length === 0) {
      this.logger.warn(
        `No responses found for units in workspace ${workspaceId}`
      );
      return {
        data: [],
        total: 0,
        page,
        limit
      };
    }

    const totalResponses = allResponses.length;
    let processedResponses = 0;

    for (const response of allResponses) {
      processedResponses += 1;
      if (processedResponses % 100 === 0 && onProgress) {
        onProgress(60 + Math.floor((processedResponses / totalResponses) * 35));
      }
      const unit = response.unit;
      if (!unit) {
        this.logger.warn(`Response ${response.id} has no associated unit`);
        continue;
      }

      const unitName = unit.name;
      const variableId = response.variableid;

      if (!variableId) {
        this.logger.warn(`Response ${response.id} has no variable ID`);
        continue;
      }

      if (!unitVariables.has(unitName)) {
        invalidVariables.push({
          fileName: `${unitName}`,
          variableId: variableId,
          value: response.value || '',
          responseId: response.id,
          errorReason: 'Unit not found'
        });
        continue;
      }

      const unitVars = unitVariables.get(unitName);

      const isNoValueVariable =
        !!unitVars &&
        (unitVars.noValueAliases.has(variableId) ||
          unitVars.noValueIds.has(variableId));
      if (isNoValueVariable) {
        continue;
      }

      const isDefinedInUnit =
        !!unitVars &&
        (unitVars.aliases.has(variableId) ||
          (!unitVars.aliases.has(variableId) && unitVars.ids.has(variableId)));
      if (!isDefinedInUnit) {
        invalidVariables.push({
          fileName: `${unitName}`,
          variableId: variableId,
          value: response.value || '',
          responseId: response.id,
          errorReason: 'Variable not defined in unit'
        });
      }
    }

    const validPage = Math.max(1, page);
    const validLimit =
      limit === Number.MAX_SAFE_INTEGER ?
        limit :
        Math.min(Math.max(1, limit), 1000);
    const startIndex = (validPage - 1) * validLimit;
    const endIndex = startIndex + validLimit;
    const paginatedData = invalidVariables.slice(startIndex, endIndex);

    return {
      data: paginatedData,
      total: invalidVariables.length,
      page: validPage,
      limit: validLimit
    };
  }

  async validateVariableTypes(
    workspaceId: number,
    page: number = 1,
    limit: number = 10,
    onProgress?: (progress: number) => void
  ): Promise<{
      data: InvalidVariableDto[];
      total: number;
      page: number;
      limit: number;
    }> {
    if (!workspaceId) {
      this.logger.error('Workspace ID is required');
      return {
        data: [],
        total: 0,
        page,
        limit
      };
    }

    if (onProgress) onProgress(10);

    const unitFiles = await this.filesRepository.find({
      where: { workspace_id: workspaceId, file_type: 'Unit' }
    });

    const unitVariableTypes = new Map<
    string,
    Map<string, { type: string; multiple?: boolean; nullable?: boolean }>
    >();

    for (const unitFile of unitFiles) {
      try {
        const xmlContent = unitFile.data.toString();
        const parsedXml = await parseStringPromise(xmlContent, {
          explicitArray: false
        });
        if (
          parsedXml.Unit &&
          parsedXml.Unit.Metadata &&
          parsedXml.Unit.Metadata.Id
        ) {
          const unitName = parsedXml.Unit.Metadata.Id;
          const variableTypes = new Map<
          string,
          { type: string; multiple?: boolean; nullable?: boolean }
          >();

          if (
            parsedXml.Unit.BaseVariables &&
            parsedXml.Unit.BaseVariables.Variable
          ) {
            const baseVariables = Array.isArray(
              parsedXml.Unit.BaseVariables.Variable
            ) ?
              parsedXml.Unit.BaseVariables.Variable :
              [parsedXml.Unit.BaseVariables.Variable];

            for (const variable of baseVariables) {
              if (
                variable.$.alias &&
                variable.$.type &&
                variable.$.type !== 'no-value'
              ) {
                const multiple =
                  variable.$.multiple === 'true' ||
                  variable.$.multiple === true;
                const nullable =
                  variable.$.nullable === 'true' ||
                  variable.$.nullable === true;
                variableTypes.set(variable.$.alias, {
                  type: variable.$.type,
                  multiple: multiple || undefined,
                  nullable: nullable || undefined
                });
              }
            }
          }

          unitVariableTypes.set(unitName, variableTypes);
        }
      } catch (e) {
        /* empty */
      }
    }

    if (onProgress) onProgress(30);

    const invalidVariables: InvalidVariableDto[] = [];

    const persons = await this.personsRepository.find({
      where: { workspace_id: workspaceId, consider: true }
    });

    if (persons.length === 0) {
      this.logger.warn(`No persons found for workspace ${workspaceId}`);
      return {
        data: [],
        total: 0,
        page,
        limit
      };
    }

    if (onProgress) onProgress(40);

    const personIds = persons.map(person => person.id);

    if (personIds.length === 0) {
      this.logger.warn(`No person IDs found for workspace ${workspaceId}`);
      return {
        data: [],
        total: 0,
        page,
        limit
      };
    }

    const batchSize = 1000;
    let allUnits: Unit[] = [];

    for (let i = 0; i < personIds.length; i += batchSize) {
      const personIdsBatch = personIds.slice(i, i + batchSize);

      const unitsBatch = await this.unitRepository
        .createQueryBuilder('unit')
        .innerJoin('unit.booklet', 'booklet')
        .where('booklet.personid IN (:...personIdsBatch)', { personIdsBatch })
        .getMany();

      allUnits = [...allUnits, ...unitsBatch];
    }

    if (onProgress) onProgress(50);

    if (allUnits.length === 0) {
      this.logger.warn(
        `No units found for persons in workspace ${workspaceId}`
      );
      return {
        data: [],
        total: 0,
        page,
        limit
      };
    }

    const unitIds = allUnits.map(unit => unit.id);

    if (unitIds.length === 0) {
      this.logger.warn(
        `No unit IDs found for persons in workspace ${workspaceId}`
      );
      return {
        data: [],
        total: 0,
        page,
        limit
      };
    }

    let allResponses: ResponseEntity[] = [];

    for (let i = 0; i < unitIds.length; i += batchSize) {
      const unitIdsBatch = unitIds.slice(i, i + batchSize);

      const responsesBatch = await this.responseRepository.find({
        where: { unitid: In(unitIdsBatch) },
        relations: ['unit']
      });

      allResponses = [...allResponses, ...responsesBatch];
    }

    if (onProgress) onProgress(65);

    if (allResponses.length === 0) {
      this.logger.warn(
        `No responses found for units in workspace ${workspaceId}`
      );
      return {
        data: [],
        total: 0,
        page,
        limit
      };
    }

    const totalResponses = allResponses.length;
    let processedResponses = 0;

    for (const response of allResponses) {
      processedResponses += 1;
      if (processedResponses % 100 === 0 && onProgress) {
        onProgress(65 + Math.floor((processedResponses / totalResponses) * 30));
      }
      const unit = response.unit;
      if (!unit) {
        this.logger.warn(`Response ${response.id} has no associated unit`);
        continue;
      }

      const unitName = unit.name;
      const variableId = response.variableid;

      if (!variableId) {
        this.logger.warn(`Response ${response.id} has no variable ID`);
        continue;
      }

      const value = response.value || '';

      if (!unitVariableTypes.has(unitName)) {
        continue;
      }

      const variableTypes = unitVariableTypes.get(unitName);
      if (!variableTypes || !variableTypes.has(variableId)) {
        continue;
      }

      const variableInfo = variableTypes.get(variableId);
      const expectedType = variableInfo.type;
      const isMultiple = variableInfo.multiple === true;
      const isNullable = variableInfo.nullable !== false;

      if (isMultiple) {
        try {
          const parsedValue = JSON.parse(value);
          if (!Array.isArray(parsedValue)) {
            invalidVariables.push({
              fileName: `${unitName}`,
              variableId: variableId,
              value: value,
              responseId: response.id,
              expectedType: `${expectedType} (array)`,
              errorReason:
                'Variable has multiple=true but value is not an array'
            });
            continue;
          }

          const invalidElement = parsedValue.find(
            element => !this.isValidValueForType(String(element), expectedType)
          );
          if (invalidElement !== undefined) {
            invalidVariables.push({
              fileName: `${unitName}`,
              variableId: variableId,
              value: value,
              responseId: response.id,
              expectedType: `${expectedType} (array)`,
              errorReason: `Array element "${invalidElement}" does not match expected type: ${expectedType}`
            });
          }
          continue;
        } catch (e) {
          invalidVariables.push({
            fileName: `${unitName}`,
            variableId: variableId,
            value: value,
            responseId: response.id,
            expectedType: `${expectedType} (array)`,
            errorReason:
              'Variable has multiple=true but value is not a valid JSON array'
          });
          continue;
        }
      }

      if (!isNullable && (!value || value.trim() === '')) {
        invalidVariables.push({
          fileName: `${unitName}`,
          variableId: variableId,
          value: value,
          responseId: response.id,
          expectedType: expectedType,
          errorReason: 'Variable has nullable=false but value is null or empty'
        });
        continue;
      }

      if (!this.isValidValueForType(value, expectedType)) {
        invalidVariables.push({
          fileName: `${unitName}`,
          variableId: variableId,
          value: value,
          responseId: response.id,
          expectedType: expectedType,
          errorReason: `Value does not match expected type: ${expectedType}`
        });
      }
    }

    const validPage = Math.max(1, page);
    const validLimit =
      limit === Number.MAX_SAFE_INTEGER ?
        limit :
        Math.min(Math.max(1, limit), 1000);
    const startIndex = (validPage - 1) * validLimit;
    const endIndex = startIndex + validLimit;
    const paginatedData = invalidVariables.slice(startIndex, endIndex);

    return {
      data: paginatedData,
      total: invalidVariables.length,
      page: validPage,
      limit: validLimit
    };
  }

  async validateDuplicateResponses(
    workspaceId: number,
    page: number = 1,
    limit: number = 10,
    onProgress?: (progress: number) => void
  ): Promise<DuplicateResponsesResultDto> {
    if (!workspaceId) {
      this.logger.error(
        'Workspace ID is required for validateDuplicateResponses'
      );
      return {
        data: [],
        total: 0,
        page,
        limit
      };
    }

    if (onProgress) onProgress(10);

    const persons = await this.personsRepository.find({
      where: { workspace_id: workspaceId, consider: true }
    });

    if (persons.length === 0) {
      this.logger.warn(`No persons found for workspace ${workspaceId}`);
      return {
        data: [],
        total: 0,
        page,
        limit
      };
    }

    if (onProgress) onProgress(20);

    const personIds = persons.map(person => person.id);
    const personMap = new Map(persons.map(person => [person.id, person]));

    const booklets = await this.bookletRepository.find({
      where: { personid: In(personIds) },
      relations: ['bookletinfo']
    });

    if (booklets.length === 0) {
      this.logger.warn(
        `No booklets found for persons in workspace ${workspaceId}`
      );
      return {
        data: [],
        total: 0,
        page,
        limit
      };
    }

    if (onProgress) onProgress(35);

    const bookletMap = new Map(
      booklets.map(booklet => [booklet.id, booklet])
    );

    const batchSize = 1000;
    let allUnits: Unit[] = [];
    const bookletIds = booklets.map(booklet => booklet.id);

    for (let i = 0; i < bookletIds.length; i += batchSize) {
      const bookletIdsBatch = bookletIds.slice(i, i + batchSize);
      const unitsBatch = await this.unitRepository.find({
        where: { bookletid: In(bookletIdsBatch) }
      });
      allUnits = [...allUnits, ...unitsBatch];
    }

    if (onProgress) onProgress(50);

    if (allUnits.length === 0) {
      this.logger.warn(
        `No units found for booklets in workspace ${workspaceId}`
      );
      return {
        data: [],
        total: 0,
        page,
        limit
      };
    }

    const unitIds = allUnits.map(unit => unit.id);
    const unitMap = new Map(allUnits.map(unit => [unit.id, unit]));

    let allResponses: ResponseEntity[] = [];
    for (let i = 0; i < unitIds.length; i += batchSize) {
      const unitIdsBatch = unitIds.slice(i, i + batchSize);
      const responsesBatch = await this.responseRepository.find({
        where: { unitid: In(unitIdsBatch) }
      });
      allResponses = [...allResponses, ...responsesBatch];
    }

    if (onProgress) onProgress(70);

    if (allResponses.length === 0) {
      this.logger.warn(
        `No responses found for units in workspace ${workspaceId}`
      );
      return {
        data: [],
        total: 0,
        page,
        limit
      };
    }

    const totalResponses = allResponses.length;
    let processedResponses = 0;
    const responseGroups = new Map<string, ResponseEntity[]>();
    for (const response of allResponses) {
      processedResponses += 1;
      if (processedResponses % 100 === 0 && onProgress) {
        onProgress(70 + Math.floor((processedResponses / totalResponses) * 25));
      }
      const unit = unitMap.get(response.unitid);
      if (!unit) continue;
      const booklet = bookletMap.get(unit.bookletid);
      if (!booklet) continue;
      const person = personMap.get(booklet.personid);
      if (!person) continue;

      const key = `${unit.name}|${response.variableid}|${response.subform || ''}|${person.login}|${person.code || ''}|${person.group || ''}`;
      if (!responseGroups.has(key)) {
        responseGroups.set(key, []);
      }
      responseGroups.get(key)?.push(response);
    }

    const duplicateResponses: Array<
    DuplicateResponseDto & { subform: string }
    > = [];
    for (const [, responses] of responseGroups.entries()) {
      if (responses.length > 1) {
        const firstResponse = responses[0];
        const unit = unitMap.get(firstResponse.unitid);

        if (!unit) {
          this.logger.warn(`Unit not found for response ${firstResponse.id}`);
          continue;
        }

        const booklet = bookletMap.get(unit.bookletid);
        if (!booklet) {
          this.logger.warn(`Booklet not found for unit ${unit.id}`);
          continue;
        }

        const person = personMap.get(booklet.personid);
        if (!person) {
          this.logger.warn(`Person not found for booklet ${booklet.id}`);
          continue;
        }

        const bookletName = booklet.bookletinfo?.name || 'Unknown';

        duplicateResponses.push({
          unitName: unit.name,
          unitId: unit.id,
          variableId: firstResponse.variableid,
          subform: firstResponse.subform || '',
          bookletName,
          testTakerLogin: person.login,
          testTakerCode: person.code,
          testTakerGroup: person.group,
          duplicates: responses.map(response => ({
            responseId: response.id,
            value: response.value || '',
            status: statusNumberToString(response.status) || 'UNSET'
          }))
        });
      }
    }

    duplicateResponses.sort((a, b) => {
      if (a.unitName !== b.unitName) {
        return a.unitName.localeCompare(b.unitName);
      }
      return a.variableId.localeCompare(b.variableId);
    });

    const validPage = Math.max(1, page);
    const validLimit =
      limit === Number.MAX_SAFE_INTEGER ?
        limit :
        Math.min(Math.max(1, limit), 1000);
    const startIndex = (validPage - 1) * validLimit;
    const endIndex = startIndex + validLimit;
    const paginatedData = duplicateResponses.slice(startIndex, endIndex);

    return {
      data: paginatedData,
      total: duplicateResponses.length,
      page: validPage,
      limit: validLimit
    };
  }

  async validateResponseStatus(
    workspaceId: number,
    page: number = 1,
    limit: number = 10,
    onProgress?: (progress: number) => void
  ): Promise<{
      data: InvalidVariableDto[];
      total: number;
      page: number;
      limit: number;
    }> {
    if (!workspaceId) {
      this.logger.error('Workspace ID is required');
      return {
        data: [],
        total: 0,
        page,
        limit
      };
    }

    if (onProgress) onProgress(10);

    const validStatusValues = [
      'VALUE_CHANGED',
      'NOT_REACHED',
      'DISPLAYED',
      'UNSET',
      'PARTLY_DISPLAYED',
      'CODING_COMPLETE'
    ];

    const persons = await this.personsRepository.find({
      where: { workspace_id: workspaceId, consider: true }
    });

    if (persons.length === 0) {
      this.logger.warn(`No persons found for workspace ${workspaceId}`);
      return {
        data: [],
        total: 0,
        page,
        limit
      };
    }

    if (onProgress) onProgress(20);

    const personIds = persons.map(person => person.id);

    if (personIds.length === 0) {
      this.logger.warn(`No person IDs found for workspace ${workspaceId}`);
      return {
        data: [],
        total: 0,
        page,
        limit
      };
    }

    const batchSize = 1000;
    let allUnits: Unit[] = [];

    for (let i = 0; i < personIds.length; i += batchSize) {
      const personIdsBatch = personIds.slice(i, i + batchSize);

      const unitsBatch = await this.unitRepository
        .createQueryBuilder('unit')
        .innerJoin('unit.booklet', 'booklet')
        .where('booklet.personid IN (:...personIdsBatch)', { personIdsBatch })
        .getMany();

      allUnits = [...allUnits, ...unitsBatch];
    }

    if (onProgress) onProgress(35);

    if (allUnits.length === 0) {
      this.logger.warn(
        `No units found for persons in workspace ${workspaceId}`
      );
      return {
        data: [],
        total: 0,
        page,
        limit
      };
    }

    const unitIds = allUnits.map(unit => unit.id);

    if (unitIds.length === 0) {
      this.logger.warn(
        `No unit IDs found for persons in workspace ${workspaceId}`
      );
      return {
        data: [],
        total: 0,
        page,
        limit
      };
    }

    let allResponses: ResponseEntity[] = [];

    for (let i = 0; i < unitIds.length; i += batchSize) {
      const unitIdsBatch = unitIds.slice(i, i + batchSize);

      const responsesBatch = await this.responseRepository.find({
        where: { unitid: In(unitIdsBatch) },
        relations: ['unit']
      });

      allResponses = [...allResponses, ...responsesBatch];
    }

    if (onProgress) onProgress(60);

    if (allResponses.length === 0) {
      this.logger.warn(
        `No responses found for units in workspace ${workspaceId}`
      );
      return {
        data: [],
        total: 0,
        page,
        limit
      };
    }

    const totalResponses = allResponses.length;
    let processedResponses = 0;
    const invalidVariables: InvalidVariableDto[] = [];

    for (const response of allResponses) {
      processedResponses += 1;
      if (processedResponses % 100 === 0 && onProgress) {
        onProgress(60 + Math.floor((processedResponses / totalResponses) * 40));
      }
      const unit = response.unit;
      if (!unit) {
        this.logger.warn(`Response ${response.id} has no associated unit`);
        continue;
      }

      const unitName = unit.name;
      const variableId = response.variableid;

      if (!variableId) {
        this.logger.warn(`Response ${response.id} has no variable ID`);
        continue;
      }

      const status = statusNumberToString(response.status);

      if (!status || !validStatusValues.includes(status)) {
        invalidVariables.push({
          fileName: `${unitName}`,
          variableId: variableId,
          value: response.value || '',
          responseId: response.id,
          errorReason: `Invalid response status: ${status}. Valid values are: ${validStatusValues.join(', ')}`
        });
      }
    }

    const validPage = Math.max(1, page);
    const validLimit =
      limit === Number.MAX_SAFE_INTEGER ?
        limit :
        Math.min(Math.max(1, limit), 1000);
    const startIndex = (validPage - 1) * validLimit;
    const endIndex = startIndex + validLimit;
    const paginatedData = invalidVariables.slice(startIndex, endIndex);

    return {
      data: paginatedData,
      total: invalidVariables.length,
      page: validPage,
      limit: validLimit
    };
  }

  async deleteInvalidResponses(
    workspaceId: number,
    responseIds: number[]
  ): Promise<number> {
    try {
      if (!workspaceId) {
        this.logger.error('Workspace ID is required');
        return 0;
      }

      if (!responseIds || responseIds.length === 0) {
        this.logger.warn('No response IDs provided for deletion');
        return 0;
      }

      this.logger.log(
        `Deleting invalid responses for workspace ${workspaceId}: ${responseIds.join(', ')}`
      );

      const persons = await this.personsRepository.find({
        where: { workspace_id: workspaceId }
      });

      if (persons.length === 0) {
        this.logger.warn(`No persons found for workspace ${workspaceId}`);
        return 0;
      }

      const personIds = persons.map(person => person.id);

      if (personIds.length === 0) {
        this.logger.warn(`No person IDs found for workspace ${workspaceId}`);
        return 0;
      }

      const batchSize = 1000;
      let allUnitIds: number[] = [];

      for (let i = 0; i < personIds.length; i += batchSize) {
        const personIdsBatch = personIds.slice(i, i + batchSize);

        const unitsBatch = await this.unitRepository
          .createQueryBuilder('unit')
          .select('unit.id')
          .innerJoin('unit.booklet', 'booklet')
          .where('booklet.personid IN (:...personIdsBatch)', { personIdsBatch })
          .getRawMany();

        allUnitIds = [...allUnitIds, ...unitsBatch.map(u => u.unit_id)];
      }

      if (allUnitIds.length === 0) {
        this.logger.warn(
          `No units found for persons in workspace ${workspaceId}`
        );
        return 0;
      }

      let totalDeleted = 0;
      const unitIdSet = new Set(allUnitIds);

      for (let i = 0; i < responseIds.length; i += batchSize) {
        const responseIdsBatch = responseIds.slice(i, i + batchSize);

        // Filter responseIds to only include those belonging to units in this workspace
        const validResponseIds: number[] = [];

        // We need to check which responses actually belong to the units we found
        const responsesToCheck = await this.responseRepository.find({
          where: { id: In(responseIdsBatch) },
          select: ['id', 'unitid']
        });

        for (const resp of responsesToCheck) {
          if (unitIdSet.has(resp.unitid)) {
            validResponseIds.push(resp.id);
          }
        }

        if (validResponseIds.length > 0) {
          const deleteResult = await this.responseRepository.delete({
            id: In(validResponseIds)
          });
          totalDeleted += deleteResult.affected || 0;
        }
      }

      this.logger.log(`Deleted ${totalDeleted} invalid responses`);
      return totalDeleted;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Error deleting invalid responses: ${message}`,
        error instanceof Error ? error.stack : undefined
      );
      throw new Error(`Error deleting invalid responses: ${message}`);
    }
  }

  async deleteAllInvalidResponses(
    workspaceId: number,
    validationType:
    | 'variables'
    | 'variableTypes'
    | 'responseStatus'
    | 'duplicateResponses'
  ): Promise<number> {
    try {
      if (!workspaceId) {
        this.logger.error('Workspace ID is required');
        return 0;
      }

      this.logger.log(
        `Deleting all invalid responses for workspace ${workspaceId} of type ${validationType}`
      );

      if (validationType === 'duplicateResponses') {
        const result = await this.validateDuplicateResponses(
          workspaceId,
          1,
          Number.MAX_SAFE_INTEGER
        );

        if (result.data.length === 0) {
          this.logger.warn(
            `No duplicate responses found for workspace ${workspaceId}`
          );
          return 0;
        }

        const responseIds: number[] = [];
        for (const duplicateResponse of result.data) {
          if (duplicateResponse.duplicates.length > 1) {
            const duplicateIds = duplicateResponse.duplicates
              .slice(1)
              .map(duplicate => duplicate.responseId);
            responseIds.push(...duplicateIds);
          }
        }

        if (responseIds.length === 0) {
          this.logger.warn(
            `No duplicate response IDs found for workspace ${workspaceId}`
          );
          return 0;
        }

        return await this.deleteInvalidResponses(workspaceId, responseIds);
      }

      let invalidResponses: InvalidVariableDto[] = [];

      if (validationType === 'variables') {
        const result = await this.validateVariables(
          workspaceId,
          1,
          Number.MAX_SAFE_INTEGER
        );
        invalidResponses = result.data;
      } else if (validationType === 'variableTypes') {
        const result = await this.validateVariableTypes(
          workspaceId,
          1,
          Number.MAX_SAFE_INTEGER
        );
        invalidResponses = result.data;
      } else if (validationType === 'responseStatus') {
        const result = await this.validateResponseStatus(
          workspaceId,
          1,
          Number.MAX_SAFE_INTEGER
        );
        invalidResponses = result.data;
      }

      if (invalidResponses.length === 0) {
        this.logger.warn(
          `No invalid responses found for workspace ${workspaceId} of type ${validationType}`
        );
        return 0;
      }

      const responseIds = invalidResponses
        .filter(variable => variable.responseId !== undefined)
        .map(variable => variable.responseId as number);

      if (responseIds.length === 0) {
        this.logger.warn(
          `No response IDs found for invalid responses in workspace ${workspaceId} of type ${validationType}`
        );
        return 0;
      }

      return await this.deleteInvalidResponses(workspaceId, responseIds);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Error deleting all invalid responses: ${message}`,
        error instanceof Error ? error.stack : undefined
      );
      throw new Error(`Error deleting all invalid responses: ${message}`);
    }
  }

  private isValidValueForType(value: string, type: string): boolean {
    if (!value) {
      return true;
    }

    switch (type.toLowerCase()) {
      case 'string':
        return true;

      case 'no-value':
        return true;

      case 'integer':
        return /^-?\d+$/.test(value);

      case 'number':
        return !Number.isNaN(Number(value)) && Number.isFinite(Number(value));

      case 'boolean': {
        const lowerValue = value.toLowerCase();
        return ['true', 'false', '0', '1', 'yes', 'no'].includes(lowerValue);
      }

      case 'json':
        try {
          JSON.parse(value);
          return true;
        } catch (e) {
          return false;
        }

      default:
        return true;
    }
  }
}
