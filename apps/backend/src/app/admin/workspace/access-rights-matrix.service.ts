import { Injectable } from '@nestjs/common';
import { AccessRightsMatrixDto } from '../../../../../../api-dto/workspaces/access-rights-matrix-dto';
import { AccessLevelDto } from '../../../../../../api-dto/workspaces/access-level-dto';
import { FeatureCategoryDto } from '../../../../../../api-dto/workspaces/feature-category-dto';
import { FeaturePermissionDto } from '../../../../../../api-dto/workspaces/feature-permission-dto';

/**
 * Service providing static configuration for access rights matrix
 * Maps workspace features to minimum required access levels
 */
@Injectable()
export class AccessRightsMatrixService {
  /**
   * Get the complete access rights matrix configuration
   * @returns AccessRightsMatrixDto with all categories and permissions
   */
  getAccessRightsMatrix(): AccessRightsMatrixDto {
    return {
      levels: this.getAccessLevels(),
      categories: this.getFeatureCategories(),
      guestNote: 'access-matrix.guest-note',
      adminNote: 'access-matrix.admin-note'
    };
  }

  /**
   * Define the access levels (roles) 1-3
   */
  private getAccessLevels(): AccessLevelDto[] {
    return [
      {
        level: 1,
        translationKey: 'access-rights.access-level-1',
        icon: 'person'
      },
      {
        level: 2,
        translationKey: 'access-rights.access-level-2',
        icon: 'supervisor_account'
      },
      {
        level: 3,
        translationKey: 'access-rights.access-level-3',
        icon: 'account_circle'
      }
    ];
  }

  /**
   * Define all feature categories and their permissions
   */
  private getFeatureCategories(): FeatureCategoryDto[] {
    return [
      this.getTestFilesCategory(),
      this.getTestResultsCategory(),
      this.getCodingCategory(),
      this.getUsersCategory(),
      this.getSettingsCategory()
    ];
  }

  /**
   * Test Files category permissions
   */
  private getTestFilesCategory(): FeatureCategoryDto {
    const features: FeaturePermissionDto[] = [
      {
        featureKey: 'view-test-files',
        translationKey: 'access-matrix.feature.view-test-files',
        minAccessLevel: 3
      },
      {
        featureKey: 'download-test-files',
        translationKey: 'access-matrix.feature.download-test-files',
        minAccessLevel: 3
      },
      {
        featureKey: 'validate-test-files',
        translationKey: 'access-matrix.feature.validate-test-files',
        minAccessLevel: 3
      },
      {
        featureKey: 'upload-test-files',
        translationKey: 'access-matrix.feature.upload-test-files',
        minAccessLevel: 3
      },
      {
        featureKey: 'delete-test-files',
        translationKey: 'access-matrix.feature.delete-test-files',
        minAccessLevel: 3
      },
      {
        featureKey: 'import-from-testcenter',
        translationKey: 'access-matrix.feature.import-from-testcenter',
        minAccessLevel: 3
      },
      {
        featureKey: 'exclude-persons',
        translationKey: 'access-matrix.feature.exclude-persons',
        minAccessLevel: 3
      },
      {
        featureKey: 'view-resource-packages',
        translationKey: 'access-matrix.feature.view-resource-packages',
        minAccessLevel: 3
      },
      {
        featureKey: 'delete-resource-packages',
        translationKey: 'access-matrix.feature.delete-resource-packages',
        minAccessLevel: 3
      },
      {
        featureKey: 'view-unit-info',
        translationKey: 'access-matrix.feature.view-unit-info',
        minAccessLevel: 3
      },
      {
        featureKey: 'manage-unit-tags',
        translationKey: 'access-matrix.feature.manage-unit-tags',
        minAccessLevel: 3
      },
      {
        featureKey: 'manage-unit-notes',
        translationKey: 'access-matrix.feature.manage-unit-notes',
        minAccessLevel: 3
      },
      {
        featureKey: 'view-booklet-info',
        translationKey: 'access-matrix.feature.view-booklet-info',
        minAccessLevel: 3
      }
    ];

    return {
      categoryKey: 'test-files',
      translationKey: 'access-matrix.category.test-files',
      features
    };
  }

