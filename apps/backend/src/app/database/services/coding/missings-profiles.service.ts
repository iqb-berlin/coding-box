import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { MissingsProfile } from '../../entities/missings-profile.entity';
import { CodingJob } from '../../entities/coding-job.entity';
import { JobDefinition } from '../../entities/job-definition.entity';
import { MissingsProfilesDto } from '../../../../../../../api-dto/coding/missings-profiles.dto';

@Injectable()
export class MissingsProfilesService {
  private readonly logger = new Logger(MissingsProfilesService.name);

  private readonly defaultProfileLabel = 'IQB-Standard';

  constructor(
    @InjectRepository(MissingsProfile)
    private missingsProfileRepository: Repository<MissingsProfile>,
    @InjectRepository(CodingJob)
    private codingJobRepository: Repository<CodingJob>,
    @InjectRepository(JobDefinition)
    private jobDefinitionRepository: Repository<JobDefinition>
  ) {}

  private toDto(profileEntity: MissingsProfile): MissingsProfilesDto {
    const profile = new MissingsProfilesDto();
    profile.id = profileEntity.id;
    profile.label = profileEntity.label;
    profile.missings = profileEntity.missings;
    return profile;
  }

  async getMissingsProfiles(workspaceId: number): Promise<{ label: string; id: number }[]> {
    try {
      this.logger.log(`Getting missings profiles for workspace ${workspaceId}`);
      await this.ensureDefaultMissingsProfile(workspaceId);

      const profiles = await this.missingsProfileRepository.find({
        select: ['id', 'label']
      });

      return profiles.map(profile => ({ label: profile.label, id: profile.id }));
    } catch (error) {
      this.logger.error(`Error getting missings profiles for workspace ${workspaceId}: ${error.message}`, error.stack);
      return [];
    }
  }

  async getMissingsProfileByLabel(label: string): Promise<MissingsProfilesDto | null> {
    try {
      const profileEntity = await this.missingsProfileRepository.findOne({
        where: { label }
      });

      if (!profileEntity) {
        return null;
      }

      return this.toDto(profileEntity);
    } catch (error) {
      this.logger.error(`Error getting missings profile by label: ${error.message}`, error.stack);
      return null;
    }
  }

  private async getMissingsProfileById(id: number): Promise<MissingsProfilesDto | null> {
    try {
      const profileEntity = await this.missingsProfileRepository.findOne({
        where: { id }
      });

      if (!profileEntity) {
        return null;
      }

      return this.toDto(profileEntity);
    } catch (error) {
      this.logger.error(`Error getting missings profile by id: ${error.message}`, error.stack);
      return null;
    }
  }

  private createDefaultMissingsProfile(): MissingsProfilesDto {
    const iqbStandardProfile = new MissingsProfilesDto();
    iqbStandardProfile.label = this.defaultProfileLabel;
    iqbStandardProfile.setMissings([
      {
        id: 'mci',
        label: 'missing coding impossible',
        description: '(1) Item müsste/könnte bearbeitet worden sein, aber (2) Antwort ist aufgrund technischer Probleme (z.B. Scanfehler) nicht auswertbar.',
        code: -97
      },
      {
        id: 'mir',
        label: 'missing invalid response',
        description: '(1) Item wurde bearbeitet, aber (2a) leere Antwort oder (2b) ungültige (Spaß-)Antwort. Das Item wurde zwar bearbeitet, aber es wurde seitens der Testperson kein ernsthafter Lösungsversuch unternommen. Beispiel: Antworten wie "kein Plan", "egal", oder eine gemalte Sonne.',
        code: -98
      },
      {
        id: 'mbi_mbo',
        label: 'mbi / mbo',
        description: 'Item wurde nicht bearbeitet aber gesehen oder Item wurde nicht gesehen, aber es gibt nachfolgend gesehene oder bearbeitete Items.',
        code: -99
      }
    ]);

    return iqbStandardProfile;
  }

  private getNegativeMissingCodesFromProfile(profile: MissingsProfilesDto): Set<number> {
    return new Set(profile.parseMissings()
      .map(missing => Number(missing.code))
      .filter(code => Number.isInteger(code) && code < 0));
  }

  async ensureDefaultMissingsProfile(workspaceId: number): Promise<MissingsProfilesDto> {
    try {
      const existingProfile = await this.missingsProfileRepository.findOne({
        where: { label: this.defaultProfileLabel }
      });

      if (existingProfile) {
        return this.toDto(existingProfile);
      }

      const defaultProfile = this.createDefaultMissingsProfile();
      const profileEntity = new MissingsProfile();
      profileEntity.label = defaultProfile.label;
      profileEntity.missings = defaultProfile.missings;

      const savedProfile = await this.missingsProfileRepository.save(profileEntity);
      return this.toDto(savedProfile);
    } catch (error) {
      this.logger.error(`Error ensuring default missings profile for workspace ${workspaceId}: ${error.message}`, error.stack);
      throw error;
    }
  }

  async getDefaultMissingsProfileId(workspaceId: number): Promise<number> {
    const defaultProfile = await this.ensureDefaultMissingsProfile(workspaceId);
    if (!defaultProfile.id) {
      throw new BadRequestException('Default missings profile has no id');
    }

    return defaultProfile.id;
  }

