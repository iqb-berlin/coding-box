import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Raw, Repository } from 'typeorm';
import { parseStringPromise } from 'xml2js';
import * as cheerio from 'cheerio';

import FileUpload from '../../entities/file_upload.entity';
import { ResponseEntity } from '../../entities/response.entity';
import { Unit } from '../../entities/unit.entity';
import Persons from '../../entities/persons.entity';
import { Booklet } from '../../entities/booklet.entity';
import Workspace from '../../entities/workspace.entity';
import { WorkspaceSettingsDto } from '../../../../../../../api-dto/workspaces/workspace-settings-dto';
import { JournalService, RecordAuditJournalEventInput } from '../shared/journal.service';

import {
  InvalidVariableDto,
  VariableValidationSummaryDto
} from '../../../../../../../api-dto/files/variable-validation.dto';
import {
  DuplicateResponseDto,
  DuplicateResponsesResultDto
} from '../../../../../../../api-dto/files/duplicate-response.dto';
import {
  EXCLUDED_STATUSES,
  statusNumberToString
} from '../../utils/response-status-converter';
import { withWorkspaceTestResultsMutationLock } from '../shared/workspace-test-results-lock.util';
import { InvalidVariablePage } from './invalid-variable-page';

export type ResponseDeletionAuditContext = Pick<RecordAuditJournalEventInput, 'actorUserId' | 'jobId'>;

interface UnitVariableDefinitions {
  aliases: Set<string>;
  ids: Set<string>;
  noValueAliases: Set<string>;
  noValueIds: Set<string>;
}

interface ValidationExclusions {
  globalIgnoredUnits: string[];
  ignoredBooklets: string[];
  testletIgnoredUnits: { bookletId: string; unitId: string }[];
}

