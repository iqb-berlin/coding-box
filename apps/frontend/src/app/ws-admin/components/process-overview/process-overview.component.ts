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
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatPaginator, MatPaginatorModule } from '@angular/material/paginator';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatInputModule } from '@angular/material/input';
import { FormsModule } from '@angular/forms';
import { WorkspaceProcessesService } from '../../services/workspace-processes.service';
import { ProcessDto } from '../../../../../../../api-dto/workspaces/process-dto';
import { AppService } from '../../../core/services/app.service';

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
  private appService = inject(AppService);
  private dialogRef = inject(MatDialogRef<ProcessOverviewComponent>);
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
  statusOptions = ['active', 'waiting', 'delayed', 'completed', 'failed', 'paused'];

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
        this.isLoading = false;
      }
    });
  }

  deleteProcess(process: ProcessDto): void {
    if (!window.confirm(`Möchten Sie den Prozess "${process.queueName}" (ID: ${process.id}) wirklich abbrechen/löschen?`)) {
      return;
    }
    this.isLoading = true;
    this.processesService.deleteProcess(this.workspaceId, process.queueName, process.id.toString()).subscribe({
      next: () => {
        this.loadProcesses();
      },
      error: () => {
        this.isLoading = false;
      }
    });
  }

  isNumber(val: unknown): boolean {
    return typeof val === 'number';
  }
}
