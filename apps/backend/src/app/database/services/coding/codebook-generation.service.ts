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
        unitProperties,
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
}
