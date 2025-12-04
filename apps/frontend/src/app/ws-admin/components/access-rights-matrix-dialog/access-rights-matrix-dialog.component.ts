import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatTableModule } from '@angular/material/table';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { TranslateModule } from '@ngx-translate/core';
import { WorkspaceService } from '../../../services/workspace.service';
import { AccessLevelDto } from '../../../../../../../api-dto/workspaces/access-level-dto';
import { FeatureCategoryDto } from '../../../../../../../api-dto/workspaces/feature-category-dto';
import { AccessRightsMatrixDto } from '../../../../../../../api-dto/workspaces/access-rights-matrix-dto';

interface MatrixRow {
  featureKey: string;
  translationKey: string;
  isCategory: boolean;
  categoryKey?: string;
  permissions: { [level: number]: boolean };
}

@Component({
  selector: 'coding-box-access-rights-matrix-dialog',
  templateUrl: './access-rights-matrix-dialog.component.html',
  styleUrls: ['./access-rights-matrix-dialog.component.scss'],
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatTableModule,
    MatIconModule,
    MatProgressSpinnerModule,
    TranslateModule
  ]
})
export class AccessRightsMatrixDialogComponent implements OnInit {
  private workspaceService = inject(WorkspaceService);

  matrix: AccessRightsMatrixDto | null = null;
  loading = true;
  displayedColumns: string[] = [];
  dataSource: MatrixRow[] = [];
  levels: AccessLevelDto[] = [];

  ngOnInit(): void {
    this.workspaceService.getAccessRightsMatrix().subscribe(matrix => {
      this.matrix = matrix;
      this.levels = matrix.levels;
      this.displayedColumns = ['feature', ...matrix.levels.map((l: AccessLevelDto) => `level-${l.level}`)];
      this.dataSource = this.buildDataSource(matrix.categories);
      this.loading = false;
    });
  }

  private buildDataSource(categories: FeatureCategoryDto[]): MatrixRow[] {
    const rows: MatrixRow[] = [];

    categories.forEach(category => {
      // Add category header row
      rows.push({
        featureKey: category.categoryKey,
        translationKey: category.translationKey,
        isCategory: true,
        categoryKey: category.categoryKey,
        permissions: {}
      });

      // Add feature rows
      category.features.forEach((feature: { featureKey: string; translationKey: string; minAccessLevel: number }) => {
        const permissions: { [level: number]: boolean } = {};
        this.levels.forEach(level => {
          permissions[level.level] = level.level >= feature.minAccessLevel;
        });

        rows.push({
          featureKey: feature.featureKey,
          translationKey: feature.translationKey,
          isCategory: false,
          categoryKey: category.categoryKey,
          permissions
        });
      });
    });

    return rows;
  }

  hasPermission(row: MatrixRow, level: number): boolean {
    return row.permissions[level] || false;
  }
}
