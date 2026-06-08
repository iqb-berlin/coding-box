import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { MissingsProfile } from '../../entities/missings-profile.entity';
import { CodingJob } from '../../entities/coding-job.entity';
import { JobDefinition } from '../../entities/job-definition.entity';
import { MissingDto, MissingsProfilesDto } from '../../../../../../../api-dto/coding/missings-profiles.dto';

export interface ResolvedMissingValue {
  id: string;
  label: string;
  code: number;
  score: number;
}

export type IqbStandardMissingId = 'mci' | 'mir' | 'mbi_mbo';

export const IQB_STANDARD_MISSING_CODES: Record<IqbStandardMissingId, number> = {
  mci: -97,
  mir: -98,
  mbi_mbo: -99
};

export const IQB_STANDARD_MISSING_SCORES: Record<IqbStandardMissingId, number> = {
  mci: 0,
  mir: 0,
  mbi_mbo: 0
};

@Injectable()
export class MissingsProfilesService {
  private readonly logger = new Logger(MissingsProfilesService.name);

  private readonly defaultProfileLabel = 'IQB-Standard';
  private readonly iqbStandardMissingScores = new Map<string, number>(
    Object.entries(IQB_STANDARD_MISSING_SCORES)
  );

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
        where: { workspace_id: workspaceId },
        select: ['id', 'label']
      });

      return profiles.map(profile => ({ label: profile.label, id: profile.id }));
    } catch (error) {
      this.logger.error(`Error getting missings profiles for workspace ${workspaceId}: ${error.message}`, error.stack);
      return [];
    }
  }

  async getMissingsProfileByLabel(workspaceId: number, label: string): Promise<MissingsProfilesDto | null> {
    try {
      const profileEntity = await this.missingsProfileRepository.findOne({
        where: { workspace_id: workspaceId, label }
      });

      if (!profileEntity) {
        return null;
      }

      return await this.enrichIqbStandardEntityIfNeeded(profileEntity);
    } catch (error) {
      this.logger.error(`Error getting missings profile by label: ${error.message}`, error.stack);
      return null;
    }
  }

  private async enrichIqbStandardEntityIfNeeded(profileEntity: MissingsProfile): Promise<MissingsProfilesDto> {
    const profile = this.toDto(profileEntity);
    if (profile.label !== this.defaultProfileLabel) {
      return profile;
    }

    const enriched = this.addIqbStandardScores(profile);
    if (!enriched.changed) {
      return enriched.profile;
    }

    profileEntity.missings = enriched.profile.missings as string;
    const savedProfile = await this.missingsProfileRepository.save(profileEntity);
    return this.toDto(savedProfile);
  }

  private async getMissingsProfileById(workspaceId: number, id: number): Promise<MissingsProfilesDto | null> {
    try {
      const profileEntity = await this.missingsProfileRepository.findOne({
        where: { id, workspace_id: workspaceId }
      });

      if (!profileEntity) {
        return null;
      }

      return await this.enrichIqbStandardEntityIfNeeded(profileEntity);
    } catch (error) {
      this.logger.error(`Error getting missings profile by id: ${error.message}`, error.stack);
      return null;
    }
  }

  private toProfileDto(profile: MissingsProfilesDto): MissingsProfilesDto {
    if (profile instanceof MissingsProfilesDto) {
      return profile;
    }

    return Object.assign(new MissingsProfilesDto(), profile);
  }

  private hasExplicitFiniteScore(score: unknown): boolean {
    if (typeof score === 'number') {
      return Number.isFinite(score);
    }

    if (typeof score === 'string') {
      const trimmedScore = score.trim();
      return trimmedScore !== '' && Number.isFinite(Number(trimmedScore));
    }

    return false;
  }

  private parseMissingsForStorage(profile: MissingsProfilesDto): MissingDto[] {
    if (!profile.missings) {
      return [];
    }

    if (Array.isArray(profile.missings)) {
      return profile.missings as MissingDto[];
    }

    if (typeof profile.missings === 'string') {
      try {
        const parsed = JSON.parse(profile.missings);
        if (!Array.isArray(parsed)) {
          throw new BadRequestException('Missings profile must contain a valid missings array');
        }
        return parsed;
      } catch (error) {
        if (error instanceof BadRequestException) {
          throw error;
        }
        throw new BadRequestException('Missings profile must contain valid JSON');
      }
    }

    throw new BadRequestException('Missings profile must contain a valid missings array');
  }

  private normalizeProfileMissings(profile: MissingsProfilesDto): MissingDto[] {
    const missings = this.parseMissingsForStorage(profile);
    if (!Array.isArray(missings)) {
      throw new BadRequestException('Missings profile must contain a valid missings array');
    }

    const normalizedMissings = missings.map((missing, index) => {
      const code = Number(missing.code);
      const score = Number(missing.score);

      if (!missing.id || typeof missing.id !== 'string' || missing.id.trim() === '') {
        throw new BadRequestException(`Missing entry ${index + 1} must define an id`);
      }

      if (!missing.label || typeof missing.label !== 'string' || missing.label.trim() === '') {
        throw new BadRequestException(`Missing entry '${missing.id}' must define a label`);
      }

      if (missing.description === null || missing.description === undefined) {
        throw new BadRequestException(`Missing entry '${missing.id}' must define a description`);
      }

      if (!Number.isInteger(code)) {
        throw new BadRequestException(`Missing entry '${missing.id}' must define an integer code`);
      }

      if (code >= 0) {
        throw new BadRequestException(`Missing entry '${missing.id}' must define a negative code`);
      }

      if (!this.hasExplicitFiniteScore(missing.score)) {
        throw new BadRequestException(`Missing entry '${missing.id}' must define a score`);
      }

      return {
        id: missing.id.trim(),
        label: missing.label.trim(),
        description: String(missing.description),
        code,
        score
      };
    });

    const ids = new Set<string>();
    const codes = new Set<number>();
    normalizedMissings.forEach(missing => {
      if (ids.has(missing.id)) {
        throw new BadRequestException(`Duplicate missing id '${missing.id}'`);
      }
      ids.add(missing.id);

      if (codes.has(missing.code)) {
        throw new BadRequestException(`Duplicate missing code '${missing.code}'`);
      }
      codes.add(missing.code);
    });

    ['mir', 'mci'].forEach(requiredId => {
      if (!ids.has(requiredId)) {
        throw new BadRequestException(`Missings profile must define '${requiredId}'`);
      }
    });

    return normalizedMissings;
  }

  private prepareProfileForStorage(rawProfile: MissingsProfilesDto): MissingsProfilesDto {
    const profile = this.toProfileDto(rawProfile);

    if (!profile.label || typeof profile.label !== 'string' || profile.label.trim() === '') {
      throw new BadRequestException('Missings profile must define a label');
    }

    profile.label = profile.label.trim();
    profile.setMissings(this.normalizeProfileMissings(profile));
    return profile;
  }

  private addIqbStandardScores(profile: MissingsProfilesDto): { profile: MissingsProfilesDto; changed: boolean } {
    const missings = profile.parseMissings();
    let changed = false;

    const enrichedMissings = missings.map(missing => {
      const score = this.iqbStandardMissingScores.get(missing.id);
      if (score === undefined || this.hasExplicitFiniteScore(missing.score)) {
        return missing;
      }

      changed = true;
      return {
        ...missing,
        score
      };
    });

    if (changed) {
      profile.setMissings(enrichedMissings as MissingDto[]);
    }

    return { profile, changed };
  }

  private assertMissingHasScore(missing: MissingDto): ResolvedMissingValue {
    const code = Number(missing.code);
    const score = Number(missing.score);

    if (!Number.isInteger(code)) {
      throw new BadRequestException(`Missing '${missing.id}' must define an integer code`);
    }

    if (!this.hasExplicitFiniteScore(missing.score)) {
      throw new BadRequestException(`Missing '${missing.id}' must define a score`);
    }

    return {
      id: missing.id,
      label: missing.label,
      code,
      score
    };
  }

  private createDefaultMissingsProfile(): MissingsProfilesDto {
    const iqbStandardProfile = new MissingsProfilesDto();
    iqbStandardProfile.label = this.defaultProfileLabel;
    iqbStandardProfile.setMissings([
      {
        id: 'mci',
        label: 'missing coding impossible',
        description: '(1) Item müsste/könnte bearbeitet worden sein, aber (2) Antwort ist aufgrund technischer Probleme (z.B. Scanfehler) nicht auswertbar.',
        code: IQB_STANDARD_MISSING_CODES.mci,
        score: IQB_STANDARD_MISSING_SCORES.mci
      },
      {
        id: 'mir',
        label: 'missing invalid response',
        description: '(1) Item wurde bearbeitet, aber (2a) leere Antwort oder (2b) ungültige (Spaß-)Antwort. Das Item wurde zwar bearbeitet, aber es wurde seitens der Testperson kein ernsthafter Lösungsversuch unternommen. Beispiel: Antworten wie "kein Plan", "egal", oder eine gemalte Sonne.',
        code: IQB_STANDARD_MISSING_CODES.mir,
        score: IQB_STANDARD_MISSING_SCORES.mir
      },
      {
        id: 'mbi_mbo',
        label: 'mbi / mbo',
        description: 'Item wurde nicht bearbeitet aber gesehen oder Item wurde nicht gesehen, aber es gibt nachfolgend gesehene oder bearbeitete Items.',
        code: IQB_STANDARD_MISSING_CODES.mbi_mbo,
        score: IQB_STANDARD_MISSING_SCORES.mbi_mbo
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
        where: { workspace_id: workspaceId, label: this.defaultProfileLabel }
      });

      if (existingProfile) {
        const enriched = this.addIqbStandardScores(this.toDto(existingProfile));
        if (enriched.changed) {
          existingProfile.missings = enriched.profile.missings as string;
          const savedProfile = await this.missingsProfileRepository.save(existingProfile);
          return this.toDto(savedProfile);
        }
        return enriched.profile;
      }

      const defaultProfile = this.prepareProfileForStorage(this.createDefaultMissingsProfile());
      const profileEntity = new MissingsProfile();
      profileEntity.workspace_id = workspaceId;
      profileEntity.label = defaultProfile.label;
      profileEntity.missings = defaultProfile.missings as string;

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
    const profile = await this.getMissingsProfileById(workspaceId, resolvedProfileId);
    if (!profile) {
      throw new BadRequestException(`Missing profile ${resolvedProfileId} not found`);
    }

    return this.getNegativeMissingCodesFromProfile(profile);
  }

  async getMissingByIdForProfileOrDefault(
    workspaceId: number,
    profileId: number | null | undefined,
    missingId: string
  ): Promise<ResolvedMissingValue> {
    const resolvedProfileId = await this.resolveMissingsProfileId(workspaceId, profileId);
    const profile = await this.getMissingsProfileById(workspaceId, resolvedProfileId);
    if (!profile) {
      throw new BadRequestException(`Missing profile ${resolvedProfileId} not found`);
    }

    const missing = profile.parseMissings().find(entry => entry.id === missingId);
    if (!missing) {
      throw new BadRequestException(`Missing '${missingId}' not found in profile ${resolvedProfileId}`);
    }

    return this.assertMissingHasScore(missing);
  }

  async getMissingByCodeForProfileOrDefault(
    workspaceId: number,
    profileId: number | null | undefined,
    code: number
  ): Promise<ResolvedMissingValue> {
    const resolvedProfileId = await this.resolveMissingsProfileId(workspaceId, profileId);
    const profile = await this.getMissingsProfileById(workspaceId, resolvedProfileId);
    if (!profile) {
      throw new BadRequestException(`Missing profile ${resolvedProfileId} not found`);
    }

    const missing = profile.parseMissings().find(entry => Number(entry.code) === code);
    if (!missing) {
      throw new BadRequestException(`Missing code ${code} not found in profile ${resolvedProfileId}`);
    }

    return this.assertMissingHasScore(missing);
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

    const profile = await this.getMissingsProfileById(workspaceId, profileId);
    if (!profile) {
      throw new BadRequestException(`Missing profile ${profileId} not found`);
    }

    return profileId;
  }

  private async assertProfileIsNotReferenced(profile: MissingsProfile): Promise<void> {
    const codingJobReferenceWhere = profile.label === this.defaultProfileLabel ?
      [{ workspace_id: profile.workspace_id, missings_profile_id: profile.id }, { workspace_id: profile.workspace_id, missings_profile_id: IsNull() }] :
      { workspace_id: profile.workspace_id, missings_profile_id: profile.id };
    const jobDefinitionReferenceWhere = profile.label === this.defaultProfileLabel ?
      [{ workspace_id: profile.workspace_id, missings_profile_id: profile.id }, { workspace_id: profile.workspace_id, missings_profile_id: IsNull() }] :
      { workspace_id: profile.workspace_id, missings_profile_id: profile.id };

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
      const normalizedProfile = this.prepareProfileForStorage(profile);

      const existingProfile = await this.missingsProfileRepository.findOne({
        where: { workspace_id: workspaceId, label: normalizedProfile.label }
      });

      if (existingProfile) {
        this.logger.error(`A missings profile with label '${normalizedProfile.label}' already exists`);
        return null;
      }

      const profileEntity = new MissingsProfile();
      profileEntity.workspace_id = workspaceId;
      profileEntity.label = normalizedProfile.label;
      profileEntity.missings = normalizedProfile.missings as string;

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
      const normalizedProfile = this.prepareProfileForStorage(profile);

      const existingProfile = await this.missingsProfileRepository.findOne({
        where: { workspace_id: workspaceId, label }
      });

      if (!existingProfile) {
        this.logger.error(`Missings profile with label '${label}' not found`);
        return null;
      }

      if (normalizedProfile.label !== existingProfile.label) {
        const duplicateProfile = await this.missingsProfileRepository.findOne({
          where: { workspace_id: workspaceId, label: normalizedProfile.label }
        });

        if (duplicateProfile && duplicateProfile.id !== existingProfile.id) {
          throw new BadRequestException(`A missings profile with label '${normalizedProfile.label}' already exists`);
        }
      }

      await this.assertProfileIsNotReferenced(existingProfile);

      existingProfile.label = normalizedProfile.label;
      existingProfile.missings = normalizedProfile.missings as string;

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
        where: { workspace_id: workspaceId, label }
      });
      if (!existingProfile) {
        return false;
      }

      await this.assertProfileIsNotReferenced(existingProfile);

      const result = await this.missingsProfileRepository.delete({ workspace_id: workspaceId, label });

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
      return await this.getMissingsProfileById(workspaceId, id);
    } catch (error) {
      this.logger.error(`Error getting missings profile details: ${error.message}`, error.stack);
      return null;
    }
  }
}
