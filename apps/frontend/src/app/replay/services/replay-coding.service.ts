import { Injectable, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { firstValueFrom } from 'rxjs';
import { CodingJobBackendService } from '../../coding/services/coding-job-backend.service';
import {
  Code, VariableCoding, CodingScheme, CodeSelectedEvent
} from '../../models/coding-interfaces';
import { UnitsReplay, UnitsReplayUnit } from './units-replay.service';

interface SavedCode {
  id: number;
  code?: string;
  label: string;
  score?: number;
  description?: string;
  codingIssueOption?: number;
  [key: string]: unknown;
}

interface CodingContextSnapshot {
  runId: number;
  codingJobId: number | null;
  authToken?: string;
}

@Injectable({
  providedIn: 'root'
})
export class ReplayCodingService {
  private codingJobBackendService = inject(CodingJobBackendService);
  private translate = inject(TranslateService);
  private snackBar = inject(MatSnackBar);
  private authToken?: string;

  codingScheme: CodingScheme | null = null;
  currentVariableId: string = '';
  codingJobId: number | null = null;
  selectedCodes: Map<string, SavedCode> = new Map();
  openUnitKeys: Set<string> = new Set();
  notes: Map<string, string> = new Map();
  codingJobComment: string = '';
  isPausingJob: boolean = false;
  isCodingJobCompleted: boolean = false;
  isCodingJobPaused: boolean = false;
  isSubmittingJob: boolean = false;
  isResumingJob: boolean = false;
  isCodingJobFinalized: boolean = false;
  isCompletedJobReview: boolean = false;
  isReviewMode: boolean = false;
  isCodingIssueReviewMode: boolean = false;
  hasSaveError: boolean = false;
  lastSaveError: string | null = null;
  private failedSaveKeys = new Set<string>();
  private rowMutationChains = new Map<string, Promise<void>>();
  private pendingRowMutations = new Set<Promise<void>>();
  private latestSelectionRevisionByKey = new Map<string, number>();
  private selectionRevision = 0;
  private codingDataRunId = 0;
  currentCodingJobStatus: string | null = null;
  showScore = false;
  allowComments = true;
  suppressGeneralInstructions = false;

  resetCodingData() {
    this.codingDataRunId += 1;
    this.codingScheme = null;
    this.currentVariableId = '';
    this.codingJobId = null;
    this.authToken = undefined;
    this.selectedCodes.clear();
    this.openUnitKeys.clear();
    this.notes.clear();
    this.codingJobComment = '';
    this.isPausingJob = false;
    this.isCodingJobCompleted = false;
    this.isCodingJobPaused = false;
    this.isSubmittingJob = false;
    this.isResumingJob = false;
    this.isCodingJobFinalized = false;
    this.isCompletedJobReview = false;
    this.isReviewMode = false;
    this.isCodingIssueReviewMode = false;
    this.hasSaveError = false;
    this.lastSaveError = null;
    this.failedSaveKeys.clear();
    this.rowMutationChains.clear();
    this.pendingRowMutations.clear();
    this.latestSelectionRevisionByKey.clear();
    this.selectionRevision = 0;
    this.currentCodingJobStatus = null;
    this.showScore = false;
    this.allowComments = true;
    this.suppressGeneralInstructions = false;
  }

  setAuthToken(authToken?: string): void {
    this.authToken = authToken || undefined;
  }

  private get authTokenArg(): [string] | [] {
    return this.authToken ? [this.authToken] : [];
  }

  async updateCodingJobStatus(workspaceId: number, jobId: number, status: 'active' | 'paused' | 'completed' | 'open') {
    if (this.isReviewMode) return Promise.resolve(undefined);
    return firstValueFrom(
      this.codingJobBackendService.updateCodingJob(workspaceId, jobId, { status }, ...this.authTokenArg)
    );
  }

  setCodingSchemeFromVocsData(vocsData: string) {
    try {
      this.codingScheme = JSON.parse(vocsData);
    } catch (error) {
      this.codingScheme = null;
    }
  }

  setCodingJobMetadata(codingJob: {
    status?: string;
    comment?: string | null;
    showScore?: boolean;
    allowComments?: boolean;
    suppressGeneralInstructions?: boolean;
  }): void {
    const status = codingJob.status || null;
    this.codingJobComment = codingJob.comment || '';
    this.currentCodingJobStatus = status;
    this.showScore = codingJob.showScore || false;
    this.allowComments = codingJob.allowComments !== undefined ? codingJob.allowComments : true;
    this.suppressGeneralInstructions = codingJob.suppressGeneralInstructions || false;
    this.isCodingJobFinalized = status === 'results_applied';
    this.isCompletedJobReview = status === 'completed' || status === 'results_applied';
  }

  async loadSavedCodingProgress(workspaceId: number, jobId: number): Promise<void> {
    if (!jobId || !workspaceId) return;

    this.selectedCodes.clear();
    this.openUnitKeys.clear();
    this.notes.clear();

    try {
      const savedProgress = await firstValueFrom(
        this.codingJobBackendService.getCodingProgress(workspaceId, jobId, ...this.authTokenArg)
      ) as { [key: string]: SavedCode };

      Object.keys(savedProgress).forEach(compositeKey => {
        const partialCode = savedProgress[compositeKey];
        if (compositeKey.endsWith(':open')) {
          this.openUnitKeys.add(compositeKey.slice(0, -':open'.length));
          return;
        }
        if (partialCode?.id !== null && partialCode?.id !== undefined) {
          const fullCode = this.findCodeById(partialCode.id);
          const toStore: SavedCode = fullCode ? this.convertCodeToSavedCode(fullCode) : partialCode;
          this.selectedCodes.set(compositeKey, toStore);
          this.openUnitKeys.delete(compositeKey);
        }
      });

      const savedNotes = await firstValueFrom(
        this.codingJobBackendService.getCodingNotes(workspaceId, jobId, ...this.authTokenArg)
      );
      if (savedNotes) {
        Object.keys(savedNotes).forEach(key => {
          this.notes.set(key, savedNotes[key]);
        });
      }

      const codingJob = await firstValueFrom(
        this.codingJobBackendService.getCodingJob(workspaceId, jobId, ...this.authTokenArg)
      );
      this.setCodingJobMetadata(codingJob);
    } catch (error) {
      // Ignore errors when loading saved coding progress
    }
  }

  findCodeById(codeId: number): Code | null {
    if (!this.codingScheme) {
      return null;
    }

    const variableCoding = this.codingScheme.variableCodings?.find(
      (v: VariableCoding) => v.alias === this.currentVariableId || v.id === this.currentVariableId
    );
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
    selectedCode: SavedCode | null
  ): Promise<void> {
    if (!jobId || !workspaceId) return;
    if (this.isReviewMode) return;

    const contextSnapshot = this.captureCodingContext();
    const authToken = this.authToken;
    const authTokenArg: [string] | [] = authToken ? [authToken] : [];
    const compositeKey = this.generateCompositeKey(testPerson, unitId, variableId);
    const saveFailureKey = this.getSaveFailureKey('progress', compositeKey);
    await this.enqueueRowMutation(compositeKey, async () => {
      try {
        const backendSelectedCode: {
          id: number;
          code: string;
          label: string;
          [key: string]: unknown;
        } | null = selectedCode === null ? null : {
          id: selectedCode.id,
          code: selectedCode.code ?? '',
          label: selectedCode.label
        };

        if (selectedCode !== null && backendSelectedCode !== null) {
          backendSelectedCode.score = selectedCode.score ?? null;
          backendSelectedCode.codingIssueOption = selectedCode.codingIssueOption ?? null;

          if (selectedCode.description !== undefined) {
            backendSelectedCode.description = selectedCode.description;
          }
        }

        const currentNotes = this.notes.get(compositeKey)?.trim();
        await firstValueFrom(
          this.codingJobBackendService.saveCodingProgress(workspaceId, jobId, {
            testPerson,
            unitId,
            variableId,
            selectedCode: backendSelectedCode,
            ...(this.isCodingIssueReviewMode ? {
              issueReview: true,
              notes: currentNotes || undefined
            } : {})
          }, ...authTokenArg)
        );
        if (this.isCurrentCodingContext(contextSnapshot)) {
          this.clearSaveFailure(saveFailureKey);
        }
      } catch (error) {
        if (this.isCurrentCodingContext(contextSnapshot)) {
          const saveErrorMessage = this.translate.instant('replay.failed-to-save-coding-progress');
          this.markSaveFailure(saveFailureKey, saveErrorMessage);
          this.snackBar.open(
            saveErrorMessage,
            this.translate.instant('replay.close'),
            {
              duration: 5000,
              panelClass: ['snackbar-error']
            }
          );
        }
        throw error;
      }
    });
  }

  async saveAllCodingProgress(workspaceId: number, jobId: number): Promise<void> {
    if (!jobId || !workspaceId) return;
    if (this.isReviewMode) return;

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

    await Promise.all(savePromises);
  }

  async flushPendingRowMutations(): Promise<void> {
    while (this.pendingRowMutations.size > 0) {
      const pendingMutations = Array.from(this.pendingRowMutations);
      const results = await Promise.allSettled(pendingMutations);
      const rejectedResult = results.find(
        (result): result is PromiseRejectedResult => result.status === 'rejected'
      );
      if (rejectedResult) {
        throw rejectedResult.reason;
      }

      await Promise.resolve();
    }
  }

  async handleCodeSelected(
    event: CodeSelectedEvent,
    testPerson: string,
    unitId: string,
    workspaceId: number,
    unitsData: UnitsReplay | null
  ): Promise<SavedCode | null> {
    if (this.isReviewMode) return null;

    const contextSnapshot = this.captureCodingContext();
    const compositeKey = this.generateCompositeKey(testPerson, unitId, event.variableId);
    const revision = this.nextSelectionRevision(compositeKey);

    if (event.code === null && event.codingIssueOption === null) {
      if (this.codingJobId) {
        await this.saveCodingProgress(workspaceId, this.codingJobId, testPerson, unitId, event.variableId, null);
      }
      if (this.shouldApplySelectionMutation(compositeKey, revision, contextSnapshot)) {
        this.selectedCodes.delete(compositeKey);
        this.openUnitKeys.delete(compositeKey);
      }
      return null;
    }

    let normalizedCode: SavedCode | null = null;

    // Handle regular code
    if (event.code) {
      const code = event.code as { id: number; label: string; score?: number };
      normalizedCode = {
        id: code.id,
        code: String(code.id),
        label: code.label,
        score: code.score
      };

      // Add coding issue option if present
      if (event.codingIssueOption) {
        normalizedCode.codingIssueOption = event.codingIssueOption.code;
      }

      if (this.codingJobId) {
        await this.saveCodingProgress(workspaceId, this.codingJobId, testPerson, unitId, event.variableId, normalizedCode);
      }
      if (!this.shouldApplySelectionMutation(compositeKey, revision, contextSnapshot)) {
        return null;
      }
      this.selectedCodes.set(compositeKey, normalizedCode);
      this.openUnitKeys.delete(compositeKey);
    } else if (event.codingIssueOption) {
      // Handle coding issue option-only case (legacy support)
      const codingIssueOption = event.codingIssueOption;
      normalizedCode = {
        id: codingIssueOption.code,
        code: String(codingIssueOption.code),
        label: codingIssueOption.label,
        score: undefined,
        description: codingIssueOption.description,
        codingIssueOption: codingIssueOption.code
      };
      if (this.codingJobId) {
        await this.saveCodingProgress(workspaceId, this.codingJobId, testPerson, unitId, event.variableId, normalizedCode);
      }
      if (!this.shouldApplySelectionMutation(compositeKey, revision, contextSnapshot)) {
        return null;
      }
      this.selectedCodes.set(compositeKey, normalizedCode);
      this.openUnitKeys.delete(compositeKey);
    }

    this.checkCodingJobCompletion(unitsData);
    return normalizedCode;
  }

  generateCompositeKey(testPerson: string, unitId: string, variableId: string): string {
    const normalizedTestPerson = this.normalizeCodingTestPerson(testPerson);
    let bookletId = 'default';
    if (normalizedTestPerson) {
      const parts = normalizedTestPerson.split('@');
      if (parts.length >= 3) {
        bookletId = parts[parts.length - 1];
      }
    }

    return `${normalizedTestPerson}::${bookletId}::${unitId}::${variableId}`;
  }

  private normalizeCodingTestPerson(testPerson: string): string {
    const normalizedTestPerson = (testPerson || '').trim();
    const parts = normalizedTestPerson.split('@');

    if (parts.length === 4 && parts[2] === '') {
      return `${parts[0]}@${parts[1]}@${parts[3]}`;
    }

    return normalizedTestPerson;
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
        return this.selectedCodes.has(compositeKey);
      }
      return false;
    }).length;
  }

  getOpenCount(unitsData: UnitsReplay | null = null): number {
    if (!unitsData) return this.openUnitKeys.size;

    return unitsData.units.filter((unit: UnitsReplayUnit) => {
      if (!unit.variableId) return false;
      const compositeKey = this.generateCompositeKey(
        unit.testPerson || '',
        unit.name || '',
        unit.variableId
      );
      return this.openUnitKeys.has(compositeKey);
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

  getPreSelectedCodingIssueOptionId(testPerson: string, unitId: string, variableId: string): number | null {
    const compositeKey = this.generateCompositeKey(testPerson, unitId, variableId);
    const selectedCode = this.selectedCodes.get(compositeKey);
    return selectedCode && selectedCode.codingIssueOption ? selectedCode.codingIssueOption : null;
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
    const jobId = this.codingJobId;
    const authToken = this.authToken;
    const authTokenArg: [string] | [] = authToken ? [authToken] : [];
    const contextSnapshot = this.captureCodingContext();
    if (!jobId || !workspaceId) return;
    if (this.isReviewMode) return;

    const compositeKey = this.generateCompositeKey(testPerson, unitId, variableId);
    const saveFailureKey = this.getSaveFailureKey('notes', compositeKey);
    const trimmedNotes = notes.trim();
    await this.enqueueRowMutation(compositeKey, async () => {
      try {
        if (this.isCurrentCodingContext(contextSnapshot)) {
          if (trimmedNotes) {
            this.notes.set(compositeKey, notes);
          } else {
            this.notes.delete(compositeKey);
          }
        }

        await firstValueFrom(
          this.codingJobBackendService.saveCodingNotes(workspaceId, jobId, {
            testPerson,
            unitId,
            variableId,
            notes: trimmedNotes || undefined,
            ...(this.isCodingIssueReviewMode ? { issueReview: true } : {})
          }, ...authTokenArg)
        );
        if (this.isCurrentCodingContext(contextSnapshot)) {
          this.clearSaveFailure(saveFailureKey);
        }
      } catch (error) {
        if (this.isCurrentCodingContext(contextSnapshot)) {
          const saveErrorMessage = this.translate.instant('replay.failed-to-save-coding-notes');
          this.markSaveFailure(saveFailureKey, saveErrorMessage);
          this.snackBar.open(
            saveErrorMessage,
            this.translate.instant('replay.close'),
            {
              duration: 5000,
              panelClass: ['snackbar-error']
            }
          );
        }
        throw error;
      }
    });
  }

  async saveCodingJobComment(workspaceId: number, comment: string): Promise<void> {
    if (!this.codingJobId || !workspaceId) return;
    if (this.isReviewMode) return;

    try {
      this.codingJobComment = comment;
      await firstValueFrom(
        this.codingJobBackendService.updateCodingJob(workspaceId, this.codingJobId, { comment }, ...this.authTokenArg)
      );
    } catch (error) {
      // Ignore errors when saving comment
    }
  }

  async pauseCodingJob(workspaceId: number, jobId: number): Promise<void> {
    if (!jobId || !workspaceId) return;
    if (this.isReviewMode) return;
    if (this.isCodingJobCompleted || this.isCompletedJobReview || this.isCodingJobFinalized) return;
    this.isPausingJob = true;

    try {
      await this.updateCodingJobStatus(workspaceId, jobId, 'paused');
      this.isCodingJobPaused = true;
      this.isPausingJob = false;
    } catch (error) {
      this.isPausingJob = false;
    }
  }

  pauseCodingJobOnUnload(workspaceId: number, jobId: number): void {
    if (!jobId || !workspaceId) return;
    if (this.isReviewMode) return;
    if (this.isCodingJobCompleted || this.isCompletedJobReview || this.isCodingJobFinalized) return;
    this.codingJobBackendService.updateCodingJobKeepalive(
      workspaceId,
      jobId,
      { status: 'paused' },
      ...this.authTokenArg
    );
  }

  async resumeCodingJob(workspaceId: number, jobId: number): Promise<void> {
    if (!jobId || !workspaceId) return;
    if (this.isReviewMode) return;
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
    if (this.isReviewMode) return;

    if (this.hasSaveError) {
      this.snackBar.open(
        this.lastSaveError || this.translate.instant('replay.failed-to-save-coding-progress'),
        this.translate.instant('replay.close'),
        {
          duration: 5000,
          panelClass: ['snackbar-error']
        }
      );
      return;
    }

    this.isSubmittingJob = true;
    this.snackBar.open(this.translate.instant('replay.submitting-coding-job'), '', { duration: 2000 });

    try {
      await this.updateCodingJobStatus(workspaceId, jobId, 'completed');
      this.isSubmittingJob = false;

      const bookletKey = `replay_booklet_${jobId}`;
      try {
        localStorage.removeItem(bookletKey);
      } catch (e) {
        // Ignore cleanup errors
      }

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

        if (!this.selectedCodes.has(compositeKey)) {
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

    return this.selectedCodes.has(compositeKey);
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

  private enqueueRowMutation(key: string, operation: () => Promise<void>): Promise<void> {
    const previous = this.rowMutationChains.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(operation);
    this.pendingRowMutations.add(next);
    const tracked = next.catch(() => undefined).finally(() => {
      this.pendingRowMutations.delete(next);
      if (this.rowMutationChains.get(key) === tracked) {
        this.rowMutationChains.delete(key);
      }
    });
    this.rowMutationChains.set(key, tracked);
    return next;
  }

  private nextSelectionRevision(key: string): number {
    this.selectionRevision += 1;
    const revision = this.selectionRevision;
    this.latestSelectionRevisionByKey.set(key, revision);
    return revision;
  }

  private isLatestSelectionRevision(key: string, revision: number): boolean {
    return this.latestSelectionRevisionByKey.get(key) === revision;
  }

  private getSaveFailureKey(kind: 'progress' | 'notes', compositeKey: string): string {
    return `${kind}:${compositeKey}`;
  }

  private clearSaveFailure(saveFailureKey: string): void {
    this.failedSaveKeys.delete(saveFailureKey);
    this.hasSaveError = this.failedSaveKeys.size > 0;
    if (!this.hasSaveError) {
      this.lastSaveError = null;
    }
  }

  private markSaveFailure(saveFailureKey: string, message: string): void {
    this.failedSaveKeys.add(saveFailureKey);
    this.hasSaveError = true;
    this.lastSaveError = message;
  }

  private captureCodingContext(): CodingContextSnapshot {
    return {
      runId: this.codingDataRunId,
      codingJobId: this.codingJobId,
      authToken: this.authToken
    };
  }

  private isCurrentCodingContext(snapshot: CodingContextSnapshot): boolean {
    return this.codingDataRunId === snapshot.runId &&
      this.codingJobId === snapshot.codingJobId &&
      this.authToken === snapshot.authToken;
  }

  private shouldApplySelectionMutation(
    key: string,
    revision: number,
    snapshot: CodingContextSnapshot
  ): boolean {
    return this.isCurrentCodingContext(snapshot) && this.isLatestSelectionRevision(key, revision);
  }
}
