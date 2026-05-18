import {
  Component, OnInit, inject, ViewChild, AfterViewInit
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { MatTableModule, MatTableDataSource } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDialog, MatDialogModule, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatPaginator, MatPaginatorModule } from '@angular/material/paginator';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatInputModule } from '@angular/material/input';
import { FormsModule } from '@angular/forms';
import { MatSnackBar } from '@angular/material/snack-bar';
import { WorkspaceProcessesService } from '../../services/workspace-processes.service';
import { ProcessDto } from '../../../../../../../api-dto/workspaces/process-dto';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../../shared/dialogs/confirm-dialog.component';

@Component({
  selector: 'coding-box-process-overview-dialog',
  imports: [
    CommonModule,
    TranslateModule,
    MatTableModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    MatProgressSpinnerModule,
    MatDialogModule,
    MatPaginatorModule,
    MatFormFieldModule,
    MatSelectModule,
    MatInputModule,
    FormsModule
  ],
  templateUrl: './process-overview.component.html',
  styleUrls: ['./process-overview.component.scss']
})
export class ProcessOverviewComponent implements OnInit, AfterViewInit {
  private processesService = inject(WorkspaceProcessesService);
  private dialog = inject(MatDialog);
  private snackBar = inject(MatSnackBar);
  data: { workspaceId: number } = inject(MAT_DIALOG_DATA);

  workspaceId: number = this.data.workspaceId;
  processes = new MatTableDataSource<ProcessDto>([]);
  displayedColumns: string[] = ['queueName', 'status', 'progress', 'timestamp', 'actions'];
  isLoading = false;

  // Filter properties
  statusFilter = '';
  typeFilter = '';
  searchFilter = '';
  availableTypes: string[] = [];
  statusOptions = ['active', 'waiting', 'delayed', 'completed', 'failed', 'paused', 'unknown'];

  @ViewChild(MatPaginator) paginator!: MatPaginator;

  ngOnInit(): void {
    if (this.workspaceId) {
      this.loadProcesses();
    }
    this.setupFilterPredicate();
  }

  ngAfterViewInit() {
    this.processes.paginator = this.paginator;
  }

  setupFilterPredicate(): void {
    this.processes.filterPredicate = (data: ProcessDto, filter: string) => {
      const searchTerms = JSON.parse(filter);

      const statusMatch = !searchTerms.status || data.status === searchTerms.status;
      const typeMatch = !searchTerms.type || data.queueName === searchTerms.type;

      const searchStr = (data.queueName + data.id + data.status).toLowerCase();
      const searchMatch = !searchTerms.search || searchStr.includes(searchTerms.search.toLowerCase());

      return statusMatch && typeMatch && searchMatch;
    };
  }

  applyFilter(): void {
    this.processes.filter = JSON.stringify({
      status: this.statusFilter,
      type: this.typeFilter,
      search: this.searchFilter
    });
    if (this.processes.paginator) {
      this.processes.paginator.firstPage();
    }
  }

  clearFilters(): void {
    this.statusFilter = '';
    this.typeFilter = '';
    this.searchFilter = '';
    this.applyFilter();
  }

  loadProcesses(): void {
    if (!this.workspaceId) return;
    this.isLoading = true;
    this.processesService.getProcesses(this.workspaceId).subscribe({
      next: data => {
        this.processes.data = data;
        this.availableTypes = [...new Set(data.map(d => d.queueName))].sort();
        this.isLoading = false;
        this.applyFilter();
      },
      error: () => {
        this.snackBar.open('Fehler beim Laden der Prozesse', 'Schließen', { duration: 3000 });
        this.isLoading = false;
      }
    });
  }

  deleteProcess(process: ProcessDto): void {
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      width: '440px',
      data: <ConfirmDialogData>{
        title: 'Prozess abbrechen oder entfernen',
        content: `Möchten Sie den Prozess "${process.queueName}" (ID: ${process.id}) wirklich abbrechen oder entfernen?`,
        confirmButtonLabel: 'Entfernen',
        showCancel: true
      }
    });

    dialogRef.afterClosed().subscribe((confirmed: boolean) => {
      if (confirmed) {
        this.confirmDeleteProcess(process);
      }
    });
  }

  confirmDeleteProcess(process: ProcessDto): void {
    this.isLoading = true;
    this.processesService.deleteProcess(this.workspaceId, process.queueName, process.id.toString()).subscribe({
      next: success => {
        if (success) {
          this.snackBar.open('Prozess wurde abgebrochen oder entfernt', 'OK', { duration: 3000 });
          this.loadProcesses();
        } else {
          this.snackBar.open('Prozess konnte nicht abgebrochen oder entfernt werden', 'Schließen', { duration: 4000 });
          this.isLoading = false;
        }
      },
      error: () => {
        this.snackBar.open('Fehler beim Abbrechen oder Entfernen des Prozesses', 'Schließen', { duration: 4000 });
        this.isLoading = false;
      }
    });
  }

  canRemoveProcess(process: ProcessDto): boolean {
    if (process.status !== 'active') return true;
    return process.queueName === 'data-export' || process.queueName === 'test-person-coding';
  }

  getActionTooltip(process: ProcessDto): string {
    return this.canRemoveProcess(process) ?
      'Abbrechen / Entfernen' :
      'Aktive Prozesse dieses Typs können nicht sicher abgebrochen werden';
  }

  isNumber(val: unknown): boolean {
    return typeof val === 'number';
  }
}
