import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslateModule } from '@ngx-translate/core';
import {
  BehaviorSubject,
  Observable,
  catchError,
  finalize,
  of,
  tap
} from 'rxjs';
import {
  CodingStatistics, JobInfo,
  JobStatus,
  PaginatedCodingList,
  TestPersonCodingService
} from '../../services/test-person-coding.service';
import { AppService } from '../../../services/app.service';
import { BackendService } from '../../../services/backend.service';

@Component({
  selector: 'coding-box-test-person-coding',
  templateUrl: './test-person-coding.component.html',
  styleUrls: ['./test-person-coding.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    MatButtonModule,
    MatCardModule,
    MatCheckboxModule,
    MatChipsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatPaginatorModule,
    MatProgressBarModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    MatTableModule,
    MatTabsModule,
    MatTooltipModule,
    TranslateModule
  ]
})
export class TestPersonCodingComponent implements OnInit {
  private testPersonCodingService = inject(TestPersonCodingService);
  private snackBar = inject(MatSnackBar);
  private appService = inject(AppService);
  private backendService = inject(BackendService);

  // Make Math available to the template
  Math = Math;

  // Configurable group size for batch processing
  groupSize = 5;

  // Flag to track if jobs should run sequentially
  runSequentially = true;

  // Track the current job being processed in sequential mode
  currentJobIndex = 0;
  totalJobs = 0;
  processingQueue: number[][] = [];

  // Workspace ID from app service
  get workspaceId(): number {
    return this.appService.selectedWorkspaceId;
  }

  // Coding statistics
  statistics$: Observable<CodingStatistics> | null = null;

  // Coding list
  codingList$ = new BehaviorSubject<PaginatedCodingList>({
    data: [],
    total: 0,
    page: 1,
    limit: 20
  });

  displayedColumns: string[] = ['unit_key', 'unit_alias', 'login_name', 'booklet_id', 'variable_id', 'actions'];

  isLoading = false;

  // Pagination
  currentPage = 1;
  pageSize = 20;

  // Job status
  activeJobId: string | null = null;
  jobStatus: JobStatus | null = null;
  jobStatusInterval: number | null = null;

  // All jobs
  allJobs: JobInfo[] = [];
  jobsLoading = false;
  jobsRefreshInterval: number | null = null;

  ngOnInit(): void {
    // Load data using workspace ID from app service
    this.loadStatistics();
    this.loadCodingList();
    this.loadAllJobs();
    this.startJobsRefreshInterval();
  }

  ngOnDestroy(): void {
    this.stopJobStatusPolling();
    this.stopJobsRefreshInterval();
  }

  /**
   * Load all jobs for the current workspace
   */
  loadAllJobs(): void {
    this.jobsLoading = true;
    this.testPersonCodingService.getAllJobs(this.workspaceId)
      .pipe(
        tap(jobs => {
          this.allJobs = jobs;

          // If we have an active job, update its status from the list
          if (this.activeJobId) {
            const activeJob = jobs.find(job => job.jobId === this.activeJobId);
            if (activeJob) {
              this.jobStatus = activeJob;

              // If job is completed, failed, or cancelled, stop polling
              if (['completed', 'failed', 'cancelled'].includes(activeJob.status)) {
                this.stopJobStatusPolling();

                if (activeJob.status === 'completed') {
                  this.loadStatistics();
                  this.loadCodingList(this.currentPage, this.pageSize);
                }
              }
            }
          }
        }),
        finalize(() => {
          this.jobsLoading = false;
        })
      )
      .subscribe();
  }

  /**
   * Start automatic refresh of jobs list
   */
  startJobsRefreshInterval(): void {
    // Clear any existing interval
    this.stopJobsRefreshInterval();

    // Refresh jobs list every 5 seconds
    this.jobsRefreshInterval = window.setInterval(() => {
      this.loadAllJobs();
    }, 5000);
  }

  /**
   * Stop automatic refresh of jobs list
   */
  stopJobsRefreshInterval(): void {
    if (this.jobsRefreshInterval) {
      clearInterval(this.jobsRefreshInterval);
      this.jobsRefreshInterval = null;
    }
  }

  loadStatistics(): void {
    this.statistics$ = this.testPersonCodingService.getCodingStatistics(this.workspaceId);
  }

  loadCodingList(page = 1, limit = 20): void {
    this.isLoading = true;
    this.currentPage = page;
    this.pageSize = limit;

    // Get current auth token
    const authToken = localStorage.getItem('id_token') || '';
    // Get server URL for generating links
    const serverUrl = window.location.origin;

    this.testPersonCodingService.getCodingList(this.workspaceId, authToken, serverUrl, page, limit)
      .pipe(
        tap(result => this.codingList$.next(result)),
        finalize(() => {
          this.isLoading = false;
        })
      )
      .subscribe();
  }