const VALIDATION_BATCH_SIZE = 1000;
const DUPLICATE_PERSON_BATCH_SIZE = 64;
type ValidationProgress = (progress: number) => void | Promise<void>;

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

  private static normalizeVariableKey(value: string | null | undefined): string {
    return String(value || '').trim();
  }

  private static createUnitVariableDefinitions(): UnitVariableDefinitions {
    return {
      aliases: new Set<string>(),
      ids: new Set<string>(),
      noValueAliases: new Set<string>(),
      noValueIds: new Set<string>()
    };
  }

  private static asArray<T>(value: T | T[] | undefined): T[] {
    if (!value) {
      return [];
    }
    return Array.isArray(value) ? value : [value];
  }

  private static baseFileName(value: string | null | undefined): string {
    return String(value || '').trim().replace(/\.[^.]+$/u, '');
  }

  private static addVariableDefinition(
    definitions: UnitVariableDefinitions,
    variable: { $?: Record<string, string | boolean | undefined> } | undefined
  ): void {
    const variableAttributes = variable?.$;
    if (!variableAttributes) {
      return;
    }

    const alias = WorkspaceResponseValidationService.normalizeVariableKey(
      typeof variableAttributes.alias === 'string' ?
        variableAttributes.alias :
        undefined
    );
    const id = WorkspaceResponseValidationService.normalizeVariableKey(
      typeof variableAttributes.id === 'string' ?
        variableAttributes.id :
        undefined
    );
    const type =
      typeof variableAttributes.type === 'string' ?
        variableAttributes.type :
        '';
    const isNoValue = type === 'no-value';

    if (alias) {
      definitions.aliases.add(alias);
      if (isNoValue) {
        definitions.noValueAliases.add(alias);
      }
    }
    if (id) {
      definitions.ids.add(id);
      if (isNoValue) {
        definitions.noValueIds.add(id);
      }
    }
  }

  private static mergeUnitVariableDefinitions(
    target: UnitVariableDefinitions,
    source: UnitVariableDefinitions
  ): void {
    source.aliases.forEach(value => target.aliases.add(value));
    source.ids.forEach(value => target.ids.add(value));
    source.noValueAliases.forEach(value => target.noValueAliases.add(value));
    source.noValueIds.forEach(value => target.noValueIds.add(value));
  }

  private static unitFileKeys(
    unitFile: FileUpload,
    metadataId: string | null | undefined
  ): string[] {
    return Array.from(
      new Set(
        [
          metadataId,
          unitFile.file_id,
          WorkspaceResponseValidationService.baseFileName(unitFile.filename)
        ]
          .map(value => WorkspaceResponseValidationService.normalizeUnitKey(value))
          .filter(Boolean)
      )
    );
  }

  private static hasValue(value: string | null | undefined): number {
    return String(value || '').trim() !== '' ? 1 : 0;
  }

  private selectBestDuplicateResponseId(
    duplicates: DuplicateResponseDto['duplicates']
  ): number | null {
    if (!duplicates || duplicates.length === 0) {
      return null;
    }

    const sorted = [...duplicates].sort((a, b) => {
      const valuePriorityDiff =
        WorkspaceResponseValidationService.hasValue(b.value) -
        WorkspaceResponseValidationService.hasValue(a.value);
      if (valuePriorityDiff !== 0) {
        return valuePriorityDiff;
      }

      // Deterministic fallback: keep newest entry by ID.
      return b.responseId - a.responseId;
    });

    return sorted[0]?.responseId ?? null;
  }

  private async resolveExclusionsForValidation(workspaceId: number): Promise<ValidationExclusions> {
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

  private async filterUnitsByExclusions(
    units: Unit[],
    exclusions: ValidationExclusions,
    booklets?: Booklet[]
  ): Promise<Unit[]> {
    if (units.length === 0) {
      return units;
    }

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
    const bookletNameById = new Map<number, string>();

    if (hasBookletBasedExclusions) {
      const validationBooklets = booklets ?? await this.loadValidationBooklets(units);
      for (const booklet of validationBooklets) {
        bookletNameById.set(
          booklet.id,
          WorkspaceResponseValidationService.normalizeExclusionKey(booklet.bookletinfo?.name)
        );
      }
    }

    return units.filter(unit => {
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
  }

  private async loadValidationBooklets(units: Unit[]): Promise<Booklet[]> {
    const bookletIds = [...new Set(units.map(unit => unit.bookletid))];
    const booklets: Booklet[] = [];
    for (let i = 0; i < bookletIds.length; i += VALIDATION_BATCH_SIZE) {
      const batch = await this.bookletRepository.find({
        where: { id: In(bookletIds.slice(i, i + VALIDATION_BATCH_SIZE)) },
        select: { id: true, bookletinfo: { id: true, name: true } },
        relations: { bookletinfo: true },
        loadEagerRelations: false
      });
      booklets.push(...batch);
    }
    return booklets;
  }

  private async loadValidationUnits(
    workspaceId: number,
    onProgress?: ValidationProgress
  ): Promise<Map<number, Unit>> {
    const persons = await this.personsRepository.find({
      where: { workspace_id: workspaceId, consider: true },
      select: { id: true },
      order: { id: 'ASC' }
    });
    const personIds = persons.map(person => person.id);
    const units: Unit[] = [];

    for (let i = 0; i < personIds.length; i += VALIDATION_BATCH_SIZE) {
      const batch = await this.unitRepository
        .createQueryBuilder('unit')
        .select(['unit.id', 'unit.name', 'unit.bookletid'])
        .innerJoin('unit.booklet', 'booklet')
        .where('booklet.personid IN (:...personIdsBatch)', {
          personIdsBatch: personIds.slice(i, i + VALIDATION_BATCH_SIZE)
        })
        .orderBy('unit.id', 'ASC')
        .getMany();
      units.push(...batch);
    }

    const exclusions = await this.resolveExclusionsForValidation(workspaceId);
    const includedUnits = await this.filterUnitsByExclusions(units, exclusions);
    await onProgress?.(60);
    return new Map(includedUnits.map(unit => [unit.id, unit]));
  }

  private async* readValidationResponses(
    unitIds: number[],
    onProgress?: ValidationProgress
  ): AsyncGenerator<ResponseEntity> {
    for (let i = 0; i < unitIds.length; i += VALIDATION_BATCH_SIZE) {
      const batch = unitIds.slice(i, i + VALIDATION_BATCH_SIZE);
      let cursor: ResponseEntity | undefined;
      for (;;) {
        // Lead with unitid so PostgreSQL can page through the unit index.
        const afterUnitId = cursor?.unitid ?? 0;
        const unitid = In(batch.filter(id => id >= afterUnitId));
        const where = cursor ? {
          unitid,
          id: Raw(column => `("unitid", ${column}) > (:unitId, :responseId)`, {
            unitId: cursor.unitid,
            responseId: cursor.id
          })
        } : { unitid };
        const responses = await this.responseRepository.find({
          select: {
            id: true, unitid: true, variableid: true, value: true, status: true, subform: true
          },
          where,
          order: { unitid: 'ASC', id: 'ASC' },
          take: VALIDATION_BATCH_SIZE
        });
        for (const response of responses) {
          yield response;
        }
        if (responses.length < VALIDATION_BATCH_SIZE) break;
        cursor = responses[responses.length - 1];
      }
      const fraction = Math.min(i + VALIDATION_BATCH_SIZE, unitIds.length) / unitIds.length;
      await onProgress?.(60 + Math.floor(fraction * 35));
    }
  }

  async validateVariables(
    workspaceId: number,
    page: number = 1,
    limit: number = 10,
    onProgress?: ValidationProgress
  ): Promise<{
    data: InvalidVariableDto[];
    total: number;
    page: number;
    limit: number;
    summary: VariableValidationSummaryDto;
  }> {
    const emptySummary: VariableValidationSummaryDto = {
      unitFileNotFound: 0,
      variableNotDefinedInUnit: 0
    };

    if (!workspaceId) {
      this.logger.error('Workspace ID is required');
      return {
        data: [],
        total: 0,
        page,
        limit,
        summary: emptySummary
      };
    }

    await onProgress?.(15);

    const unitFiles = await this.filesRepository.find({
      where: { workspace_id: workspaceId, file_type: 'Unit' }
    });
    const unitVariables = new Map<string, UnitVariableDefinitions>();
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
          const variables =
            WorkspaceResponseValidationService
              .createUnitVariableDefinitions();
          if (
            parsedXml.Unit.BaseVariables &&
            parsedXml.Unit.BaseVariables.Variable
          ) {
            const baseVariables =
              WorkspaceResponseValidationService.asArray(
                parsedXml.Unit.BaseVariables.Variable
              );
            for (const variable of baseVariables) {
              WorkspaceResponseValidationService.addVariableDefinition(
                variables,
                variable
              );
            }
          }
          if (
            parsedXml.Unit.DerivedVariables &&
            parsedXml.Unit.DerivedVariables.Variable
          ) {
            const derivedVariables =
              WorkspaceResponseValidationService.asArray(
                parsedXml.Unit.DerivedVariables.Variable
              );
            for (const variable of derivedVariables) {
              WorkspaceResponseValidationService.addVariableDefinition(
                variables,
                variable
              );
            }
          }
          WorkspaceResponseValidationService
            .unitFileKeys(unitFile, unitName)
            .forEach(unitKey => {
              const existingDefinitions =
                unitVariables.get(unitKey) ||
                WorkspaceResponseValidationService
                  .createUnitVariableDefinitions();
              WorkspaceResponseValidationService
                .mergeUnitVariableDefinitions(
                  existingDefinitions,
                  variables
                );
              unitVariables.set(unitKey, existingDefinitions);
            });
        }
      } catch (e) {
        /* empty */
      }
    }

    await onProgress?.(25);

    const units = await this.loadValidationUnits(workspaceId, onProgress);
    const invalidVariables = new InvalidVariablePage(page, limit);
    let hasResponses = false;
    const summary: VariableValidationSummaryDto = {
      unitFileNotFound: 0,
      variableNotDefinedInUnit: 0
    };

    for await (const response of this.readValidationResponses([...units.keys()], onProgress)) {
      hasResponses = true;
      const unit = units.get(response.unitid);
      if (!unit) {
        this.logger.warn(`Response ${response.id} has no associated unit`);
        continue;
      }

      const unitName = unit.name;
      const unitKey = WorkspaceResponseValidationService.normalizeUnitKey(
        unitName
      );
      const variableId =
        WorkspaceResponseValidationService.normalizeVariableKey(
          response.variableid
        );

      if (!variableId) {
        this.logger.warn(`Response ${response.id} has no variable ID`);
        continue;
      }

      const value = response.value || '';

      if (!unitVariables.has(unitKey)) {
        summary.unitFileNotFound += 1;
        invalidVariables.add({
          fileName: `${unitName}`,
          variableId: variableId,
          value,
          responseId: response.id,
          errorReason: 'Unit file not found for response unit',
          errorCode: 'UNIT_FILE_NOT_FOUND'
        });
        continue;
      }

      const unitVars = unitVariables.get(unitKey);

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
        // Legacy imports may contain stale UI variable placeholders without data.
        if (this.isMissingVariableValue(value, false)) {
          continue;
        }

        summary.variableNotDefinedInUnit += 1;
        invalidVariables.add({
          fileName: `${unitName}`,
          variableId: variableId,
          value,
          responseId: response.id,
          errorReason: 'Variable not defined in unit',
          errorCode: 'VARIABLE_NOT_DEFINED_IN_UNIT'
        });
      }
    }

    return {
      data: invalidVariables.data,
      total: invalidVariables.total,
      page: hasResponses ? invalidVariables.page : page,
      limit: hasResponses ? invalidVariables.limit : limit,
      summary
    };
  }

  async validateVariableTypes(
    workspaceId: number,
    page: number = 1,
    limit: number = 10,
    onProgress?: ValidationProgress
  ): Promise<{
    data: InvalidVariableDto[];
    total: number;
    page: number;
    limit: number;
  }> {
    if (!workspaceId) {
      this.logger.error('Workspace ID is required');
      return {
        data: [], total: 0, page, limit
      };
    }

    await onProgress?.(10);

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
                  !(variable.$.nullable === 'false' ||
                    variable.$.nullable === false);
                variableTypes.set(variable.$.alias, {
                  type: variable.$.type,
                  multiple: multiple || undefined,
                  nullable: nullable
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

    await onProgress?.(30);

    const units = await this.loadValidationUnits(workspaceId, onProgress);
    const invalidVariables = new InvalidVariablePage(page, limit);
    let hasResponses = false;

    for await (const response of this.readValidationResponses([...units.keys()], onProgress)) {
      hasResponses = true;
      const unit = units.get(response.unitid);
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
      if (!variableInfo) continue;
      const expectedType = variableInfo.type;
      const isMultiple = variableInfo.multiple === true;
      const isNullable = variableInfo.nullable !== false;
      const isMissingValue = this.isMissingVariableValue(value, isMultiple);
      const isProcessStatus = EXCLUDED_STATUSES.includes(response.status);

      if (isMissingValue) {
        if (!isNullable && !isProcessStatus) {
          invalidVariables.add({
            fileName: `${unitName}`,
            variableId: variableId,
            value: value,
            responseId: response.id,
            expectedType: expectedType,
            errorReason: 'Variable has nullable=false but value is null or empty'
          });
        }
        continue;
      }

      if (isMultiple) {
        try {
          const parsedValue = JSON.parse(value);
          if (!Array.isArray(parsedValue)) {
            invalidVariables.add({
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
            invalidVariables.add({
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
          invalidVariables.add({
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

      if (!this.isValidValueForType(value, expectedType)) {
        invalidVariables.add({
          fileName: `${unitName}`,
          variableId: variableId,
          value: value,
          responseId: response.id,
          expectedType: expectedType,
          errorReason: `Value does not match expected type: ${expectedType}`
        });
      }
    }

    return {
      data: invalidVariables.data,
      total: invalidVariables.total,
      page: hasResponses ? invalidVariables.page : page,
      limit: hasResponses ? invalidVariables.limit : limit
    };
  }

  async validateDuplicateResponses(
    workspaceId: number,
    page: number = 1,
    limit: number = 10,
    onProgress?: ValidationProgress
  ): Promise<DuplicateResponsesResultDto> {
    if (!workspaceId) {
      this.logger.error(
        'Workspace ID is required for validateDuplicateResponses'
      );
      return {
        data: [], total: 0, page, limit
      };
    }

    await onProgress?.(10);

    const persons = await this.personsRepository.find({
      where: { workspace_id: workspaceId, consider: true },
      select: {
        id: true, login: true, code: true, group: true
      },
      order: { id: 'ASC' }
    });

    await onProgress?.(20);
    if (persons.length === 0) {
      return {
        data: [], total: 0, page, limit
      };
    }

    const exclusions = await this.resolveExclusionsForValidation(workspaceId);
    const duplicateResponses: DuplicateResponseDto[] = [];
    const validPage = Math.max(1, page);
    const validLimit = limit === Number.MAX_SAFE_INTEGER ?
      limit : Math.min(Math.max(1, limit), 1000);
    const startIndex = (validPage - 1) * validLimit;
    const endIndex = startIndex + validLimit;
    const compare = (a: DuplicateResponseDto, b: DuplicateResponseDto): number => {
      if (a.unitName !== b.unitName) {
        return a.unitName.localeCompare(b.unitName);
      }
      return a.variableId.localeCompare(b.variableId);
    };
    let hasResponses = false;
    let total = 0;
    // The workspace's person identity is unique. Keep all booklets of each
    // person together so matching responses in different units can still be found.
    for (let i = 0; i < persons.length; i += DUPLICATE_PERSON_BATCH_SIZE) {
      const batch = persons.slice(i, i + DUPLICATE_PERSON_BATCH_SIZE);
      const result = await this.findDuplicateResponseBatch(batch, exclusions);
      hasResponses ||= result.hasResponses;
      total += result.duplicates.length;
      for (const duplicate of result.duplicates) {
        duplicateResponses.push(duplicate);
      }
      if (duplicateResponses.length > endIndex) {
        duplicateResponses.sort(compare);
        duplicateResponses.splice(endIndex);
      }
      const fraction = Math.min(i + DUPLICATE_PERSON_BATCH_SIZE, persons.length) / persons.length;
      await onProgress?.(20 + Math.floor(fraction * 75));
    }

    if (!hasResponses) {
      return {
        data: [], total: 0, page, limit
      };
    }

    duplicateResponses.sort(compare);
    return {
      data: duplicateResponses.slice(startIndex, endIndex),
      total,
      page: validPage,
      limit: validLimit
    };
  }

  private async findDuplicateResponseBatch(
    persons: Persons[],
    exclusions: ValidationExclusions
  ): Promise<{ duplicates: DuplicateResponseDto[]; hasResponses: boolean }> {
    const personsById = new Map(persons.map(person => [person.id, person]));
    const booklets = await this.bookletRepository.find({
      where: { personid: In([...personsById.keys()]) },
      select: { id: true, personid: true, bookletinfo: { id: true, name: true } },
      relations: { bookletinfo: true },
      loadEagerRelations: false
    });
    const bookletsById = new Map(booklets.map(booklet => [booklet.id, booklet]));
    const units: Unit[] = [];
    const bookletIds = [...bookletsById.keys()];
    for (let i = 0; i < bookletIds.length; i += VALIDATION_BATCH_SIZE) {
      const batch = await this.unitRepository.find({
        where: { bookletid: In(bookletIds.slice(i, i + VALIDATION_BATCH_SIZE)) },
        select: { id: true, name: true, bookletid: true },
        order: { id: 'ASC' }
      });
      units.push(...batch);
    }

    const includedUnits = await this.filterUnitsByExclusions(units, exclusions, booklets);
    const unitsById = new Map(includedUnits.map(unit => [unit.id, unit]));
    const groups = new Map<string, ResponseEntity[]>();
    let hasResponses = false;
    for await (const response of this.readValidationResponses([...unitsById.keys()])) {
      hasResponses = true;
      const unit = unitsById.get(response.unitid);
      const booklet = unit && bookletsById.get(unit.bookletid);
      if (!unit || !booklet) continue;
      const key = JSON.stringify([booklet.personid, unit.name, response.variableid, response.subform || '']);
      const group = groups.get(key);
      if (group) {
        group.push(response);
      } else {
        groups.set(key, [response]);
      }
    }

    const duplicates: DuplicateResponseDto[] = [];
    for (const responses of groups.values()) {
      if (responses.length < 2) continue;
      const [first] = responses;
      const unit = unitsById.get(first.unitid);
      const booklet = unit && bookletsById.get(unit.bookletid);
      const person = booklet && personsById.get(booklet.personid);
      if (!unit || !booklet || !person) continue;
      duplicates.push({
        unitName: unit.name,
        unitId: unit.id,
        variableId: first.variableid,
        subform: first.subform || '',
        bookletName: booklet.bookletinfo?.name || 'Unknown',
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
    return { duplicates, hasResponses };
  }

  async validateResponseStatus(
    workspaceId: number,
    page: number = 1,
    limit: number = 10,
    onProgress?: ValidationProgress
  ): Promise<{
    data: InvalidVariableDto[];
    total: number;
    page: number;
    limit: number;
  }> {
    if (!workspaceId) {
      this.logger.error('Workspace ID is required');
      return {
        data: [], total: 0, page, limit
      };
    }

    await onProgress?.(10);

    const validStatusValues = [
      'VALUE_CHANGED',
      'NOT_REACHED',
      'DISPLAYED',
      'UNSET',
      'PARTLY_DISPLAYED',
      'CODING_COMPLETE'
    ];

    const units = await this.loadValidationUnits(workspaceId, onProgress);
    const invalidVariables = new InvalidVariablePage(page, limit);
    let hasResponses = false;

    for await (const response of this.readValidationResponses([...units.keys()], onProgress)) {
      hasResponses = true;
      const unit = units.get(response.unitid);
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
        invalidVariables.add({
          fileName: `${unitName}`,
          variableId: variableId,
          value: response.value || '',
          responseId: response.id,
          errorReason: `Invalid response status: ${status}. Valid values are: ${validStatusValues.join(', ')}`
        });
      }
    }

    return {
      data: invalidVariables.data,
      total: invalidVariables.total,
      page: hasResponses ? invalidVariables.page : page,
      limit: hasResponses ? invalidVariables.limit : limit
    };
  }

  async deleteInvalidResponses(
    workspaceId: number,
    responseIds: number[],
    audit: ResponseDeletionAuditContext = {}
  ): Promise<number> {
    if (!workspaceId || !responseIds || responseIds.length === 0) {
      return this.deleteInvalidResponsesUnlocked(workspaceId, responseIds, audit);
    }

    return withWorkspaceTestResultsMutationLock(
      this.responseRepository.manager.connection,
      workspaceId,
      () => this.deleteInvalidResponsesUnlocked(workspaceId, responseIds, audit)
    );
  }

  private async deleteInvalidResponsesUnlocked(
    workspaceId: number,
    responseIds: number[],
    audit: ResponseDeletionAuditContext = {}
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
          const deleteResult = await this.responseRepository.manager.transaction(async manager => {
            const result = await manager.getRepository(ResponseEntity).delete({
              id: In(validResponseIds), unitid: In(allUnitIds)
            });
            const actorType = audit.actorUserId ? 'user' : 'system';
            await JournalService.recordEventInTransaction(manager, {
              workspaceId,
              ...audit,
              actorType: audit.jobId ? 'job' : actorType,
              eventType: 'TEST_RESULT_RESPONSES_DELETED',
              entityType: 'responses',
              result: 'success',
              summary: 'Invalid response deletion batch committed',
              details: { source: 'validation', deletedTargetCount: result.affected || 0, batchNumber: Math.floor(i / batchSize) + 1 }
            });
            return result;
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
    | 'duplicateResponses',
    audit: ResponseDeletionAuditContext = {}
  ): Promise<number> {
    if (!workspaceId) {
      return this.deleteAllInvalidResponsesUnlocked(
        workspaceId,
        validationType,
        audit
      );
    }

    return withWorkspaceTestResultsMutationLock(
      this.responseRepository.manager.connection,
      workspaceId,
      () => this.deleteAllInvalidResponsesUnlocked(workspaceId, validationType, audit)
    );
  }

  private async deleteAllInvalidResponsesUnlocked(
    workspaceId: number,
    validationType:
    | 'variables'
    | 'variableTypes'
    | 'responseStatus'
    | 'duplicateResponses',
    audit: ResponseDeletionAuditContext = {}
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
            const selectedResponseId = this.selectBestDuplicateResponseId(
              duplicateResponse.duplicates
            );
            if (!selectedResponseId) {
              continue;
            }
            const duplicateIds = duplicateResponse.duplicates
              .filter(duplicate => duplicate.responseId !== selectedResponseId)
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

        return await this.deleteInvalidResponsesUnlocked(workspaceId, responseIds, audit);
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

      return await this.deleteInvalidResponsesUnlocked(workspaceId, responseIds, audit);
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

  private isMissingVariableValue(value: string, isMultiple: boolean): boolean {
    const trimmedValue = value.trim();
    if (!trimmedValue) {
      return true;
    }
    if (trimmedValue.toLowerCase() === 'null') {
      return true;
    }
    // Legacy imports can store missing non-multiple responses as JSON empty array.
    if (!isMultiple && trimmedValue === '[]') {
      return true;
    }
    return false;
  }
}
