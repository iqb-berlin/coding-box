import { Injectable, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { firstValueFrom } from 'rxjs';
import { BackendService } from '../../services/backend.service';
import {
  Code, VariableCoding, CodingScheme, CodeSelectedEvent
} from '../../coding/components/code-selector/code-selector.component';
import { MissingDto } from '../../../../../../api-dto/coding/missings-profiles.dto';
import { UnitsReplay, UnitsReplayUnit } from '../../services/units-replay.service';

interface SavedCode {
  id: number;
  code: string;
  label: string;
  score?: number;
  description?: string;
  [key: string]: unknown;
}

@Injectable({
  providedIn: 'root'
})
export class ReplayCodingService {
  private backendService = inject(BackendService);
  private translate = inject(TranslateService);
  private snackBar = inject(MatSnackBar);

  // Coding state properties
  codingScheme: CodingScheme | null = null;
  currentVariableId: string = '';
  missings: MissingDto[] = [];
  codingJobId: number | null = null;
  selectedCodes: Map<string, SavedCode> = new Map(); // Track selected codes
  openSelections: Set<string> = new Set(); // Track open selections
  notes: Map<string, string> = new Map(); // Track coder notes
  isPausingJob: boolean = false;
  isCodingJobCompleted: boolean = false;
  isCodingJobPaused: boolean = false;
  isSubmittingJob: boolean = false;
  isResumingJob: boolean = false;

  resetCodingData() {
    this.codingScheme = null;
    this.currentVariableId = '';
    this.missings = [];
    this.codingJobId = null;
    this.selectedCodes.clear();
    this.openSelections.clear();
    this.isPausingJob = false;
    this.isCodingJobCompleted = false;
    this.isSubmittingJob = false;
  }

  async updateCodingJobStatus(workspaceId: number, jobId: number, status: 'active' | 'paused' | 'completed' | 'open') {
    return firstValueFrom(
      this.backendService.updateCodingJob(workspaceId, jobId, { status })
    );
  }

  setCodingSchemeFromVocsData(vocsData: string) {
    try {
      this.codingScheme = JSON.parse(vocsData);
    } catch (error) {
      this.codingScheme = null;
    }
  }

  async loadSavedCodingProgress(workspaceId: number, jobId: number): Promise<void> {
    if (!jobId || !workspaceId) return;

    try {
      this.selectedCodes.clear();
      this.openSelections.clear();
      const savedProgress = await firstValueFrom(
        this.backendService.getCodingProgress(workspaceId, jobId)
      ) as { [key: string]: SavedCode };

      Object.keys(savedProgress).forEach(compositeKey => {
        const partialCode = savedProgress[compositeKey];
        if (compositeKey.endsWith(':open') && partialCode?.label === 'OPEN') {
          const actualKey = compositeKey.slice(0, -5); // Remove ':open' suffix
          this.openSelections.add(actualKey);
        } else if (partialCode?.id && partialCode.id !== -1) {
          const fullCode = this.findCodeById(partialCode.id);
          const toStore: SavedCode = fullCode ? this.convertCodeToSavedCode(fullCode) : partialCode;
          this.selectedCodes.set(compositeKey, toStore);
        }
      });

      const savedNotes = await firstValueFrom(
        this.backendService.getCodingNotes(workspaceId, jobId)
      );
      if (savedNotes) {
        this.notes.clear();
        Object.keys(savedNotes).forEach(key => {
          this.notes.set(key, savedNotes[key]);
        });
      }
    } catch (error) {
      // Ignore errors when loading saved coding progress
    }
  }

  async loadCodingJobMissings(workspaceId: number, jobId: number): Promise<void> {
    if (!jobId || !workspaceId) return;

    try {
      const codingJob = await firstValueFrom(
        this.backendService.getCodingJob(workspaceId, jobId)
      );
      if (codingJob.missings_profile_id) {
        try {
          const profile = await firstValueFrom(
            this.backendService.getMissingsProfileDetails(workspaceId, codingJob.missings_profile_id.toString())
          );
          if (profile) {
            const parsed = JSON.parse(profile.missings);
            this.missings = Array.isArray(parsed) ? parsed : [];
          }
        } catch (idError) {
          try {
            const profiles = await firstValueFrom(
              this.backendService.getMissingsProfiles(workspaceId)
            );
            const matchingProfile = profiles.find(p => p.id === codingJob.missings_profile_id);
            if (matchingProfile) {
              const profileDetails = await firstValueFrom(
                this.backendService.getMissingsProfileDetails(workspaceId, matchingProfile.label)
              );
              if (profileDetails) {
                this.missings = profileDetails.parseMissings();
              }
            }
          } catch (fallbackError) {
            // Ignore errors when loading missings
          }
        }
      }
    } catch (error) {
      // Ignore errors when loading coding job missings
    }
  }

  findCodeById(codeId: number): Code | null {
    if (!this.codingScheme || typeof this.codingScheme === 'string') {
      return null;
    }

    const variableCoding = this.codingScheme.variableCodings?.find((v: VariableCoding) => v.alias === this.currentVariableId);
    if (variableCoding) {
      return variableCoding.codes?.find((c: Code) => c.id === codeId) || null;
    }

    return null;
  }

  private convertCodeToSavedCode(code: Code): SavedCode {
    return {
      id: code.id,
      code: String(code.id),
      label: code.label,
      score: code.score
    };
  }

  async saveCodingProgress(
    workspaceId: number,
    jobId: number,
    testPerson: string,
    unitId: string,
    variableId: string,
    selectedCode: SavedCode
  ): Promise<void> {
    if (!jobId || !workspaceId) return;

    try {
      // Determine if this is a missing code (missing codes have a 'code' property as number)
      const isMissingCode = typeof selectedCode.code === 'number';
      const codeToSave = {
        id: isMissingCode ? Number(selectedCode.code) : selectedCode.id,
        code: String(selectedCode.code),
        label: selectedCode.label || '',
        ...(selectedCode.score !== undefined && { score: selectedCode.score })
      };

      await firstValueFrom(
        this.backendService.saveCodingProgress(workspaceId, jobId, {
          testPerson,
          unitId,
          variableId,
          selectedCode: codeToSave
        })
      );
    } catch (error) {
      // Ignore errors when saving coding progress
    }
  }

  async saveAllCodingProgress(workspaceId: number, jobId: number): Promise<void> {
    if (!jobId || !workspaceId) return;

    const savePromises: Promise<void>[] = [];

    for (const [compositeKey, selectedCode] of this.selectedCodes) {
      const parts = compositeKey.split('::');
      if (parts.length >= 4) {
        const testPerson = parts[0];
        const unitId = parts[2];
        const variableId = parts[3];

        savePromises.push(this.saveCodingProgress(workspaceId, jobId, testPerson, unitId, variableId, selectedCode));
      }
    }

    for (const compositeKey of this.openSelections) {
      const parts = compositeKey.split('::');
      if (parts.length >= 4) {
        const testPerson = parts[0];
        const unitId = parts[2];
        const variableId = parts[3];

        savePromises.push(this.saveOpenSelection(workspaceId, testPerson, unitId, variableId, true));
      }
    }

    await Promise.allSettled(savePromises);
  }

  async saveOpenSelection(
    workspaceId: number,
    testPerson: string,
    unitId: string,
    variableId: string,
    isOpen: boolean
  ): Promise<void> {
    if (!this.codingJobId || !workspaceId) return;

    try {
      await firstValueFrom(
        this.backendService.saveCodingProgress(workspaceId, this.codingJobId, {
          testPerson,
          unitId,
          variableId,
          selectedCode: { id: -1, code: '', label: '' }, // Special marker for open state
          isOpen
        })
      );
    } catch (error) {
      // Ignore errors when saving open selection
    }
  }

  async handleCodeSelected(
    event: CodeSelectedEvent,
    testPerson: string,
    unitId: string,
    workspaceId: number,
    unitsData: UnitsReplay | null
  ): Promise<void> {
    const compositeKey = this.generateCompositeKey(testPerson, unitId, event.variableId);
    let normalizedCode: SavedCode;
    if ('code' in event.code) {
      const missing = event.code;
      normalizedCode = {
        id: missing.code,
        code: String(missing.code),
        label: missing.label,
        description: missing.description
      };
    } else {
      const code = event.code;
      normalizedCode = {
        id: code.id,
        code: String(code.id),
        label: code.label,
        score: code.score
      };
    }
    this.selectedCodes.set(compositeKey, normalizedCode);
    this.openSelections.delete(compositeKey); // Remove from open if coded

    if (this.codingJobId) {
      await this.saveCodingProgress(workspaceId, this.codingJobId, testPerson, unitId, event.variableId, normalizedCode);
    }

    this.checkCodingJobCompletion(unitsData);
  }

  handleOpenChanged(
    isOpen: boolean,
    testPerson: string,
    unitId: string,
    workspaceId: number,
    unitsData: UnitsReplay | null
  ): void {
    const compositeKey = this.generateCompositeKey(testPerson, unitId, this.currentVariableId);
    if (isOpen) {
      this.openSelections.add(compositeKey);
      this.selectedCodes.delete(compositeKey); // Clear any selected code
      this.saveOpenSelection(workspaceId, testPerson, unitId, this.currentVariableId, true);
    } else {
      this.openSelections.delete(compositeKey);
      this.saveOpenSelection(workspaceId, testPerson, unitId, this.currentVariableId, false);
    }
    this.checkCodingJobCompletion(unitsData);
  }

  generateCompositeKey(testPerson: string, unitId: string, variableId: string): string {
    let bookletId = 'default';
    if (testPerson) {
      const parts = testPerson.split('@');
      if (parts.length >= 3) {
        bookletId = parts[2];
      }
    }

    return `${testPerson}::${bookletId}::${unitId}::${variableId}`;
  }

  checkCodingJobCompletion(unitsData: UnitsReplay | null): void {
    if (!unitsData || !unitsData.units || unitsData.units.length === 0) return;

    const totalReplays = unitsData.units.length;
    const completedReplays = this.getCompletedCount(unitsData);

    const progressPercentage = Math.round((completedReplays / totalReplays) * 100);
    if (completedReplays > 0 && completedReplays % Math.ceil(totalReplays / 4) === 0) {
      this.showProgressNotification(progressPercentage, completedReplays, totalReplays);
    }

    // Check if job is complete
    if (completedReplays === totalReplays) {
      this.isCodingJobCompleted = true;
    }
  }

  showProgressNotification(percentage: number, completed: number, total: number): void {
    this.snackBar.open(
      this.translate.instant('replay.coding-progress-message', { completed, total, percentage }),
      this.translate.instant('replay.close'),
      { duration: 3000, panelClass: ['snackbar-info'] }
    );
  }

  getCompletedCount(unitsData: UnitsReplay | null): number {
    if (!unitsData) return 0;
    return unitsData.units.filter((unit: UnitsReplayUnit) => {
      if (unit.variableId) {
        const compositeKey = this.generateCompositeKey(
          unit.testPerson || '',
          unit.name || '',
          unit.variableId
        );
        return this.selectedCodes.has(compositeKey) || this.openSelections.has(compositeKey);
      }
      return false;
    }).length;
  }

  getOpenCount(unitsData: UnitsReplay | null): number {
    if (!unitsData) return 0;
    return unitsData.units.filter((unit: UnitsReplayUnit) => {
      if (unit.variableId) {
        const compositeKey = this.generateCompositeKey(
          unit.testPerson || '',
          unit.name || '',
          unit.variableId
        );
        return this.openSelections.has(compositeKey);
      }
      return false;
    }).length;
  }

  getProgressPercentage(unitsData: UnitsReplay | null): number {
    if (!unitsData || !unitsData.units || unitsData.units.length === 0) return 0;
    return Math.round((this.getCompletedCount(unitsData) / unitsData.units.length) * 100);
  }

  getPreSelectedCodeId(testPerson: string, unitId: string, variableId: string): number | null {
    const compositeKey = this.generateCompositeKey(testPerson, unitId, variableId);
    const selectedCode = this.selectedCodes.get(compositeKey);
    return selectedCode ? selectedCode.id : null;
  }

  getNotes(testPerson: string, unitId: string, variableId: string): string {
    const compositeKey = this.generateCompositeKey(testPerson, unitId, variableId);
    return this.notes.get(compositeKey) || '';
  }

  async saveNotes(
    workspaceId: number,
    testPerson: string,
    unitId: string,
    variableId: string,
    notes: string
  ): Promise<void> {
    if (!this.codingJobId || !workspaceId) return;

    try {
      const compositeKey = this.generateCompositeKey(testPerson, unitId, variableId);
      if (notes.trim()) {
        this.notes.set(compositeKey, notes);
      } else {
        this.notes.delete(compositeKey);
      }

      await firstValueFrom(
        this.backendService.saveCodingProgress(workspaceId, this.codingJobId, {
          testPerson,
          unitId,
          variableId,
          selectedCode: { id: -1, code: '', label: '' },
          notes: notes.trim() || undefined
        })
      );
    } catch (error) {
      // Ignore errors when saving notes
    }
  }

  async loadCurrentJobStatus(workspaceId: number, jobId: number): Promise<void> {
    if (!jobId || !workspaceId) return;

    try {
      const codingJob = await firstValueFrom(
        this.backendService.getCodingJob(workspaceId, jobId)
      );
      this.isCodingJobPaused = codingJob.status === 'paused';
      this.isCodingJobCompleted = codingJob.status === 'completed';
    } catch (error) {
      // Ignore errors when loading job status
    }
  }

  async pauseCodingJob(workspaceId: number, jobId: number): Promise<void> {
    if (!jobId || !workspaceId) return;

    this.isPausingJob = true;
    this.snackBar.open(this.translate.instant('replay.pausing-coding-job'), '', { duration: 2000 });

    try {
      await this.updateCodingJobStatus(workspaceId, jobId, 'paused');
      this.isCodingJobPaused = true;
      this.isPausingJob = false;
      this.snackBar.open(this.translate.instant('replay.coding-job-paused-successfully'), this.translate.instant('replay.close'), {
        duration: 3000,
        panelClass: ['snackbar-success']
      });
    } catch (error) {
      this.isPausingJob = false;
      this.snackBar.open(this.translate.instant('replay.failed-to-pause-coding-job'), this.translate.instant('replay.close'), {
        duration: 3000,
        panelClass: ['snackbar-error']
      });
    }
  }

  async resumeCodingJob(workspaceId: number, jobId: number): Promise<void> {
    if (!jobId || !workspaceId) return;

    this.isResumingJob = true;
    this.snackBar.open(this.translate.instant('replay.resuming-coding-job'), '', { duration: 2000 });

    try {
      await this.updateCodingJobStatus(workspaceId, jobId, 'active');
      this.isCodingJobPaused = false;
      this.isResumingJob = false;
      this.snackBar.open(this.translate.instant('replay.coding-job-resumed-successfully'), this.translate.instant('replay.close'), {
        duration: 3000,
        panelClass: ['snackbar-success']
      });
    } catch (error) {
      this.isResumingJob = false;
      this.snackBar.open(this.translate.instant('replay.failed-to-resume-coding-job'), this.translate.instant('replay.close'), {
        duration: 3000,
        panelClass: ['snackbar-error']
      });
    }
  }

  async submitCodingJob(workspaceId: number, jobId: number): Promise<void> {
    if (!jobId || !workspaceId) return;

    this.isSubmittingJob = true;
    this.snackBar.open(this.translate.instant('replay.submitting-coding-job'), '', { duration: 2000 });

    try {
      await this.updateCodingJobStatus(workspaceId, jobId, 'completed');
      this.isSubmittingJob = false;
      this.snackBar.open(this.translate.instant('replay.coding-job-submitted-successfully'), this.translate.instant('replay.close'), {
        duration: 3000,
        panelClass: ['snackbar-success']
      });
      window.close();
    } catch (error) {
      this.isSubmittingJob = false;
      this.snackBar.open(this.translate.instant('replay.failed-to-submit-coding-job'), this.translate.instant('replay.close'), {
        duration: 3000,
        panelClass: ['snackbar-error']
      });
    }
  }

  findFirstUncodedUnitIndex(unitsData: UnitsReplay | null): number {
    if (!unitsData) return -1;

    for (let i = 0; i < unitsData.units.length; i++) {
      const unit: UnitsReplayUnit = unitsData.units[i];

      if (unit.variableId) {
        const compositeKey = this.generateCompositeKey(
          unit.testPerson || '',
          unit.name,
          unit.variableId
        );

        if (!this.selectedCodes.has(compositeKey) && !this.openSelections.has(compositeKey)) {
          return i;
        }
      }
    }

    // If all units are coded, return -1
    return -1;
  }
}