  handlePageEvent(event: PageEvent): void {
    this.loadCodingList(event.pageIndex + 1, event.pageSize);
  }

  codeTestPersons(testPersonIds: string): void {
    if (!testPersonIds) {
      this.snackBar.open('Please enter test person IDs', 'Close', { duration: 3000 });
      return;
    }

    this.isLoading = true;
    this.testPersonCodingService.codeTestPersons(this.workspaceId, testPersonIds)
      .pipe(
        tap(result => {
          if (result.jobId) {
            // Background job started
            this.activeJobId = result.jobId;
            this.startJobStatusPolling(result.jobId);
            this.snackBar.open(result.message || 'Background job started', 'Close', { duration: 5000 });
          } else {
            // Immediate result
            this.snackBar.open(`Coded ${result.totalResponses} responses`, 'Close', { duration: 3000 });
            this.loadStatistics();
            this.loadCodingList(this.currentPage, this.pageSize);
          }
        }),
        catchError(error => {
          this.snackBar.open(`Error: ${error.message || 'Failed to code test persons'}`, 'Close', { duration: 5000 });
          return of(null);
        }),
        finalize(() => {
          this.isLoading = false;
        })
      )
      .subscribe();
  }

  startJobStatusPolling(jobId: string): void {
    // Clear any existing interval
    if (this.jobStatusInterval) {
      clearInterval(this.jobStatusInterval);
    }

    // Poll job status every 2 seconds
    this.jobStatusInterval = window.setInterval(() => {
      this.testPersonCodingService.getJobStatus(this.workspaceId, jobId)
        .subscribe(status => {
          if ('error' in status) {
            this.snackBar.open(`Error: ${status.error}`, 'Close', { duration: 5000 });
            this.stopJobStatusPolling();
            return;
          }

          this.jobStatus = status;

          // If job is completed, failed, or cancelled, stop polling
          if (['completed', 'failed', 'cancelled'].includes(status.status)) {
            this.stopJobStatusPolling();

            if (status.status === 'completed') {
              this.snackBar.open('Coding job completed successfully', 'Close', { duration: 3000 });
              this.loadStatistics();
              this.loadCodingList(this.currentPage, this.pageSize);
            } else if (status.status === 'failed') {
              this.snackBar.open(`Coding job failed: ${status.error || 'Unknown error'}`, 'Close', { duration: 5000 });
            } else if (status.status === 'cancelled') {
              this.snackBar.open('Coding job was cancelled', 'Close', { duration: 3000 });
            }
          }
        });
    }, 2000);
  }

  stopJobStatusPolling(): void {
    if (this.jobStatusInterval) {
      clearInterval(this.jobStatusInterval);
      this.jobStatusInterval = null;
    }
    this.activeJobId = null;
    this.jobStatus = null;
  }

  /**
   * Cancel a job
   * @param jobId Optional job ID to cancel. If not provided, cancels the active job.
   */
  cancelJob(jobId?: string): void {
    const idToCancel = jobId || this.activeJobId;
    if (!idToCancel) return;

    this.testPersonCodingService.cancelJob(this.workspaceId, idToCancel)
      .subscribe(result => {
        if (result.success) {
          this.snackBar.open(result.message, 'Close', { duration: 3000 });
          // Refresh the jobs list
          this.loadAllJobs();
        } else {
          this.snackBar.open(`Failed to cancel job: ${result.message}`, 'Close', { duration: 5000 });
        }
      });
  }

  /**
   * Pause a job
   * @param jobId Optional job ID to pause. If not provided, pauses the active job.
   */
  pauseJob(jobId?: string): void {
    const idToPause = jobId || this.activeJobId;
    if (!idToPause) return;

    this.testPersonCodingService.pauseJob(this.workspaceId, idToPause)
      .subscribe(result => {
        if (result.success) {
          this.snackBar.open(result.message, 'Close', { duration: 3000 });
          // Refresh the jobs list
          this.loadAllJobs();
        } else {
          this.snackBar.open(`Failed to pause job: ${result.message}`, 'Close', { duration: 5000 });
        }
      });
  }

  /**
   * Resume a job
   * @param jobId Optional job ID to resume. If not provided, resumes the active job.
   */
  resumeJob(jobId?: string): void {
    const idToResume = jobId || this.activeJobId;
    if (!idToResume) return;

    this.testPersonCodingService.resumeJob(this.workspaceId, idToResume)
      .subscribe(result => {
        if (result.success) {
          this.snackBar.open(result.message, 'Close', { duration: 3000 });
          // Refresh the jobs list
          this.loadAllJobs();
        } else {
          this.snackBar.open(`Failed to resume job: ${result.message}`, 'Close', { duration: 5000 });
        }
      });
  }

