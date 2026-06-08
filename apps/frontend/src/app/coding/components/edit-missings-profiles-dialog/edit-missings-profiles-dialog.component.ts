import { Component, Inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import {
  MAT_DIALOG_DATA,
  MatDialogModule,
  MatDialogRef
} from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatListModule } from '@angular/material/list';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { MissingsProfileService } from '../../services/missings-profile.service';
import { AppService } from '../../../core/services/app.service';
import { MissingDto, MissingsProfilesDto } from '../../../../../../../api-dto/coding/missings-profiles.dto';

@Component({
  selector: 'app-edit-missings-profiles-dialog',
  templateUrl: './edit-missings-profiles-dialog.component.html',
  styleUrls: ['./edit-missings-profiles-dialog.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    MatButtonModule,
    MatCardModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatListModule,
    MatSnackBarModule,
    MatTableModule,
    MatTooltipModule,
    TranslateModule
  ]
})
export class EditMissingsProfilesDialogComponent implements OnInit {
  private readonly requiredMissingIds = ['mir', 'mci'];

  missingsProfiles: { label: string; id: number }[] = [];
  selectedProfile: MissingsProfilesDto | null = null;
  editMode = false;
  loading = false;
  saving = false;
  editMissings: MissingDto[] = [];
  displayedColumns: string[] = ['id', 'label', 'description', 'code', 'score', 'actions'];

  constructor(
    public dialogRef: MatDialogRef<EditMissingsProfilesDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: { workspaceId: number },
    private missingsProfileService: MissingsProfileService,
    private appService: AppService,
    private snackBar: MatSnackBar,
    private translateService: TranslateService
  ) { }

  ngOnInit(): void {
    this.loadMissingsProfiles();
  }

  loadMissingsProfiles(): void {
    const workspaceId = this.data.workspaceId;
    if (workspaceId) {
      this.loading = true;
      this.missingsProfileService.getMissingsProfiles(workspaceId).subscribe({
        next: profiles => {
          this.missingsProfiles = profiles;
          this.loading = false;
          // Auto-select IQB-Standard profile if it exists
          const iqbStandardProfile = profiles.find(p => p.label === 'IQB-Standard');
          if (iqbStandardProfile) {
            this.selectProfile('IQB-Standard');
          }
        },
        error: () => {
          this.loading = false;
          this.snackBar.open(this.translateService.instant('workspace.error-loading-missings-profiles'), this.translateService.instant('close'), { duration: 3000 });
        }
      });
    }
  }

  selectProfile(label: string): void {
    const workspaceId = this.data.workspaceId;
    if (workspaceId) {
      const profile = this.missingsProfiles.find(p => p.label === label);
      if (profile) {
        this.loading = true;
        this.missingsProfileService.getMissingsProfileDetails(workspaceId, profile.id).subscribe({
          next: profileDetails => {
            const missingsProfile = new MissingsProfilesDto();
            if (profileDetails) {
              missingsProfile.id = profileDetails.id;
              missingsProfile.label = profileDetails.label;
              missingsProfile.missings = profileDetails.missings;
            }
            this.selectedProfile = missingsProfile;
            this.loading = false;
          },
          error: () => {
            this.loading = false;
            this.snackBar.open(this.translateService.instant('workspace.error-loading-missings-profile-details'), this.translateService.instant('close'), { duration: 3000 });
          }
        });
      }
    }
  }

  createProfile(): void {
    this.selectedProfile = new MissingsProfilesDto();
    this.selectedProfile.label = '';
    this.editMissings = this.createRequiredMissings();
    this.selectedProfile.setMissings(this.editMissings);
    this.editMode = true;
  }

  editProfile(): void {
    if (this.selectedProfile) {
      const missings = this.selectedProfile.parseMissings();
      this.editMissings = Array.isArray(missings) ? [...missings] : [];
    }
    this.editMode = true;
  }

  saveProfile(): void {
    const workspaceId = this.data.workspaceId;
    if (workspaceId && this.selectedProfile) {
      const missings = this.editMode ? this.editMissings : this.selectedProfile.parseMissings();
      if (!this.isProfileValid(missings)) {
        this.snackBar.open(this.translateService.instant('workspace.missing-validation-error'), this.translateService.instant('close'), { duration: 3000 });
        return;
      }

      if (this.editMode) {
        this.selectedProfile.setMissings(missings);
      }

      this.saving = true;

      const existingProfile = this.selectedProfile.id ?
        this.missingsProfiles.find(p => p.id === this.selectedProfile?.id) :
        undefined;

      if (this.selectedProfile.id && !existingProfile) {
        this.saving = false;
        this.snackBar.open(this.translateService.instant('workspace.error-updating-missings-profile'), this.translateService.instant('close'), { duration: 3000 });
        return;
      }

      if (existingProfile) {
        this.missingsProfileService.updateMissingsProfile(workspaceId, existingProfile.label, this.selectedProfile).subscribe({
          next: profile => {
            if (!profile) {
              this.saving = false;
              this.snackBar.open(this.translateService.instant('workspace.error-updating-missings-profile'), this.translateService.instant('close'), { duration: 3000 });
              return;
            }
            const missingsProfile = new MissingsProfilesDto();
            missingsProfile.id = profile.id;
            missingsProfile.label = profile.label;
            missingsProfile.missings = profile.missings;
            this.selectedProfile = missingsProfile;
            this.saving = false;
            this.editMode = false;
            this.loadMissingsProfiles();
            this.snackBar.open(this.translateService.instant('workspace.profile-updated-successfully'), this.translateService.instant('close'), { duration: 3000 });
          },
          error: () => {
            this.saving = false;
            this.snackBar.open(this.translateService.instant('workspace.error-updating-missings-profile'), this.translateService.instant('close'), { duration: 3000 });
          }
        });
      } else {
        this.missingsProfileService.createMissingsProfile(workspaceId, this.selectedProfile).subscribe({
          next: profile => {
            if (!profile) {
              this.saving = false;
              this.snackBar.open(this.translateService.instant('workspace.error-creating-missings-profile'), this.translateService.instant('close'), { duration: 3000 });
              return;
            }
            const missingsProfile = new MissingsProfilesDto();
            missingsProfile.id = profile.id;
            missingsProfile.label = profile.label;
            missingsProfile.missings = profile.missings;
            this.selectedProfile = missingsProfile;
            this.saving = false;
            this.editMode = false;
            this.loadMissingsProfiles();
            this.snackBar.open(this.translateService.instant('workspace.profile-created-successfully'), this.translateService.instant('close'), { duration: 3000 });
          },
          error: () => {
            this.saving = false;
            this.snackBar.open(this.translateService.instant('workspace.error-creating-missings-profile'), this.translateService.instant('close'), { duration: 3000 });
          }
        });
      }
    }
  }

