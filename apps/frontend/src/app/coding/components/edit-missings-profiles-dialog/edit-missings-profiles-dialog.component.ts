import {
  Component, Inject, OnInit, signal, ChangeDetectionStrategy
} from '@angular/core';

import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
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
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-edit-missings-profiles-dialog',
  templateUrl: './edit-missings-profiles-dialog.component.html',
  styleUrls: ['./edit-missings-profiles-dialog.component.scss'],
  standalone: true,
  imports: [
    FormsModule,
    ReactiveFormsModule,
    MatButtonModule,
    MatCardModule,
    MatCheckboxModule,
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

  readonly missingsProfiles = signal<{
    label: string;
    id: number;
  }[]>([]);

  readonly selectedProfile = signal<MissingsProfilesDto | null>(null);
  readonly editMode = signal(false);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly editMissings = signal<MissingDto[]>([]);
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
      this.loading.set(true);
      this.missingsProfileService.getMissingsProfiles(workspaceId).subscribe({
        next: profiles => {
          this.missingsProfiles.set(profiles);
          this.loading.set(false);
          // Auto-select IQB-Standard profile if it exists
          const iqbStandardProfile = profiles.find(p => p.label === 'IQB-Standard');
          if (iqbStandardProfile) {
            this.selectProfile('IQB-Standard');
          }
        },
        error: () => {
          this.loading.set(false);
          this.snackBar.open(this.translateService.instant('workspace.error-loading-missings-profiles'), this.translateService.instant('close'), { duration: 3000 });
        }
      });
    }
  }

  selectProfile(label: string): void {
    const workspaceId = this.data.workspaceId;
    if (workspaceId) {
      const profile = this.missingsProfiles().find(p => p.label === label);
      if (profile) {
        this.loading.set(true);
        this.missingsProfileService.getMissingsProfileDetails(workspaceId, profile.id).subscribe({
          next: profileDetails => {
            const missingsProfile = new MissingsProfilesDto();
            if (profileDetails) {
              missingsProfile.id = profileDetails.id;
              missingsProfile.label = profileDetails.label;
              missingsProfile.missings = profileDetails.missings;
            }
            this.selectedProfile.set(missingsProfile);
            this.loading.set(false);
          },
          error: () => {
            this.loading.set(false);
            this.snackBar.open(this.translateService.instant('workspace.error-loading-missings-profile-details'), this.translateService.instant('close'), { duration: 3000 });
          }
        });
      }
    }
  }

  createProfile(): void {
    const profile = new MissingsProfilesDto();
    profile.label = '';
    const missings = this.createRequiredMissings();
    profile.setMissings(missings);
    this.editMissings.set(missings);
    this.selectedProfile.set(profile);
    this.editMode.set(true);
  }

  editProfile(): void {
    const selectedProfileValue = this.selectedProfile();

    if (selectedProfileValue) {
      const missings = selectedProfileValue.parseMissings();
      this.editMissings.set(Array.isArray(missings) ? missings.map(missing => ({ ...missing })) : []);
    }
    this.editMode.set(true);
  }

  saveProfile(): void {
    const currentProfile = this.selectedProfile();
    const workspaceId = this.data.workspaceId;
    if (workspaceId && currentProfile) {
      const selectedProfile = Object.assign(new MissingsProfilesDto(), currentProfile);
      const missings = this.editMode() ? this.editMissings() : selectedProfile.parseMissings();
      if (!this.isProfileValid(missings)) {
        this.snackBar.open(this.translateService.instant('workspace.missing-validation-error'), this.translateService.instant('close'), { duration: 3000 });
        return;
      }

      const normalizedMissings = this.normalizeMissingsForStorage(missings);

      if (this.editMode()) {
        selectedProfile.setMissings(normalizedMissings);
      }

      this.saving.set(true);

      const existingProfile = selectedProfile.id ?
        this.missingsProfiles().find(p => p.id === selectedProfile?.id) :
        undefined;

      if (selectedProfile.id && !existingProfile) {
        this.saving.set(false);
        this.snackBar.open(this.translateService.instant('workspace.error-updating-missings-profile'), this.translateService.instant('close'), { duration: 3000 });
        return;
      }

      if (existingProfile) {
        this.missingsProfileService.updateMissingsProfile(workspaceId, existingProfile.label, selectedProfile).subscribe({
          next: profile => {
            if (!profile) {
              this.saving.set(false);
              this.snackBar.open(this.translateService.instant('workspace.error-updating-missings-profile'), this.translateService.instant('close'), { duration: 3000 });
              return;
            }
            const missingsProfile = new MissingsProfilesDto();
            missingsProfile.id = profile.id;
            missingsProfile.label = profile.label;
            missingsProfile.missings = profile.missings;
            this.selectedProfile.set(missingsProfile);
            this.saving.set(false);
            this.editMode.set(false);
            this.loadMissingsProfiles();
            this.snackBar.open(this.translateService.instant('workspace.profile-updated-successfully'), this.translateService.instant('close'), { duration: 3000 });
          },
          error: () => {
            this.saving.set(false);
            this.snackBar.open(this.translateService.instant('workspace.error-updating-missings-profile'), this.translateService.instant('close'), { duration: 3000 });
          }
        });
      } else {
        this.missingsProfileService.createMissingsProfile(workspaceId, selectedProfile).subscribe({
          next: profile => {
            if (!profile) {
              this.saving.set(false);
              this.snackBar.open(this.translateService.instant('workspace.error-creating-missings-profile'), this.translateService.instant('close'), { duration: 3000 });
              return;
            }
            const missingsProfile = new MissingsProfilesDto();
            missingsProfile.id = profile.id;
            missingsProfile.label = profile.label;
            missingsProfile.missings = profile.missings;
            this.selectedProfile.set(missingsProfile);
            this.saving.set(false);
            this.editMode.set(false);
            this.loadMissingsProfiles();
            this.snackBar.open(this.translateService.instant('workspace.profile-created-successfully'), this.translateService.instant('close'), { duration: 3000 });
          },
          error: () => {
            this.saving.set(false);
            this.snackBar.open(this.translateService.instant('workspace.error-creating-missings-profile'), this.translateService.instant('close'), { duration: 3000 });
          }
        });
      }
    }
  }

  deleteProfile(): void {
    const selectedProfile = this.selectedProfile();
    const workspaceId = this.data.workspaceId;
    if (workspaceId && selectedProfile) {
      this.saving.set(true);
      this.missingsProfileService.deleteMissingsProfile(workspaceId, selectedProfile.label).subscribe({
        next: success => {
          if (success) {
            this.selectedProfile.set(null);
            this.saving.set(false);
            this.editMode.set(false);
            this.loadMissingsProfiles();
            this.snackBar.open('Profile deleted successfully', 'Close', { duration: 3000 });
          } else {
            this.saving.set(false);
            this.snackBar.open('Error deleting missings profile', 'Close', { duration: 3000 });
          }
        },
        error: () => {
          this.saving.set(false);
          this.snackBar.open('Error deleting missings profile', 'Close', { duration: 3000 });
        }
      });
    }
  }

  cancelEdit(): void {
    this.editMode.set(false);

    // If this was a new profile, clear the selection
    if (!this.missingsProfiles().find(p => p.label === this.selectedProfile()?.label)) {
      this.selectedProfile.set(null);
    }
  }

  addMissing(): void {
    const selectedProfileValue = this.selectedProfile();

    const missings = [...(this.editMode() ? this.editMissings() : (selectedProfileValue?.parseMissings() || []))];

    missings.push({
      id: `missing-${Date.now()}`,
      label: 'New Missing',
      description: 'Description',
      code: this.getNextNegativeMissingCode(missings),
      score: 0
    });

    if (this.editMode()) {
      this.editMissings.set([...missings]);
    } else if (selectedProfileValue) {
      const profile = Object.assign(new MissingsProfilesDto(), selectedProfileValue);
      profile.setMissings(missings);
      this.selectedProfile.set(profile);
    }
  }

  removeMissing(index: number): void {
    const selectedProfileValue = this.selectedProfile();

    if (this.editMode()) {
      const missings = [...this.editMissings()];
      missings.splice(index, 1);
      this.editMissings.set(missings);
    } else if (selectedProfileValue) {
      const missings = [...selectedProfileValue.parseMissings()];
      missings.splice(index, 1);
      const profile = Object.assign(new MissingsProfilesDto(), selectedProfileValue);
      profile.setMissings(missings);
      this.selectedProfile.set(profile);
    }
  }

  getMissings(): MissingDto[] {
    const selectedProfileValue = this.selectedProfile();

    if (!selectedProfileValue) {
      return [];
    }

    try {
      const missings = selectedProfileValue.parseMissings();
      if (!Array.isArray(missings)) {
        return [];
      }
      return missings.filter(missing => missing.id !== undefined && missing.id !== null &&
        missing.id.trim() !== '' && missing.label !== undefined && missing.label !== null &&
        missing.label.trim() !== '' && missing.description !== undefined && missing.description !== null &&
        this.hasExplicitFiniteNumber(missing.code) &&
        this.hasExplicitValidScore(missing.score));
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

  private hasExplicitValidScore(score: unknown): boolean {
    if (score === null) {
      return true;
    }

    return this.hasExplicitFiniteNumber(score);
  }

  private normalizeScore(score: unknown): number | null {
    if (score === null) {
      return null;
    }

    return Number(score);
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
        score: null
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
        !this.hasExplicitValidScore(missing.score)) {
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

  normalizeMissingsForStorage(missings: MissingDto[]): MissingDto[] {
    return missings.map(missing => ({
      id: missing.id.trim(),
      label: missing.label.trim(),
      description: String(missing.description),
      code: Number(missing.code),
      score: this.normalizeScore(missing.score)
    }));
  }

  isMissingScoreNa(missing: MissingDto): boolean {
    return missing.score === null;
  }

  setMissingScoreNa(missing: MissingDto | number, isNa: boolean): void {
    this.setMissingField(missing, 'score', isNa ? null : 0);
  }

  setMissingScore(missing: MissingDto | number, value: unknown): void {
    if (value === null || value === undefined || value === '') {
      this.setMissingField(missing, 'score', '');
      return;
    }

    const score = Number(value);
    this.setMissingField(missing, 'score', Number.isFinite(score) ? score : value);
  }

  setMissingField(missing: MissingDto | number, key: keyof MissingDto, value: unknown): void {
    this.editMissings.update(missings => {
      const index = typeof missing === 'number' ? missing : missings.indexOf(missing);
      return missings.map((candidate, candidateIndex) => (candidateIndex === index ?
        { ...candidate, [key]: value } as MissingDto : candidate));
    });
  }

  trackMissingRow(index: number): number {
    return index;
  }

  getScoreDisplay(score: number | null): string | number {
    return score === null ? 'NA' : score;
  }

  setSelectedProfileField<K extends keyof MissingsProfilesDto>(key: K, value: MissingsProfilesDto[K]): void {
    this.selectedProfile.update(current => (current ? Object.assign(new MissingsProfilesDto(), current, { [key]: value }) : current));
  }
}