  /**
   * Show job result in a dialog
   * @param job The job to show results for
   */
  showJobResult(job: JobInfo): void {
    if (!job.result) {
      this.snackBar.open('No results available for this job', 'Close', { duration: 3000 });
      return;
    }

    // Create a formatted message with the job results
    let message = `Job ID: ${job.jobId}\n\n`;
    message += `Total Responses: ${job.result.totalResponses}\n\n`;
    message += 'Status Counts:\n';

    for (const [status, count] of Object.entries(job.result.statusCounts)) {
      message += `${status || 'Unknown'}: ${count}\n`;
    }

    // Show the message in a snackbar
    this.snackBar.open(message, 'Close', { duration: 10000 });
  }

  /**
   * Code exactly five test persons
   */
  codeFiveTestPersons(): void {
    this.isLoading = true;
    this.backendService.getTestPersons(this.workspaceId)
      .pipe(
        catchError(error => {
          this.snackBar.open(`Error getting test persons: ${error.message || 'Unknown error'}`, 'Close', { duration: 5000 });
          return of([]);
        }),
        finalize(() => {
          this.isLoading = false;
        })
      )
      .subscribe(testPersonIds => {
        if (testPersonIds.length === 0) {
          this.snackBar.open('No test persons found for this workspace', 'Close', { duration: 3000 });
          return;
        }

        // Take only the first 5 test persons (or fewer if there are less than 5)
        const limitedTestPersonIds = testPersonIds.slice(0, 5);

        // Process the chunk of 5 test persons
        if (this.runSequentially) {
          this.processChunksSequentially([limitedTestPersonIds]);
        } else {
          this.processTestPersonChunk(limitedTestPersonIds, 0, 1)
            .catch(error => {
              this.snackBar.open(`Error processing test persons: ${error.message || 'Unknown error'}`, 'Close', { duration: 5000 });
            });
        }

        // Show a message about how many test persons are being coded
        this.snackBar.open(`Coding ${limitedTestPersonIds.length} test persons`, 'Close', { duration: 3000 });
      });
  }

  /**
   * Code all test persons in the workspace, split into groups of the configured size
   */
  codeAllTestPersons(): void {
    this.isLoading = true;
    this.backendService.getTestPersons(this.workspaceId)
      .pipe(
        catchError(error => {
          this.snackBar.open(`Error getting test persons: ${error.message || 'Unknown error'}`, 'Close', { duration: 5000 });
          return of([]);
        }),
        finalize(() => {
          this.isLoading = false;
        })
      )
      .subscribe(testPersonIds => {
        if (testPersonIds.length === 0) {
          this.snackBar.open('No test persons found for this workspace', 'Close', { duration: 3000 });
          return;
        }

        // Split test persons into groups of the configured size
        const chunks = this.chunkArray(testPersonIds, this.groupSize);

        // Show message about how many chunks will be processed
        this.snackBar.open(`Processing ${testPersonIds.length} test persons in ${chunks.length} groups of ${this.groupSize}`, 'Close', { duration: 5000 });

        if (this.runSequentially) {
          // Process chunks sequentially
          this.processChunksSequentially(chunks)
            .catch(error => {
              this.snackBar.open(`Error processing test persons: ${error.message || 'Unknown error'}`, 'Close', { duration: 5000 });
            });
        } else {
          // Process each chunk with a small delay between them to avoid overwhelming the server
          chunks.forEach((chunk, index) => {
            setTimeout(() => {
              this.processTestPersonChunk(chunk, index, chunks.length)
                .catch(error => {
                  this.snackBar.open(`Error processing chunk ${index + 1}/${chunks.length}: ${error.message || 'Unknown error'}`, 'Close', { duration: 5000 });
                });
            }, index * 500); // 500ms delay between chunks
          });
        }
      });
  }

  exportAsCsv(): void {
    this.isLoading = true;
    this.testPersonCodingService.exportCodingListAsCsv(this.workspaceId)
      .pipe(
        finalize(() => {
          this.isLoading = false;
        })
      )
      .subscribe(blob => {
        this.downloadFile(blob, `coding-list-${new Date().toISOString().slice(0, 10)}.csv`);
      });
  }