  deleteProfile(): void {
    const workspaceId = this.data.workspaceId;
    if (workspaceId && this.selectedProfile) {
      this.saving = true;
      this.missingsProfileService.deleteMissingsProfile(workspaceId, this.selectedProfile.label).subscribe({
        next: success => {
          if (success) {
            this.selectedProfile = null;
            this.saving = false;
            this.editMode = false;
            this.loadMissingsProfiles();
            this.snackBar.open('Profile deleted successfully', 'Close', { duration: 3000 });
          } else {
            this.saving = false;
            this.snackBar.open('Error deleting missings profile', 'Close', { duration: 3000 });
          }
        },
        error: () => {
          this.saving = false;
          this.snackBar.open('Error deleting missings profile', 'Close', { duration: 3000 });
        }
      });
    }
  }

  cancelEdit(): void {
    this.editMode = false;

    // If this was a new profile, clear the selection
    if (!this.missingsProfiles.find(p => p.label === this.selectedProfile?.label)) {
      this.selectedProfile = null;
    }
  }

  addMissing(): void {
    const missings = this.editMode ? this.editMissings : (this.selectedProfile?.parseMissings() || []);

    missings.push({
      id: `missing-${Date.now()}`,
      label: 'New Missing',
      description: 'Description',
      code: this.getNextNegativeMissingCode(missings),
      score: 0
    });

    if (this.editMode) {
      this.editMissings = [...missings];
    } else if (this.selectedProfile) {
      this.selectedProfile.setMissings(missings);
    }
  }

  removeMissing(index: number): void {
    if (this.editMode) {
      const missings = [...this.editMissings];
      missings.splice(index, 1);
      this.editMissings = missings;
    } else if (this.selectedProfile) {
      const missings = this.selectedProfile.parseMissings();
      missings.splice(index, 1);
      this.selectedProfile.setMissings(missings);
    }
  }

  getMissings(): MissingDto[] {
    if (!this.selectedProfile) {
      return [];
    }

    try {
      const missings = this.selectedProfile.parseMissings();
      if (!Array.isArray(missings)) {
        return [];
      }
      return missings.filter(missing => missing.id !== undefined && missing.id !== null &&
        missing.id.trim() !== '' && missing.label !== undefined && missing.label !== null &&
        missing.label.trim() !== '' && missing.description !== undefined && missing.description !== null &&
        this.hasExplicitFiniteNumber(missing.code) &&
        this.hasExplicitFiniteNumber(missing.score));
    } catch (error) {
      // Error occurred while parsing missings
      return [];
    }
  }

  private hasExplicitFiniteNumber(value: unknown): boolean {
    if (typeof value === 'number') {
      return Number.isFinite(value);
    }

    if (typeof value === 'string') {
      const trimmedValue = value.trim();
      return trimmedValue !== '' && Number.isFinite(Number(trimmedValue));
    }

    return false;
  }

  private isValidMissingCode(code: unknown): boolean {
    const numericCode = Number(code);
    return this.hasExplicitFiniteNumber(code) &&
      Number.isInteger(numericCode) &&
      numericCode < 0;
  }

  private getNextNegativeMissingCode(missings: MissingDto[]): number {
    const negativeCodes = missings
      .map(missing => Number(missing.code))
      .filter(code => Number.isInteger(code) && code < 0);

    if (negativeCodes.length === 0) {
      return -1;
    }

    return Math.min(...negativeCodes) - 1;
  }

  private createRequiredMissings(): MissingDto[] {
    return [
      {
        id: 'mir',
        label: 'missing invalid response',
        description: '',
        code: -98,
        score: 0
      },
      {
        id: 'mci',
        label: 'missing coding impossible',
        description: '',
        code: -97,
        score: 0
      }
    ];
  }

  private isNonBlankString(value: unknown): value is string {
    return typeof value === 'string' && value.trim() !== '';
  }

  close(): void {
    this.dialogRef.close();
  }

  isProfileValid(missings: MissingDto[]): boolean {
    const ids = new Set<string>();
    const codes = new Set<number>();

    for (const missing of missings) {
      if (!this.isNonBlankString(missing.id) ||
        !this.isNonBlankString(missing.label) ||
        missing.description === undefined || missing.description === null ||
        !this.isValidMissingCode(missing.code) ||
        !this.hasExplicitFiniteNumber(missing.score)) {
        return false;
      }

      const id = missing.id.trim();
      const code = Number(missing.code);
      if (ids.has(id) || codes.has(code)) {
        return false;
      }
      ids.add(id);
      codes.add(code);
    }

    return this.requiredMissingIds.every(requiredId => ids.has(requiredId));
  }
}
