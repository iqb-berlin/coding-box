import { Repository } from 'typeorm';
import { Setting } from '../entities/setting.entity';

export const INCLUDE_DERIVE_ERROR_IN_MANUAL_CODING_SETTING_KEY =
  'include-derive-error-in-manual-coding';

type SettingReader = Pick<Repository<Setting>, 'findOne'>;

export async function isDeriveErrorInManualCodingEnabled(
  settingRepository: SettingReader | undefined,
  workspaceId: number
): Promise<boolean> {
  if (!settingRepository) {
    return false;
  }

  const setting = await settingRepository.findOne({
    where: {
      key: `workspace-${workspaceId}-${INCLUDE_DERIVE_ERROR_IN_MANUAL_CODING_SETTING_KEY}`
    }
  });

  if (!setting) {
    return false;
  }

  try {
    const parsed = JSON.parse(setting.content);
    return parsed.enabled === true;
  } catch {
    return false;
  }
}