  async getDefaultNegativeMissingCodes(workspaceId: number): Promise<Set<number>> {
    const defaultProfile = await this.ensureDefaultMissingsProfile(workspaceId);
    return this.getNegativeMissingCodesFromProfile(defaultProfile);
  }

  async getNegativeMissingCodesForProfileOrDefault(
    workspaceId: number,
    profileId?: number | null
  ): Promise<Set<number>> {
    const resolvedProfileId = await this.resolveMissingsProfileId(workspaceId, profileId);
    const profile = await this.getMissingsProfileById(resolvedProfileId);
    if (!profile) {
      throw new BadRequestException(`Missing profile ${resolvedProfileId} not found`);
    }

    return this.getNegativeMissingCodesFromProfile(profile);
  }

  async resolveMissingsProfileId(
    workspaceId: number,
    profileId?: number | null
  ): Promise<number> {
    if (profileId === null || profileId === undefined || profileId === 0) {
      return this.getDefaultMissingsProfileId(workspaceId);
    }

    if (!Number.isInteger(profileId) || profileId < 1) {
      throw new BadRequestException(`Invalid missings profile id: ${profileId}`);
    }

    const profile = await this.getMissingsProfileById(profileId);
    if (!profile) {
      throw new BadRequestException(`Missing profile ${profileId} not found`);
    }

    return profileId;
  }

  private async assertProfileIsNotReferenced(profile: MissingsProfile): Promise<void> {
    const codingJobReferenceWhere = profile.label === this.defaultProfileLabel ?
      [{ missings_profile_id: profile.id }, { missings_profile_id: IsNull() }] :
      { missings_profile_id: profile.id };
    const jobDefinitionReferenceWhere = profile.label === this.defaultProfileLabel ?
      [{ missings_profile_id: profile.id }, { missings_profile_id: IsNull() }] :
      { missings_profile_id: profile.id };

    const [codingJobReferences, jobDefinitionReferences] = await Promise.all([
      this.codingJobRepository.count({ where: codingJobReferenceWhere }),
      this.jobDefinitionRepository.count({ where: jobDefinitionReferenceWhere })
    ]);
    const totalReferences = codingJobReferences + jobDefinitionReferences;

    if (totalReferences > 0) {
      throw new BadRequestException(
        `Missings profile '${profile.label}' is used by ${totalReferences} coding configuration(s) and cannot be changed`
      );
    }
  }

  async createMissingsProfile(workspaceId: number, profile: MissingsProfilesDto): Promise<MissingsProfilesDto | null> {
    try {
      this.logger.log(`Creating missings profile for workspace ${workspaceId}`);

      const existingProfile = await this.missingsProfileRepository.findOne({
        where: { label: profile.label }
      });

      if (existingProfile) {
        this.logger.error(`A missings profile with label '${profile.label}' already exists`);
        return null;
      }

      const profileEntity = new MissingsProfile();
      profileEntity.label = profile.label;
      profileEntity.missings = profile.missings;

      const savedProfile = await this.missingsProfileRepository.save(profileEntity);

      return this.toDto(savedProfile);
    } catch (error) {
      this.logger.error(`Error creating missings profile: ${error.message}`, error.stack);
      throw error;
    }
  }

  async updateMissingsProfile(workspaceId: number, label: string, profile: MissingsProfilesDto): Promise<MissingsProfilesDto | null> {
    try {
      this.logger.log(`Updating missings profile '${label}' for workspace ${workspaceId}`);

      const existingProfile = await this.missingsProfileRepository.findOne({
        where: { label }
      });

      if (!existingProfile) {
        this.logger.error(`Missings profile with label '${label}' not found`);
        return null;
      }

      if (profile.label !== existingProfile.label) {
        const duplicateProfile = await this.missingsProfileRepository.findOne({
          where: { label: profile.label }
        });

        if (duplicateProfile && duplicateProfile.id !== existingProfile.id) {
          throw new BadRequestException(`A missings profile with label '${profile.label}' already exists`);
        }
      }

      await this.assertProfileIsNotReferenced(existingProfile);

      existingProfile.label = profile.label;
      existingProfile.missings = profile.missings;

      const savedProfile = await this.missingsProfileRepository.save(existingProfile);

      return this.toDto(savedProfile);
    } catch (error) {
      this.logger.error(`Error updating missings profile: ${error.message}`, error.stack);
      throw error;
    }
  }

  async deleteMissingsProfile(workspaceId: number, label: string): Promise<boolean> {
    try {
      this.logger.log(`Deleting missings profile '${label}' for workspace ${workspaceId}`);

      const existingProfile = await this.missingsProfileRepository.findOne({
        where: { label }
      });
      if (!existingProfile) {
        return false;
      }

      await this.assertProfileIsNotReferenced(existingProfile);

      const result = await this.missingsProfileRepository.delete({ label });

      return result.affected ? result.affected > 0 : false;
    } catch (error) {
      this.logger.error(`Error deleting missings profile: ${error.message}`, error.stack);
      if (error instanceof BadRequestException) {
        throw error;
      }
      return false;
    }
  }

  async getMissingsProfileDetails(workspaceId: number, id: number): Promise<MissingsProfilesDto | null> {
    try {
      this.logger.log(`Getting missings profile details for '${id}' in workspace ${workspaceId}`);
      return await this.getMissingsProfileById(id);
    } catch (error) {
      this.logger.error(`Error getting missings profile details: ${error.message}`, error.stack);
      return null;
    }
  }
}
