import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Setting } from '../entities/setting.entity';
import { MissingsProfilesDto } from '../../../../../../api-dto/coding/missings-profiles.dto';

@Injectable()
export class MissingsProfilesService {
  private readonly logger = new Logger(MissingsProfilesService.name);

  constructor(
    @InjectRepository(Setting)
    private settingRepository: Repository<Setting>
  ) {}

  /**
   * Get all missings profiles
   * @param workspaceId Workspace ID (not used, profiles are global)
   * @returns Array of missings profiles with labels
   */
  async getMissingsProfiles(workspaceId: number): Promise<{ label: string }[]> {
    try {
      this.logger.log(`Getting missings profiles for workspace ${workspaceId}`);

      const setting = await this.settingRepository.findOne({
        where: { key: 'missings-profile-iqb-standard' }
      });

      if (!setting) {
        const defaultProfiles = this.createDefaultMissingsProfiles();
        await this.saveMissingsProfiles(defaultProfiles);

        return defaultProfiles.map(profile => ({ label: profile.label }));
      }

      // Parse the profiles from the setting content
      try {
        const profiles: MissingsProfilesDto[] = JSON.parse(setting.content);
        return profiles.map(profile => ({ label: profile.label }));
      } catch (parseError) {
        this.logger.error(`Error parsing missings profiles: ${parseError.message}`, parseError.stack);
        return [];
      }
    } catch (error) {
      this.logger.error(`Error getting missings profiles for workspace ${workspaceId}: ${error.message}`, error.stack);
      return [];
    }
  }

  private async getMissingsProfileByLabel(label: string): Promise<MissingsProfilesDto | null> {
    try {
      const setting = await this.settingRepository.findOne({
        where: { key: 'missings-profile-iqb-standard' }
      });

      if (!setting) {
        return null;
      }

      try {
        const profiles: MissingsProfilesDto[] = JSON.parse(setting.content);
        const profile = profiles.find(p => p.label === label);
        return profile || null;
      } catch (parseError) {
        this.logger.error(`Error parsing missings profiles: ${parseError.message}`, parseError.stack);
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
    // Create default profiles
    const defaultProfile = new MissingsProfilesDto();
    defaultProfile.label = 'Default';
    defaultProfile.setMissings([
      {
        id: 'missing',
        label: 'Missing',
        description: 'Value is missing',
        code: 999
      }
    ]);

    const standardProfile = new MissingsProfilesDto();
    standardProfile.label = 'Standard';
    standardProfile.setMissings([
      {
        id: 'missing',
        label: 'Missing',
        description: 'Value is missing',
        code: 999
      },
      {
        id: 'not-reached',
        label: 'Not Reached',
        description: 'Item was not reached by the test taker',
        code: 998
      }
    ]);

    const extendedProfile = new MissingsProfilesDto();
    extendedProfile.label = 'Extended';
    extendedProfile.setMissings([
      {
        id: 'missing',
        label: 'Missing',
        description: 'Value is missing',
        code: 999
      },
      {
        id: 'not-reached',
        label: 'Not Reached',
        description: 'Item was not reached by the test taker',
        code: 998
      },
      {
        id: 'not-applicable',
        label: 'Not Applicable',
        description: 'Item is not applicable for this test taker',
        code: 997
      },
      {
        id: 'invalid',
        label: 'Invalid',
        description: 'Response is invalid',
        code: 996
      }
    ]);

    return [defaultProfile, standardProfile, extendedProfile];
  }

  private async saveMissingsProfiles(profiles: MissingsProfilesDto[]): Promise<void> {
    try {
      let setting = await this.settingRepository.findOne({
        where: { key: 'missings-profile-iqb-standard' }
      });

      if (!setting) {
        setting = new Setting();
        setting.key = 'missings-profile-iqb-standard';
      }

      setting.content = JSON.stringify(profiles);
      await this.settingRepository.save(setting);
    } catch (error) {
      this.logger.error(`Error saving missings profiles: ${error.message}`, error.stack);
      throw error;
    }
  }

  async createMissingsProfile(workspaceId: number, profile: MissingsProfilesDto): Promise<MissingsProfilesDto | null> {
    try {
      this.logger.log(`Creating missings profile for workspace ${workspaceId}`);

      const setting = await this.settingRepository.findOne({
        where: { key: 'missings-profile-iqb-standard' }
      });

      let profiles: MissingsProfilesDto[] = [];

      if (setting) {
        try {
          profiles = JSON.parse(setting.content);
        } catch (parseError) {
          this.logger.error(`Error parsing missings profiles: ${parseError.message}`, parseError.stack);
          profiles = [];
        }
      }

      const existingProfile = profiles.find(p => p.label === profile.label);
      if (existingProfile) {
        this.logger.error(`A missings profile with label '${profile.label}' already exists`);
        return null;
      }

      profiles.push(profile);

      // Save the updated profiles
      await this.saveMissingsProfiles(profiles);

      return profile;
    } catch (error) {
      this.logger.error(`Error creating missings profile: ${error.message}`, error.stack);
      throw error;
    }
  }

  async updateMissingsProfile(workspaceId: number, label: string, profile: MissingsProfilesDto): Promise<MissingsProfilesDto | null> {
    try {
      this.logger.log(`Updating missings profile '${label}' for workspace ${workspaceId}`);

      // Get all existing profiles
      const setting = await this.settingRepository.findOne({
        where: { key: 'missings-profile-iqb-standard' }
      });

      if (!setting) {
        this.logger.error('No missings profiles found');
        return null;
      }

      let profiles: MissingsProfilesDto[] = [];

      try {
        profiles = JSON.parse(setting.content);
      } catch (parseError) {
        this.logger.error(`Error parsing missings profiles: ${parseError.message}`, parseError.stack);
      }

      const index = profiles.findIndex(p => p.label === label);
      if (index === -1) {
        this.logger.error(`Missings profile with label '${label}' not found`);
        return null;
      }
      profiles[index] = profile;
      await this.saveMissingsProfiles(profiles);

      return profile;
    } catch (error) {
      this.logger.error(`Error updating missings profile: ${error.message}`, error.stack);
      throw error;
    }
  }

  async deleteMissingsProfile(workspaceId: number, label: string): Promise<boolean> {
    try {
      this.logger.log(`Deleting missings profile '${label}' for workspace ${workspaceId}`);

      // Get all existing profiles
      const setting = await this.settingRepository.findOne({
        where: { key: 'missings-profile-iqb-standard' }
      });

      if (!setting) {
        return false;
      }

      let profiles: MissingsProfilesDto[] = [];

      try {
        profiles = JSON.parse(setting.content);
      } catch (parseError) {
        this.logger.error(`Error parsing missings profiles: ${parseError.message}`, parseError.stack);
        return false;
      }

      // Find the profile to delete
      const index = profiles.findIndex(p => p.label === label);
      if (index === -1) {
        return false;
      }

      // Remove the profile
      profiles.splice(index, 1);

      // Save the updated profiles
      await this.saveMissingsProfiles(profiles);

      return true;
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