  exportAsExcel(): void {
    this.isLoading = true;
    this.testPersonCodingService.exportCodingListAsExcel(this.workspaceId)
      .pipe(
        finalize(() => {
          this.isLoading = false;
        })
      )
      .subscribe(blob => {
        this.downloadFile(blob, `coding-list-${new Date().toISOString().slice(0, 10)}.xlsx`);
      });
  }

  /**
   * Split an array into chunks of the specified size
   * @param array The array to split
   * @param chunkSize The size of each chunk
   * @returns An array of chunks
   */
  private chunkArray<T>(array: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }

  /**
   * Process a chunk of test person IDs
   * @param chunk Array of test person IDs to process
   * @param chunkIndex Index of the current chunk
   * @param totalChunks Total number of chunks
   * @returns Promise that resolves when the chunk is processed
   */
  private processTestPersonChunk(chunk: number[], chunkIndex: number, totalChunks: number): Promise<void> {
    return new Promise((resolve, reject) => {
      // Convert the chunk to a comma-separated string
      const testPersonIdsString = chunk.join(',');

      // Show message about which chunk is being processed
      this.snackBar.open(`Processing chunk ${chunkIndex + 1}/${totalChunks} with ${chunk.length} test persons`, 'Close', { duration: 3000 });

      // Call the existing codeTestPersons method with the IDs string
      this.testPersonCodingService.codeTestPersons(this.workspaceId, testPersonIdsString)
        .pipe(
          catchError(error => {
            this.snackBar.open(`Error coding chunk ${chunkIndex + 1}/${totalChunks}: ${error.message || 'Unknown error'}`, 'Close', { duration: 5000 });
            reject(error);
            return of(null);
          })
        )
        .subscribe(result => {
          if (result && result.jobId) {
            // If a job was created, we need to wait for it to complete before resolving
            const checkJobInterval = setInterval(() => {
              this.testPersonCodingService.getJobStatus(this.workspaceId, result.jobId!)
                .subscribe(status => {
                  if ('error' in status) {
                    clearInterval(checkJobInterval);
                    this.snackBar.open(`Error checking job status: ${status.error}`, 'Close', { duration: 5000 });
                    reject(new Error(status.error));
                    return;
                  }

                  // If job is completed, failed, or cancelled, resolve or reject the promise
                  if (['completed', 'failed', 'cancelled'].includes(status.status)) {
                    clearInterval(checkJobInterval);

                    if (status.status === 'completed') {
                      this.snackBar.open(`Completed chunk ${chunkIndex + 1}/${totalChunks}`, 'Close', { duration: 3000 });
                      resolve();
                    } else if (status.status === 'failed') {
                      this.snackBar.open(`Failed to process chunk ${chunkIndex + 1}/${totalChunks}: ${status.error || 'Unknown error'}`, 'Close', { duration: 5000 });
                      reject(new Error(status.error || 'Job failed'));
                    } else if (status.status === 'cancelled') {
                      this.snackBar.open(`Chunk ${chunkIndex + 1}/${totalChunks} was cancelled`, 'Close', { duration: 3000 });
                      reject(new Error('Job was cancelled'));
                    }
                  }
                });
            }, 2000);
          } else if (result) {
            // If no job was created (immediate result), resolve immediately
            this.snackBar.open(`Processed chunk ${chunkIndex + 1}/${totalChunks} with ${chunk.length} test persons`, 'Close', { duration: 3000 });
            resolve();
          } else {
            // If no result, reject
            reject(new Error('No result returned'));
          }

          // Refresh the jobs list after each chunk is processed
          this.loadAllJobs();
        });
    });
  }

  /**
   * Process all chunks sequentially
   * @param chunks Array of chunks to process
   * @returns Promise that resolves when all chunks are processed
   */
  private async processChunksSequentially(chunks: number[][]): Promise<void> {
    this.currentJobIndex = 0;
    this.totalJobs = chunks.length;
    this.processingQueue = chunks;

    for (let i = 0; i < chunks.length; i++) {
      this.currentJobIndex = i;
      try {
        await this.processTestPersonChunk(chunks[i], i, chunks.length);
      } catch (error) {
        // @ts-ignore
        this.snackBar.open(`Error processing chunk ${i + 1}/${chunks.length}: ${error.message || 'Unknown error'}`, 'Close', { duration: 5000 });
        // Continue with the next chunk even if this one failed
      }
    }

    // Refresh statistics and coding list after all chunks are processed
    this.loadStatistics();
    this.loadCodingList(this.currentPage, this.pageSize);
    this.snackBar.open(`Completed processing all ${chunks.length} chunks`, 'Close', { duration: 5000 });
  }

  private downloadFile(blob: Blob, filename: string): void {
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    window.URL.revokeObjectURL(url);
  }
}
