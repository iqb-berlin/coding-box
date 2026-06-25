import {
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, In, Repository } from 'typeorm';
import FileUpload from '../../entities/file_upload.entity';
import {
  JobDefinition,
  JobDefinitionVariable
} from '../../entities/job-definition.entity';
import { VariableBundle } from '../../entities/variable-bundle.entity';
import { MissingsProfilesService } from './missings-profiles.service';
import { CodebookGenerator } from '../../../admin/code-book/codebook-generator.class';
import {
  CodeBookContentSetting,
  UnitPropertiesForCodebook,
  Missing
} from '../../../admin/code-book/codebook.interfaces';

@Injectable()
export class CodebookGenerationService {
  private readonly logger = new Logger(CodebookGenerationService.name);

  constructor(
    @InjectRepository(FileUpload)
    private fileUploadRepository: Repository<FileUpload>,
    @InjectRepository(JobDefinition)
    private jobDefinitionRepository: Repository<JobDefinition>,
    @InjectRepository(VariableBundle)
    private variableBundleRepository: Repository<VariableBundle>,
    private missingsProfilesService: MissingsProfilesService
  ) { }

  async generateCodebook(
    workspaceId: number,
    missingsProfile: number,
    contentOptions: CodeBookContentSetting,
    unitIds: number[]
  ): Promise<Buffer | null> {
    try {
      const normalizedUnitIds = this.normalizeUnitIds(unitIds);
      this.logger.log(
        `Generating codebook for workspace ${workspaceId} with ${normalizedUnitIds.length} units`
      );
      const units = await this.fileUploadRepository.find({
        where: {
          id: In(normalizedUnitIds),
          workspace_id: workspaceId,
          file_type: 'Resource',
          file_id: ILike('%.VOCS')
        }
      });

      if (!units || units.length !== normalizedUnitIds.length) {
        const foundIds = new Set((units || []).map(unit => unit.id));
        const missingIds = normalizedUnitIds.filter(id => !foundIds.has(id));
        this.logger.warn(
          `Codebook units not found in workspace ${workspaceId}: ${missingIds.join(', ')}`
        );
        throw new NotFoundException(
          'Mindestens eine ausgewählte Einheit wurde im Workspace nicht gefunden.'
        );
      }

      const unitsById = new Map(units.map(unit => [unit.id, unit]));
      const orderedUnits = normalizedUnitIds
        .map(id => unitsById.get(id))
        .filter((unit): unit is FileUpload => !!unit);

      const unitProperties: UnitPropertiesForCodebook[] = orderedUnits.map(unit => ({
        id: unit.id,
        key: unit.file_id,
        name: unit.filename.toLowerCase().endsWith('.vocs') ?
          unit.filename.substring(0, unit.filename.length - 5) :
          unit.filename,
        scheme: unit.data || '',
        metadata: this.getCodebookMetadata(unit)
      }));
      const scopedUnitProperties = await this.applyVariableScope(
        workspaceId,
        unitProperties,
        contentOptions
      );
      if (this.hasVariableScope(contentOptions) && scopedUnitProperties.length === 0) {
        throw new BadRequestException(
          'Die ausgewählten Schnellfilter enthalten keine passenden Variablen für die ausgewählten Einheiten.'
        );
      }

      let missings: Missing[] = [];

      if (missingsProfile) {
        const profile =
                    await this.missingsProfilesService.getMissingsProfileDetails(
                      workspaceId,
                      missingsProfile
                    );
        if (profile && profile.missings) {
          try {
            const profileMissings =
                            typeof profile.missings === 'string' ?
                              JSON.parse(profile.missings) :
                              profile.missings;
            if (Array.isArray(profileMissings) && profileMissings.length > 0) {
              missings = profileMissings.map(m => ({
                code: m.code.toString(),
                label: m.label,
                description: m.description
              }));
            }
          } catch (parseError) {
            this.logger.error(
              `Error parsing missings from profile: ${parseError.message}`,
              parseError.stack
            );
          }
        }
      }

      return await CodebookGenerator.generateCodebook(
        scopedUnitProperties,
        contentOptions,
        missings
      );
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error(
        `Error generating codebook for workspace ${workspaceId}: ${error.message}`,
        error.stack
      );
      return null;
    }
  }

  private normalizeUnitIds(unitIds: number[]): number[] {
    if (!Array.isArray(unitIds) || unitIds.length === 0) {
      throw new BadRequestException('Mindestens eine Einheit muss ausgewählt werden.');
    }

    const normalized = unitIds.map(unitId => this.normalizePositiveInteger(unitId));

    return Array.from(new Set(normalized));
  }

