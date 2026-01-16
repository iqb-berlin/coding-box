import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
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
      this.logger.log(
        `Generating codebook for workspace ${workspaceId} with ${unitIds.length} units`
      );
      const units = await this.fileUploadRepository.findBy({
        id: In(unitIds)
      });

      if (!units || units.length === 0) {
        this.logger.warn(
          `No units found for workspace ${workspaceId} with IDs ${unitIds}`
        );
        return null;
      }

      const unitProperties: UnitPropertiesForCodebook[] = units.map(unit => ({
        id: unit.id,
        key: unit.file_id,
        name: unit.filename.toLowerCase().endsWith('.vocs') ?
          unit.filename.substring(0, unit.filename.length - 5) :
          unit.filename,
        scheme: unit.data || ''
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
      this.logger.error(
        `Error generating codebook for workspace ${workspaceId}: ${error.message}`,
        error.stack
      );
      return null;
    }
  }
}
