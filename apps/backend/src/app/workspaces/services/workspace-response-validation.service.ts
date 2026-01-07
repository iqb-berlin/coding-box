import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { parseStringPromise } from 'xml2js';
import * as cheerio from 'cheerio';

import {
  FileUpload, ResponseEntity, Unit, Persons
} from '../../common';
import { Booklet } from '../entities/booklet.entity';

import { InvalidVariableDto } from '../../../../../../api-dto/files/variable-validation.dto';
import { DuplicateResponseDto, DuplicateResponsesResultDto } from '../../../../../../api-dto/files/duplicate-response.dto';
import { statusNumberToString } from '../utils/response-status-converter';

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
    private filesRepository: Repository<FileUpload>
  ) {}

  async validateVariables(
    workspaceId: number,
    page: number = 1,
    limit: number = 10
  ): Promise<{ data: InvalidVariableDto[]; total: number; page: number; limit: number }> {
    if (!workspaceId) {
      this.logger.error('Workspace ID is required');
      return {
        data: [],
        total: 0,
        page,
        limit
      };
    }

    const unitFiles = await this.filesRepository.find({
      where: { workspace_id: workspaceId, file_type: 'Unit' }
    });
    const unitVariables = new Map<string, { aliases: Set<string>; ids: Set<string> }>();
    for (const unitFile of unitFiles) {
      try {
        const xmlContent = unitFile.data.toString();
        const parsedXml = await parseStringPromise(xmlContent, { explicitArray: false });
        if (parsedXml.Unit && parsedXml.Unit.Metadata && parsedXml.Unit.Metadata.Id) {
          const unitName = parsedXml.Unit.Metadata.Id;
          const variables = { aliases: new Set<string>(), ids: new Set<string>() };
          if (parsedXml.Unit.BaseVariables && parsedXml.Unit.BaseVariables.Variable) {
            const baseVariables = Array.isArray(parsedXml.Unit.BaseVariables.Variable) ?
              parsedXml.Unit.BaseVariables.Variable :
              [parsedXml.Unit.BaseVariables.Variable];
            for (const variable of baseVariables) {
              if (variable.$?.alias) {
                variables.aliases.add(variable.$.alias);
              }
              if (variable.$?.id) {
                variables.ids.add(variable.$.id);
              }
            }
          }
          unitVariables.set(unitName, variables);
        }
      } catch (e) { /* empty */ }
    }

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

      const unitsBatch = await this.unitRepository.createQueryBuilder('unit')
        .innerJoin('unit.booklet', 'booklet')
        .where('booklet.personid IN (:...personIdsBatch)', { personIdsBatch })
        .getMany();

      allUnits = [...allUnits, ...unitsBatch];
    }

    if (allUnits.length === 0) {
      this.logger.warn(`No units found for persons in workspace ${workspaceId}`);
      return {
        data: [],
        total: 0,
        page,
        limit
      };
    }

    const unitIds = allUnits.map(unit => unit.id);

    if (unitIds.length === 0) {
      this.logger.warn(`No unit IDs found for persons in workspace ${workspaceId}`);
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

    if (allResponses.length === 0) {
      this.logger.warn(`No responses found for units in workspace ${workspaceId}`);
      return {
        data: [],
        total: 0,
        page,
        limit
      };
    }

    for (const response of allResponses) {
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
      const isDefinedInUnit = !!unitVars && (
        unitVars.aliases.has(variableId) ||
        (!unitVars.aliases.has(variableId) && unitVars.ids.has(variableId))
      );
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
    const validLimit = limit === Number.MAX_SAFE_INTEGER ? limit : Math.min(Math.max(1, limit), 1000);
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
    limit: number = 10
  ): Promise<{ data: InvalidVariableDto[]; total: number; page: number; limit: number }> {
    if (!workspaceId) {
      this.logger.error('Workspace ID is required');
      return {
        data: [],
        total: 0,
        page,
        limit
      };
    }

    const unitFiles = await this.filesRepository.find({
      where: { workspace_id: workspaceId, file_type: 'Unit' }
    });

    const unitVariableTypes = new Map<string, Map<string, { type: string; multiple?: boolean; nullable?: boolean }>>();

    for (const unitFile of unitFiles) {
      try {
        const xmlContent = unitFile.data.toString();
        const parsedXml = await parseStringPromise(xmlContent, { explicitArray: false });
        if (parsedXml.Unit && parsedXml.Unit.Metadata && parsedXml.Unit.Metadata.Id) {
          const unitName = parsedXml.Unit.Metadata.Id;
          const variableTypes = new Map<string, { type: string; multiple?: boolean; nullable?: boolean }>();

          if (parsedXml.Unit.BaseVariables && parsedXml.Unit.BaseVariables.Variable) {
            const baseVariables = Array.isArray(parsedXml.Unit.BaseVariables.Variable) ?
              parsedXml.Unit.BaseVariables.Variable :
              [parsedXml.Unit.BaseVariables.Variable];

            for (const variable of baseVariables) {
              if (variable.$.alias && variable.$.type && variable.$.type !== 'no-value') {
                const multiple = variable.$.multiple === 'true' || variable.$.multiple === true;
                const nullable = variable.$.nullable === 'true' || variable.$.nullable === true;
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
      } catch (e) { /* empty */ }
    }

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

      const unitsBatch = await this.unitRepository.createQueryBuilder('unit')
        .innerJoin('unit.booklet', 'booklet')
        .where('booklet.personid IN (:...personIdsBatch)', { personIdsBatch })
        .getMany();

      allUnits = [...allUnits, ...unitsBatch];
    }

    if (allUnits.length === 0) {
      this.logger.warn(`No units found for persons in workspace ${workspaceId}`);
      return {
        data: [],
        total: 0,
        page,
        limit
      };
    }

    const unitIds = allUnits.map(unit => unit.id);

    if (unitIds.length === 0) {
      this.logger.warn(`No unit IDs found for persons in workspace ${workspaceId}`);
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

    if (allResponses.length === 0) {
      this.logger.warn(`No responses found for units in workspace ${workspaceId}`);
      return {
        data: [],
        total: 0,
        page,
        limit
      };
    }

    for (const response of allResponses) {
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
              errorReason: 'Variable has multiple=true but value is not an array'
            });
            continue;
          }
        } catch (e) {
          invalidVariables.push({
            fileName: `${unitName}`,
            variableId: variableId,
            value: value,
            responseId: response.id,
            expectedType: `${expectedType} (array)`,
            errorReason: 'Variable has multiple=true but value is not a valid JSON array'
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
    const validLimit = limit === Number.MAX_SAFE_INTEGER ? limit : Math.min(Math.max(1, limit), 1000);
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
    limit: number = 10
  ): Promise<DuplicateResponsesResultDto> {
    if (!workspaceId) {
      this.logger.error('Workspace ID is required for validateDuplicateResponses');
      return {
        data: [],
        total: 0,
        page,
        limit
      };
    }

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

    const personIds = persons.map(person => person.id);
    const personMap = new Map(persons.map(person => [person.id, person]));

    const booklets = await this.bookletRepository.find({
      where: { personid: In(personIds) },
      relations: ['bookletinfo']
    });

    if (booklets.length === 0) {
      this.logger.warn(`No booklets found for persons in workspace ${workspaceId}`);
      return {
        data: [],
        total: 0,
        page,
        limit
      };
    }

    const bookletMap = new Map(booklets.map(booklet => [booklet.id, booklet]));

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

    if (allUnits.length === 0) {
      this.logger.warn(`No units found for booklets in workspace ${workspaceId}`);
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

    if (allResponses.length === 0) {
      this.logger.warn(`No responses found for units in workspace ${workspaceId}`);
      return {
        data: [],
        total: 0,
        page,
        limit
      };
    }

    const responseGroups = new Map<string, ResponseEntity[]>();
    for (const response of allResponses) {
      const key = `${response.unitid}_${response.variableid}_${response.subform || ''}`;
      if (!responseGroups.has(key)) {
        responseGroups.set(key, []);
      }
      responseGroups.get(key)?.push(response);
    }

    const duplicateResponses: Array<DuplicateResponseDto & { subform: string }> = [];
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
    const validLimit = limit === Number.MAX_SAFE_INTEGER ? limit : Math.min(Math.max(1, limit), 1000);
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
    limit: number = 10
  ): Promise<{ data: InvalidVariableDto[]; total: number; page: number; limit: number }> {
    if (!workspaceId) {
      this.logger.error('Workspace ID is required');
      return {
        data: [],
        total: 0,
        page,
        limit
      };
    }

    const validStatusValues = ['VALUE_CHANGED', 'NOT_REACHED', 'DISPLAYED', 'UNSET', 'PARTLY_DISPLAYED'];

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

      const unitsBatch = await this.unitRepository.createQueryBuilder('unit')
        .innerJoin('unit.booklet', 'booklet')
        .where('booklet.personid IN (:...personIdsBatch)', { personIdsBatch })
        .getMany();

      allUnits = [...allUnits, ...unitsBatch];
    }

    if (allUnits.length === 0) {
      this.logger.warn(`No units found for persons in workspace ${workspaceId}`);
      return {
        data: [],
        total: 0,
        page,
        limit
      };
    }

    const unitIds = allUnits.map(unit => unit.id);

    if (unitIds.length === 0) {
      this.logger.warn(`No unit IDs found for persons in workspace ${workspaceId}`);
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

    if (allResponses.length === 0) {
      this.logger.warn(`No responses found for units in workspace ${workspaceId}`);
      return {
        data: [],
        total: 0,
        page,
        limit
      };
    }

    const invalidVariables: InvalidVariableDto[] = [];

    for (const response of allResponses) {
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
    const validLimit = limit === Number.MAX_SAFE_INTEGER ? limit : Math.min(Math.max(1, limit), 1000);
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

  async deleteInvalidResponses(workspaceId: number, responseIds: number[]): Promise<number> {
    try {
      if (!workspaceId) {
        this.logger.error('Workspace ID is required');
        return 0;
      }

      if (!responseIds || responseIds.length === 0) {
        this.logger.warn('No response IDs provided for deletion');
        return 0;
      }

      this.logger.log(`Deleting invalid responses for workspace ${workspaceId}: ${responseIds.join(', ')}`);

      const persons = await this.personsRepository.find({
        where: { workspace_id: workspaceId, consider: true }
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
      let allUnits: Unit[] = [];

      for (let i = 0; i < personIds.length; i += batchSize) {
        const personIdsBatch = personIds.slice(i, i + batchSize);

        const unitsBatch = await this.unitRepository.createQueryBuilder('unit')
          .innerJoin('unit.booklet', 'booklet')
          .where('booklet.personid IN (:...personIdsBatch)', { personIdsBatch })
          .getMany();

        allUnits = [...allUnits, ...unitsBatch];
      }

      if (allUnits.length === 0) {
        this.logger.warn(`No units found for persons in workspace ${workspaceId}`);
        return 0;
      }

      const unitIds = allUnits.map(unit => unit.id);

      if (unitIds.length === 0) {
        this.logger.warn(`No unit IDs found for persons in workspace ${workspaceId}`);
        return 0;
      }

      let totalDeleted = 0;

      for (let i = 0; i < responseIds.length; i += batchSize) {
        const responseIdsBatch = responseIds.slice(i, i + batchSize);

        for (let j = 0; j < unitIds.length; j += batchSize) {
          const unitIdsBatch = unitIds.slice(j, j + batchSize);

          const deleteResult = await this.responseRepository.delete({
            id: In(responseIdsBatch),
            unitid: In(unitIdsBatch)
          });

          totalDeleted += deleteResult.affected || 0;
        }
      }

      this.logger.log(`Deleted ${totalDeleted} invalid responses`);
      return totalDeleted;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error deleting invalid responses: ${message}`, error instanceof Error ? error.stack : undefined);
      throw new Error(`Error deleting invalid responses: ${message}`);
    }
  }

  async deleteAllInvalidResponses(
    workspaceId: number,
    validationType: 'variables' | 'variableTypes' | 'responseStatus' | 'duplicateResponses'
  ): Promise<number> {
    try {
      if (!workspaceId) {
        this.logger.error('Workspace ID is required');
        return 0;
      }

      this.logger.log(`Deleting all invalid responses for workspace ${workspaceId} of type ${validationType}`);

      if (validationType === 'duplicateResponses') {
        const result = await this.validateDuplicateResponses(workspaceId, 1, Number.MAX_SAFE_INTEGER);

        if (result.data.length === 0) {
          this.logger.warn(`No duplicate responses found for workspace ${workspaceId}`);
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
          this.logger.warn(`No duplicate response IDs found for workspace ${workspaceId}`);
          return 0;
        }

        return await this.deleteInvalidResponses(workspaceId, responseIds);
      }

      let invalidResponses: InvalidVariableDto[] = [];

      if (validationType === 'variables') {
        const result = await this.validateVariables(workspaceId, 1, Number.MAX_SAFE_INTEGER);
        invalidResponses = result.data;
      } else if (validationType === 'variableTypes') {
        const result = await this.validateVariableTypes(workspaceId, 1, Number.MAX_SAFE_INTEGER);
        invalidResponses = result.data;
      } else if (validationType === 'responseStatus') {
        const result = await this.validateResponseStatus(workspaceId, 1, Number.MAX_SAFE_INTEGER);
        invalidResponses = result.data;
      }

      if (invalidResponses.length === 0) {
        this.logger.warn(`No invalid responses found for workspace ${workspaceId} of type ${validationType}`);
        return 0;
      }

      const responseIds = invalidResponses
        .filter(variable => variable.responseId !== undefined)
        .map(variable => variable.responseId as number);

      if (responseIds.length === 0) {
        this.logger.warn(`No response IDs found for invalid responses in workspace ${workspaceId} of type ${validationType}`);
        return 0;
      }

      return await this.deleteInvalidResponses(workspaceId, responseIds);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error deleting all invalid responses: ${message}`, error instanceof Error ? error.stack : undefined);
      throw new Error(`Error deleting all invalid responses: ${message}`);
    }
  }

  async validateGroupResponses(
    workspaceId: number,
    page: number = 1,
    limit: number = 10
  ): Promise<{
      testTakersFound: boolean;
      groupsWithResponses: { group: string; hasResponse: boolean }[];
      allGroupsHaveResponses: boolean;
      total: number;
      page: number;
      limit: number;
    }> {
    if (!workspaceId) {
      this.logger.error('Workspace ID is required');
      return {
        testTakersFound: false,
        groupsWithResponses: [],
        allGroupsHaveResponses: false,
        total: 0,
        page,
        limit
      };
    }

    const testTakers = await this.filesRepository.find({
      where: {
        workspace_id: workspaceId,
        file_type: In(['TestTakers', 'Testtakers'])
      }
    });

    if (!testTakers || testTakers.length === 0) {
      return {
        testTakersFound: false,
        groupsWithResponses: [],
        allGroupsHaveResponses: false,
        total: 0,
        page,
        limit
      };
    }

    const groupNames = new Set<string>();
    for (const testTaker of testTakers) {
      const xmlDocument = cheerio.load(testTaker.data, { xml: true });
      xmlDocument('Group').each((_, element) => {
        const groupId = xmlDocument(element).attr('id');
        if (groupId) {
          groupNames.add(groupId);
        }
      });
    }

    const groupsWithResponses: { group: string; hasResponse: boolean }[] = [];
    const sortedGroupNames = Array.from(groupNames).sort();

    for (const groupName of sortedGroupNames) {
      const count = await this.responseRepository
        .createQueryBuilder('response')
        .innerJoin('response.unit', 'unit')
        .innerJoin('unit.booklet', 'booklet')
        .innerJoin('booklet.person', 'person')
        .where('person.workspace_id = :workspaceId', { workspaceId })
        .andWhere('person.group = :groupName', { groupName })
        .getCount();

      groupsWithResponses.push({
        group: groupName,
        hasResponse: count > 0
      });
    }

    const allGroupsHaveResponses = groupsWithResponses.every(g => g.hasResponse);

    const validPage = Math.max(1, page);
    const validLimit = limit === Number.MAX_SAFE_INTEGER ? limit : Math.min(Math.max(1, limit), 1000);
    const startIndex = (validPage - 1) * validLimit;
    const endIndex = startIndex + validLimit;
    const paginatedData = groupsWithResponses.slice(startIndex, endIndex);

    return {
      testTakersFound: true,
      groupsWithResponses: paginatedData,
      allGroupsHaveResponses,
      total: groupsWithResponses.length,
      page: validPage,
      limit: validLimit
    };
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