  private normalizePositiveInteger(value: unknown): number {
    let normalized: number;
    if (typeof value === 'number') {
      normalized = value;
    } else if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
      normalized = Number(value.trim());
    } else {
      throw new BadRequestException('unitList darf nur positive ganzzahlige IDs enthalten.');
    }

    if (!Number.isSafeInteger(normalized) || normalized < 1) {
      throw new BadRequestException('unitList darf nur positive ganzzahlige IDs enthalten.');
    }
    return normalized;
  }

  private getCodebookMetadata(unit: FileUpload): UnitPropertiesForCodebook['metadata'] {
    const items = unit.structured_data?.metadata?.items;
    return Array.isArray(items) ? { items } : undefined;
  }

  private async applyVariableScope(
    workspaceId: number,
    units: UnitPropertiesForCodebook[],
    contentOptions: CodeBookContentSetting
  ): Promise<UnitPropertiesForCodebook[]> {
    const variableBundleIds =
      this.normalizeVariableBundleScopeIds(contentOptions.variableBundleIds);
    if (
      (contentOptions.jobDefinitionId === undefined ||
        contentOptions.jobDefinitionId === null) &&
      variableBundleIds.length === 0
    ) {
      return units;
    }

    const jobDefinitionAllowedVariablesByUnit = new Map<string, Set<string>>();
    const variableBundleAllowedVariablesByUnit = new Map<string, Set<string>>();
    const bundleIds = new Set<number>(variableBundleIds);
    const jobDefinitionBundleIds = new Set<number>();

    if (
      contentOptions.jobDefinitionId !== undefined &&
      contentOptions.jobDefinitionId !== null
    ) {
      const jobDefinition = await this.jobDefinitionRepository.findOne({
        where: {
          id: contentOptions.jobDefinitionId,
          workspace_id: workspaceId
        }
      });

      if (!jobDefinition) {
        throw new NotFoundException('Die ausgewählte Jobdefinition wurde im Workspace nicht gefunden.');
      }

      (jobDefinition.assigned_variables || [])
        .forEach(variable => this.addAllowedVariable(
          jobDefinitionAllowedVariablesByUnit,
          variable
        ));

      (jobDefinition.assigned_variable_bundles || [])
        .map(bundle => bundle.id)
        .filter((id): id is number => Number.isSafeInteger(id))
        .forEach(id => {
          bundleIds.add(id);
          jobDefinitionBundleIds.add(id);
        });
    }

    const variableBundles = await this.loadWorkspaceVariableBundles(
      workspaceId,
      Array.from(bundleIds)
    );
    const loadedBundleIds = new Set(variableBundles.map(bundle => bundle.id));
    const missingVariableBundleIds =
      variableBundleIds.filter(id => !loadedBundleIds.has(id));
    if (missingVariableBundleIds.length > 0) {
      throw new NotFoundException(
        'Mindestens eine ausgewählte Variablengruppe wurde im Workspace nicht gefunden.'
      );
    }
    const missingJobDefinitionBundleIds = Array.from(jobDefinitionBundleIds)
      .filter(id => !loadedBundleIds.has(id));
    if (missingJobDefinitionBundleIds.length > 0) {
      throw new NotFoundException(
        'Mindestens eine Variablengruppe der ausgewählten Jobdefinition wurde im Workspace nicht gefunden.'
      );
    }

    variableBundles.forEach(bundle => {
      if (jobDefinitionBundleIds.has(bundle.id)) {
        (bundle.variables || [])
          .forEach(variable => this.addAllowedVariable(
            jobDefinitionAllowedVariablesByUnit,
            variable
          ));
      }

      if (variableBundleIds.includes(bundle.id)) {
        (bundle.variables || [])
          .forEach(variable => this.addAllowedVariable(
            variableBundleAllowedVariablesByUnit,
            variable
          ));
      }
    });

    let scopedUnits = units;
    if (contentOptions.jobDefinitionId !== undefined && contentOptions.jobDefinitionId !== null) {
      scopedUnits = this.filterUnitsByAllowedVariables(
        scopedUnits,
        jobDefinitionAllowedVariablesByUnit
      );
    }

    if (variableBundleIds.length > 0) {
      scopedUnits = this.filterUnitsByAllowedVariables(
        scopedUnits,
        variableBundleAllowedVariablesByUnit
      );
    }

    return scopedUnits;
  }

  private filterUnitsByAllowedVariables(
    units: UnitPropertiesForCodebook[],
    allowedVariablesByUnit: Map<string, Set<string>>
  ): UnitPropertiesForCodebook[] {
    if (allowedVariablesByUnit.size === 0) {
      return [];
    }

    return units
      .map(unit => this.filterUnitByAllowedVariables(unit, allowedVariablesByUnit))
      .filter((unit): unit is UnitPropertiesForCodebook => !!unit);
  }

  private async loadWorkspaceVariableBundles(
    workspaceId: number,
    variableBundleIds: number[]
  ): Promise<VariableBundle[]> {
    if (variableBundleIds.length === 0) {
      return [];
    }

    return this.variableBundleRepository.find({
      where: {
        id: In(variableBundleIds),
        workspace_id: workspaceId
      }
    });
  }

  private hasVariableScope(contentOptions: CodeBookContentSetting): boolean {
    return !!(
      contentOptions.jobDefinitionId ||
      this.normalizeVariableBundleScopeIds(contentOptions.variableBundleIds).length
    );
  }

  private normalizeVariableBundleScopeIds(value: unknown): number[] {
    if (value === undefined || value === null) {
      return [];
    }

    if (!Array.isArray(value)) {
      throw new BadRequestException(
        'contentOptions.variableBundleIds darf nur positive ganzzahlige IDs enthalten.'
      );
    }

    const normalized = value.map(id => {
      if (typeof id === 'number' && Number.isSafeInteger(id) && id > 0) {
        return id;
      }
      if (typeof id === 'string' && /^\d+$/.test(id.trim())) {
        const parsedId = Number(id.trim());
        if (Number.isSafeInteger(parsedId) && parsedId > 0) {
          return parsedId;
        }
      }
      throw new BadRequestException(
        'contentOptions.variableBundleIds darf nur positive ganzzahlige IDs enthalten.'
      );
    });

    return Array.from(new Set(normalized));
  }

  private addAllowedVariable(
    allowedVariablesByUnit: Map<string, Set<string>>,
    variable: JobDefinitionVariable | undefined
  ): void {
    if (!variable?.unitName || !variable.variableId) {
      return;
    }

    const unitKey = this.normalizeUnitKey(variable.unitName);
    const variableId = this.normalizeVariableId(variable.variableId);
    if (!unitKey || !variableId) {
      return;
    }

    const allowedVariables =
      allowedVariablesByUnit.get(unitKey) ?? new Set<string>();
    allowedVariables.add(variableId);
    allowedVariablesByUnit.set(unitKey, allowedVariables);
  }

  private filterUnitByAllowedVariables(
    unit: UnitPropertiesForCodebook,
    allowedVariablesByUnit: Map<string, Set<string>>
  ): UnitPropertiesForCodebook | null {
    const allowedVariables =
      allowedVariablesByUnit.get(this.normalizeUnitKey(unit.key)) ||
      allowedVariablesByUnit.get(this.normalizeUnitKey(unit.name));

    if (!allowedVariables || !unit.scheme) {
      return null;
    }

    try {
      const scheme = JSON.parse(unit.scheme) as {
        variableCodings?: Array<{
          id?: string;
          alias?: string;
        }>;
        [key: string]: unknown;
      };

      if (!Array.isArray(scheme.variableCodings)) {
        return null;
      }

      const variableCodings = scheme.variableCodings.filter(variableCoding => (
        this.matchesAllowedVariable(variableCoding, allowedVariables)
      ));

      if (variableCodings.length === 0) {
        return null;
      }

      return {
        ...unit,
        scheme: JSON.stringify({
          ...scheme,
          variableCodings
        })
      };
    } catch (error) {
      this.logger.warn(
        `Could not apply variable scope to codebook unit ${unit.key}: ${error.message}`
      );
      return null;
    }
  }

  private matchesAllowedVariable(
    variableCoding: { id?: string; alias?: string },
    allowedVariables: Set<string>
  ): boolean {
    return [variableCoding.id, variableCoding.alias]
      .map(value => this.normalizeVariableId(value))
      .some(value => value !== '' && allowedVariables.has(value));
  }

  private normalizeUnitKey(value: string | undefined): string {
    return (value || '')
      .trim()
      .replace(/\.vocs$/i, '')
      .toUpperCase();
  }

  private normalizeVariableId(value: string | undefined): string {
    return (value || '').trim();
  }
}
