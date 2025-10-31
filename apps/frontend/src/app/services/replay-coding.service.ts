import { Injectable, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { firstValueFrom } from 'rxjs';
import { BackendService } from './backend.service';
import {
  Code, VariableCoding, CodingScheme, CodeSelectedEvent
} from '../models/coding-interfaces';
import { UnitsReplay, UnitsReplayUnit } from './units-replay.service';

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

  codingScheme: CodingScheme | null = null;
  currentVariableId: string = '';
  codingJobId: number | null = null;
  selectedCodes: Map<string, SavedCode> = new Map();
  openSelections: Set<string> = new Set();
  notes: Map<string, string> = new Map();
  codingJobComment: string = '';
  isPausingJob: boolean = false;
  isCodingJobCompleted: boolean = false;
  isCodingJobPaused: boolean = false;
  isSubmittingJob: boolean = false;
  isResumingJob: boolean = false;

  // Coding display options
  showScore = false;
  allowComments = true;
  suppressGeneralInstructions = false;

  resetCodingData() {
    this.codingScheme = null;
    this.currentVariableId = '';
    this.codingJobId = null;
    this.selectedCodes.clear();
    this.openSelections.clear();
    this.codingJobComment = '';
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

      const codingJob = await firstValueFrom(
        this.backendService.getCodingJob(workspaceId, jobId)
      );
      this.codingJobComment = codingJob.comment || '';
      this.showScore = codingJob.showScore || false;
      this.allowComments = codingJob.allowComments !== undefined ? codingJob.allowComments : true;
      this.suppressGeneralInstructions = codingJob.suppressGeneralInstructions || false;
    } catch (error) {
      // Ignore errors when loading saved coding progress
    }
  }

  findCodeById(codeId: number): Code | null {
    if (!this.codingScheme) {
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
      const codeToSave = {
        id: selectedCode.id,
        code: selectedCode.code,
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
          selectedCode: { id: -1, code: '', label: '' },
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

    if (event.code === null) {
      this.selectedCodes.delete(compositeKey);
      this.openSelections.delete(compositeKey);
      return;
    }

    let normalizedCode: SavedCode;
    if ('code' in event.code! && event.code!.code < 0) {
      const uncertainCode = event.code as { code: number; label: string; description?: string };
      normalizedCode = {
        id: uncertainCode.code,
        code: String(uncertainCode.code),
        label: uncertainCode.label,
        description: uncertainCode.description
      };
    } else {
      const code = event.code as { id: number; label: string; score?: number };
      normalizedCode = {
        id: code.id,
        code: String(code.id),
        label: code.label,
        score: code.score
      };
    }
    this.selectedCodes.set(compositeKey, normalizedCode);
    if (this.openSelections.has(compositeKey)) {
      await this.saveOpenSelection(workspaceId, testPerson, unitId, event.variableId, true);
    } else {
      this.openSelections.delete(compositeKey); // Remove from open if coded
    }

    if (this.codingJobId && !this.openSelections.has(compositeKey)) {
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
      this.saveOpenSelection(workspaceId, testPerson, unitId, this.currentVariableId, true);
    } else {
      this.openSelections.delete(compositeKey);
      if (this.selectedCodes.has(compositeKey) && this.codingJobId) {
        const selectedCode = this.selectedCodes.get(compositeKey);
        if (selectedCode) {
          this.saveCodingProgress(workspaceId, this.codingJobId, testPerson, unitId, this.currentVariableId, selectedCode);
        }
      }
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
    if (completedReplays === totalReplays) {
      this.isCodingJobCompleted = true;
    }
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

  async saveCodingJobComment(workspaceId: number, comment: string): Promise<void> {
    if (!this.codingJobId || !workspaceId) return;

    try {
      this.codingJobComment = comment;
      await firstValueFrom(
        this.backendService.updateCodingJob(workspaceId, this.codingJobId, { comment })
      );
    } catch (error) {
      // Ignore errors when saving comment
    }
  }

  async pauseCodingJob(workspaceId: number, jobId: number): Promise<void> {
    if (!jobId || !workspaceId) return;

    this.isPausingJob = true;

    try {
      await this.updateCodingJobStatus(workspaceId, jobId, 'paused');
      this.isCodingJobPaused = true;
      this.isPausingJob = false;
    } catch (error) {
      this.isPausingJob = false;
    }
  }

  async resumeCodingJob(workspaceId: number, jobId: number): Promise<void> {
    if (!jobId || !workspaceId) return;
    this.isResumingJob = true;

    try {
      await this.updateCodingJobStatus(workspaceId, jobId, 'active');
      this.isCodingJobPaused = false;
      this.isResumingJob = false;
    } catch (error) {
      this.isResumingJob = false;
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

  findNextUncodedUnitIndex(unitsData: UnitsReplay | null, fromIndex: number = 0): number {
    if (!unitsData) return -1;

    for (let i = fromIndex; i < unitsData.units.length; i++) {
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

    // If no uncoded units found from fromIndex, return -1
    return -1;
  }

  isUnitCoded(unit: UnitsReplayUnit): boolean {
    if (!unit.variableId) return false;

    const compositeKey = this.generateCompositeKey(
      unit.testPerson || '',
      unit.name,
      unit.variableId
    );

    return this.selectedCodes.has(compositeKey) || this.openSelections.has(compositeKey);
  }

  getNextJumpableUnitIndex(unitsData: UnitsReplay | null, fromIndex: number): number {
    if (!unitsData) return -1;

    const jumpableIndexes: number[] = [];

    for (let i = 0; i < unitsData.units.length; i++) {
      if (this.isUnitCoded(unitsData.units[i])) {
        jumpableIndexes.push(i);
      }
    }
    if (jumpableIndexes.length > 0) {
      const lastCodedIndex = jumpableIndexes[jumpableIndexes.length - 1];
      if (lastCodedIndex + 1 < unitsData.units.length) {
        jumpableIndexes.push(lastCodedIndex + 1);
      }
    }
    for (const idx of jumpableIndexes) {
      if (idx > fromIndex) {
        return idx;
      }
    }

    return -1;
  }
}