  /**
   * Test Results category permissions
   */
  private getTestResultsCategory(): FeatureCategoryDto {
    const features: FeaturePermissionDto[] = [
      {
        featureKey: 'view-test-results',
        translationKey: 'access-matrix.feature.view-test-results',
        minAccessLevel: 3
      },
      {
        featureKey: 'view-responses',
        translationKey: 'access-matrix.feature.view-responses',
        minAccessLevel: 3
      },
      {
        featureKey: 'view-logs',
        translationKey: 'access-matrix.feature.view-logs',
        minAccessLevel: 3
      },
      {
        featureKey: 'upload-test-results',
        translationKey: 'access-matrix.feature.upload-test-results',
        minAccessLevel: 3
      },
      {
        featureKey: 'delete-test-results',
        translationKey: 'access-matrix.feature.delete-test-results',
        minAccessLevel: 3
      },
      {
        featureKey: 'export-database',
        translationKey: 'access-matrix.feature.export-database',
        minAccessLevel: 3
      },
      {
        featureKey: 'clean-responses',
        translationKey: 'access-matrix.feature.clean-responses',
        minAccessLevel: 3
      },
      {
        featureKey: 'view-replay-statistics',
        translationKey: 'access-matrix.feature.view-replay-statistics',
        minAccessLevel: 3
      },
      {
        featureKey: 'manage-variable-analysis',
        translationKey: 'access-matrix.feature.manage-variable-analysis',
        minAccessLevel: 3
      }
    ];

    return {
      categoryKey: 'test-results',
      translationKey: 'access-matrix.category.test-results',
      features
    };
  }

  /**
   * Coding category permissions
   */
  private getCodingCategory(): FeatureCategoryDto {
    const features: FeaturePermissionDto[] = [
      {
        featureKey: 'view-coding-jobs',
        translationKey: 'access-matrix.feature.view-coding-jobs',
        minAccessLevel: 1
      },
      {
        featureKey: 'work-on-coding-jobs',
        translationKey: 'access-matrix.feature.work-on-coding-jobs',
        minAccessLevel: 1
      },
      {
        featureKey: 'view-all-jobs',
        translationKey: 'access-matrix.feature.view-all-jobs',
        minAccessLevel: 2
      },
      {
        featureKey: 'create-job-definitions',
        translationKey: 'access-matrix.feature.create-job-definitions',
        minAccessLevel: 2
      },
      {
        featureKey: 'edit-job-definitions',
        translationKey: 'access-matrix.feature.edit-job-definitions',
        minAccessLevel: 2
      },
      {
        featureKey: 'delete-job-definitions',
        translationKey: 'access-matrix.feature.delete-job-definitions',
        minAccessLevel: 2
      },
      {
        featureKey: 'manage-missings-profiles',
        translationKey: 'access-matrix.feature.manage-missings-profiles',
        minAccessLevel: 3
      },
      {
        featureKey: 'export-coding-data',
        translationKey: 'access-matrix.feature.export-coding-data',
        minAccessLevel: 2
      },
      {
        featureKey: 'import-external-codings',
        translationKey: 'access-matrix.feature.import-external-codings',
        minAccessLevel: 2
      },
      {
        featureKey: 'validate-coding-completeness',
        translationKey: 'access-matrix.feature.validate-coding-completeness',
        minAccessLevel: 2
      },
      {
        featureKey: 'apply-job-results',
        translationKey: 'access-matrix.feature.apply-job-results',
        minAccessLevel: 3
      },
      {
        featureKey: 'manage-variable-bundles',
        translationKey: 'access-matrix.feature.manage-variable-bundles',
        minAccessLevel: 2
      }
    ];

    return {
      categoryKey: 'coding',
      translationKey: 'access-matrix.category.coding',
      features
    };
  }

  /**
   * Users category permissions
   */
  private getUsersCategory(): FeatureCategoryDto {
    const features: FeaturePermissionDto[] = [
      {
        featureKey: 'view-workspace-users',
        translationKey: 'access-matrix.feature.view-workspace-users',
        minAccessLevel: 3
      },
      {
        featureKey: 'manage-user-access',
        translationKey: 'access-matrix.feature.manage-user-access',
        minAccessLevel: 3
      }
    ];

    return {
      categoryKey: 'users',
      translationKey: 'access-matrix.category.users',
      features
    };
  }

  /**
   * Settings category permissions
   */
  private getSettingsCategory(): FeatureCategoryDto {
    const features: FeaturePermissionDto[] = [
      {
        featureKey: 'view-workspace-settings',
        translationKey: 'access-matrix.feature.view-workspace-settings',
        minAccessLevel: 3
      },
      {
        featureKey: 'edit-workspace-settings',
        translationKey: 'access-matrix.feature.edit-workspace-settings',
        minAccessLevel: 3
      },
      {
        featureKey: 'delete-workspace',
        translationKey: 'access-matrix.feature.delete-workspace',
        minAccessLevel: 3
      },
      {
        featureKey: 'view-journal',
        translationKey: 'access-matrix.feature.view-journal',
        minAccessLevel: 3
      },
      {
        featureKey: 'manage-access-tokens',
        translationKey: 'access-matrix.feature.manage-access-tokens',
        minAccessLevel: 3
      },
      {
        featureKey: 'manage-coding-settings',
        translationKey: 'access-matrix.feature.manage-coding-settings',
        minAccessLevel: 3
      }
    ];

    return {
      categoryKey: 'settings',
      translationKey: 'access-matrix.category.settings',
      features
    };
  }
}
