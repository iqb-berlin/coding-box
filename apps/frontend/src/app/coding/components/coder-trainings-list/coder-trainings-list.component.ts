import {
  Component,
  OnDestroy,
  OnInit,
  inject,
  Input,
  Output,
  EventEmitter
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTableModule } from '@angular/material/table';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { Subject, takeUntil } from 'rxjs';
import { BackendService } from '../../../services/backend.service';
import { CoderTraining } from '../../models/coder-training.model';
import { AppService } from '../../../services/app.service';

@Component({
  selector: 'coding-box-coder-trainings-list',
  standalone: true,
  imports: [
    CommonModule,
    TranslateModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatTableModule,
    MatCardModule,
    MatChipsModule
  ],
  templateUrl: './coder-trainings-list.component.html',
  styleUrls: ['./coder-trainings-list.component.scss']
})
export class CoderTrainingsListComponent implements OnInit, OnDestroy {
  private backendService = inject(BackendService);
  private appService = inject(AppService);
  private destroy$ = new Subject<void>();

  @Input() showCreateButton = true;
  @Output() onCreateTraining = new EventEmitter<void>();

  coderTrainings: CoderTraining[] = [];
  isLoading = false;
  displayedColumns: string[] = ['label', 'jobsCount', 'created_at', 'actions'];

  ngOnInit(): void {
    this.loadCoderTrainings();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadCoderTrainings(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      return;
    }

    this.isLoading = true;
    this.backendService.getCoderTrainings(workspaceId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (trainings: CoderTraining[]) => {
          this.coderTrainings = trainings;
          this.isLoading = false;
        },
        error: () => {
          this.coderTrainings = [];
          this.isLoading = false;
        }
      });
  }

  createTraining(): void {
    this.onCreateTraining.emit();
  }

  formatDate(date: Date): string {
    return new Date(date).toLocaleDateString();
  }
}
