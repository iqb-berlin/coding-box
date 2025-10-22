import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MissingsProfile } from '../entities/missings-profile.entity';
import { MissingsProfilesDto } from '../../../../../../api-dto/coding/missings-profiles.dto';

@Injectable()
export class MissingsProfilesService {
  private readonly logger = new Logger(MissingsProfilesService.name);

  constructor(
    @InjectRepository(MissingsProfile)
    private missingsProfileRepository: Repository<MissingsProfile>
  ) {}

  /**
   * Get all missings profiles
   * @param workspaceId Workspace ID (not used, profiles are global)
   * @returns Array of missings profiles with labels
   */
  async getMissingsProfiles(workspaceId: number): Promise<{ label: string }[]> {
    try {
      this.logger.log(`Getting missings profiles for workspace ${workspaceId}`);

      const profiles = await this.missingsProfileRepository.find({
        select: ['label']
      });

      if (profiles.length === 0) {
        const defaultProfiles = this.createDefaultMissingsProfiles();
        await this.saveDefaultMissingsProfiles(defaultProfiles);

        return defaultProfiles.map(profile => ({ label: profile.label }));
      }

      return profiles.map(profile => ({ label: profile.label }));
    } catch (error) {
      this.logger.error(`Error getting missings profiles for workspace ${workspaceId}: ${error.message}`, error.stack);
      return [];
    }
  }

  private async getMissingsProfileByLabel(label: string): Promise<MissingsProfilesDto | null> {
    try {
      const profileEntity = await this.missingsProfileRepository.findOne({
        where: { label }
      });

      if (!profileEntity) {
        return null;
      }

      try {
        const profile = new MissingsProfilesDto();
        profile.label = profileEntity.label;
        profile.missings = profileEntity.missings;
        return profile;
      } catch (parseError) {
        this.logger.error(`Error parsing missings profile: ${parseError.message}`, parseError.stack);
        return null;
      }
    } catch (error) {
      this.logger.error(`Error getting missings profile by label: ${error.message}`, error.stack);
      return null;
    }
  }

  /**
   * Create default missings profiles
   * @returns Array of default missings profiles
   */
  private createDefaultMissingsProfiles(): MissingsProfilesDto[] {
    // Create default IQB-Standard profile (matching the one from WorkspaceCodingService)
    const iqbStandardProfile = new MissingsProfilesDto();
    iqbStandardProfile.label = 'IQB-Standard';
    iqbStandardProfile.setMissings([
      {
        id: 'mbd',
        label: 'missing by design',
        description: 'Antwort liegt nicht vor, weil das Item der Testperson planmäßig nicht präsentiert wurde.',
        code: -94
      },
      {
        id: 'mnr',
        label: 'missing not reached',
        description: '(1) Item wurde nicht gesehen und (2) es folgen nur nicht gesehene Items. Die Testperson hat vor diesem Item mit der Bearbeitung des Testhefts aufgehört. \nDer Missing Code wird nicht durch Kodierende vergeben, sondern muss ggf. nach bereits erfolgter Kodierung aus "missing by intention" rekodiert werden.',
        code: -96
      },
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

    return [iqbStandardProfile];
  }

  private async saveDefaultMissingsProfiles(profiles: MissingsProfilesDto[]): Promise<void> {
    try {
      for (const profile of profiles) {
        const existingProfile = await this.missingsProfileRepository.findOne({
          where: { label: profile.label }
        });

        if (!existingProfile) {
          const profileEntity = new MissingsProfile();
          profileEntity.label = profile.label;
          profileEntity.missings = profile.missings;
          await this.missingsProfileRepository.save(profileEntity);
        }
      }
    } catch (error) {
      this.logger.error(`Error saving default missings profiles: ${error.message}`, error.stack);
      throw error;
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

      await this.missingsProfileRepository.save(profileEntity);

      return profile;
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

      existingProfile.label = profile.label;
      existingProfile.missings = profile.missings;

      await this.missingsProfileRepository.save(existingProfile);

      return profile;
    } catch (error) {
      this.logger.error(`Error updating missings profile: ${error.message}`, error.stack);
      throw error;
    }
  }

  async deleteMissingsProfile(workspaceId: number, label: string): Promise<boolean> {
    try {
      this.logger.log(`Deleting missings profile '${label}' for workspace ${workspaceId}`);

      const result = await this.missingsProfileRepository.delete({ label });

      return result.affected ? result.affected > 0 : false;
    } catch (error) {
      this.logger.error(`Error deleting missings profile: ${error.message}`, error.stack);
      return false;
    }
  }

  async getMissingsProfileDetails(workspaceId: number, label: string): Promise<MissingsProfilesDto | null> {
    try {
      this.logger.log(`Getting missings profile details for '${label}' in workspace ${workspaceId}`);
      return await this.getMissingsProfileByLabel(label);
    } catch (error) {
      this.logger.error(`Error getting missings profile details: ${error.message}`, error.stack);
      return null;
    }
  }
}
