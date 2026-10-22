import {
  DestroyRef, Injectable, inject, signal
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize, Subscription } from 'rxjs';
import { AppService } from '../../../core/services/app.service';
import { takeUntilWorkspaceChanged } from '../../../shared/utils/workspace-request.operator';
import { Coder } from '../../models/coder.model';
import { CodingJobBackendService, JobDefinition } from '../../services/coding-job-backend.service';
import { CoderService } from '../../services/coder.service';

/** Export choices are cached only for the current workspace and may be retried after failure. */
@Injectable()
export class ManualCodingExportScopeFacade {
  private readonly destroyRef = inject(DestroyRef);
  private readonly appService = inject(AppService);
  private readonly codingJobBackendService = inject(CodingJobBackendService);
  private readonly coderService = inject(CoderService);
  private definitionsRequest?: Subscription;
  private codersRequest?: Subscription;
  private readonly codersState = signal<Coder[]>([]);
  private readonly codersLoadingState = signal(false);
  readonly coders = this.codersState.asReadonly();
  readonly isLoadingCodersForExport = this.codersLoadingState.asReadonly();
  private codersForExportWorkspaceId?: number;
  private hasLoadedCodersForExport = false;
  private jobDefinitionsForExport: JobDefinition[] = [];
  private jobDefinitionsForExportWorkspaceId?: number;
  private hasLoadedJobDefinitionsForExport = false;
  private isLoadingJobDefinitionsForExport = false;

  constructor() {
    let workspaceId = this.appService.selectedWorkspaceId;
    this.appService.selectedWorkspaceId$.pipe(takeUntilDestroyed()).subscribe(id => {
      if (workspaceId === id) return;
      workspaceId = id;
      this.definitionsRequest?.unsubscribe();
      this.codersRequest?.unsubscribe();
      this.jobDefinitionsForExport = [];
      this.codersState.set([]);
      this.jobDefinitionsForExportWorkspaceId = undefined;
      this.codersForExportWorkspaceId = undefined;
      this.hasLoadedJobDefinitionsForExport = false;
      this.hasLoadedCodersForExport = false;
      this.isLoadingJobDefinitionsForExport = false;
      this.codersLoadingState.set(false);
    });
  }

  getDefinitions(renderedDefinitions?: JobDefinition[]): JobDefinition[] {
    if (renderedDefinitions?.length) return renderedDefinitions;
    return this.jobDefinitionsForExportWorkspaceId === this.appService.selectedWorkspaceId ? this.jobDefinitionsForExport : [];
  }

  ensureDefinitionsReady(hasRenderedDefinitions: boolean): boolean {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId || hasRenderedDefinitions || (this.hasLoadedJobDefinitionsForExport && this.jobDefinitionsForExportWorkspaceId === workspaceId)) return true;
    if (!this.isLoadingJobDefinitionsForExport) this.loadJobDefinitionsForExport();
    return false;
  }

  ensureCodersReady(): boolean {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId || (this.hasLoadedCodersForExport && this.codersForExportWorkspaceId === workspaceId)) return true;
    if (!this.isLoadingCodersForExport()) this.loadCodersForExport();
    return false;
  }

  loadJobDefinitionsForExport(): void {
    const workspaceId = this.appService.selectedWorkspaceId;

    if (!workspaceId) {
      this.jobDefinitionsForExport = [];
      this.jobDefinitionsForExportWorkspaceId = undefined;
      this.hasLoadedJobDefinitionsForExport = false;
      this.isLoadingJobDefinitionsForExport = false;
      return;
    }

    if (this.jobDefinitionsForExportWorkspaceId !== workspaceId) {
      this.jobDefinitionsForExport = [];
      this.hasLoadedJobDefinitionsForExport = false;
      this.jobDefinitionsForExportWorkspaceId = workspaceId;
    }

    this.definitionsRequest?.unsubscribe();
    this.isLoadingJobDefinitionsForExport = true;
    this.definitionsRequest = this.codingJobBackendService
      .getJobDefinitions(workspaceId)
      .pipe(
        takeUntilWorkspaceChanged(this.appService), takeUntilDestroyed(this.destroyRef), finalize(() => {
          if (this.jobDefinitionsForExportWorkspaceId === workspaceId) {
            this.isLoadingJobDefinitionsForExport = false;
          }
        })
      )
      .subscribe({
        next: definitions => {
          if (this.appService.selectedWorkspaceId !== workspaceId) {
            return;
          }

          this.jobDefinitionsForExport = definitions;
          this.jobDefinitionsForExportWorkspaceId = workspaceId;
          this.hasLoadedJobDefinitionsForExport = true;
        },
        error: () => {
          if (this.appService.selectedWorkspaceId !== workspaceId) {
            return;
          }

          this.jobDefinitionsForExport = [];
          this.jobDefinitionsForExportWorkspaceId = workspaceId;
          this.hasLoadedJobDefinitionsForExport = false;
        }
      });
  }

  loadCodersForExport(): void {
    const workspaceId = this.appService.selectedWorkspaceId;

    if (!workspaceId) {
      this.codersState.set([]);
      this.codersForExportWorkspaceId = undefined;
      this.hasLoadedCodersForExport = false;
      this.codersLoadingState.set(false);
      return;
    }

    if (this.codersForExportWorkspaceId !== workspaceId) {
      this.codersState.set([]);
      this.hasLoadedCodersForExport = false;
      this.codersForExportWorkspaceId = workspaceId;
    }

    this.codersRequest?.unsubscribe();
    this.codersLoadingState.set(true);
    this.codersRequest = this.coderService.getCodersForExport()
      .pipe(
        takeUntilWorkspaceChanged(this.appService), takeUntilDestroyed(this.destroyRef), finalize(() => {
          if (this.codersForExportWorkspaceId === workspaceId) {
            this.codersLoadingState.set(false);
          }
        })
      )
      .subscribe({
        next: coders => {
          if (this.appService.selectedWorkspaceId !== workspaceId) {
            return;
          }

          this.codersState.set(coders);
          this.codersForExportWorkspaceId = workspaceId;
          this.hasLoadedCodersForExport = true;
        },
        error: () => {
          if (this.appService.selectedWorkspaceId !== workspaceId) {
            return;
          }

          this.codersState.set([]);
          this.codersForExportWorkspaceId = workspaceId;
          this.hasLoadedCodersForExport = false;
        }
      });
  }
}
