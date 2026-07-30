import { DatePipe } from '@angular/common';
import { Component, inject, OnInit } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { finalize } from 'rxjs';
import {
  RequestMonitoringIncidentDto
} from '../../../../../../../api-dto/request-monitoring/request-monitoring-incident.dto';
import { RequestMonitoringIncidentService } from '../../../core/services/request-monitoring-incident.service';

@Component({
  selector: 'coding-box-request-monitoring-incidents',
  templateUrl: './request-monitoring-incidents.component.html',
  styleUrl: './request-monitoring-incidents.component.scss',
  imports: [
    DatePipe,
    MatButtonModule,
    MatCardModule,
    MatCheckboxModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatTableModule,
    TranslateModule
  ]
})
export class RequestMonitoringIncidentsComponent implements OnInit {
  private readonly service = inject(RequestMonitoringIncidentService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly translate = inject(TranslateService);

  readonly displayedColumns = [
    'state',
    'request',
    'occurrences',
    'duration',
    'database',
    'lastOccurred',
    'actions'
  ];

  incidents: RequestMonitoringIncidentDto[] = [];
  includeResolved = false;
  loading = false;

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    this.service.getAll(this.includeResolved)
      .pipe(finalize(() => { this.loading = false; }))
      .subscribe({
        next: incidents => { this.incidents = incidents; },
        error: () => this.showMessage('request-monitoring.load-error')
      });
  }

  toggleResolved(checked: boolean): void {
    this.includeResolved = checked;
    this.load();
  }

  setResolved(incident: RequestMonitoringIncidentDto): void {
    const resolved = incident.resolvedAt === null;
    this.service.setResolved(incident.id, resolved).subscribe({
      next: updated => {
        if (resolved && !this.includeResolved) {
          this.incidents = this.incidents.filter(item => item.id !== updated.id);
        } else {
          this.incidents = this.incidents.map(item => (
            item.id === updated.id ? updated : item
          ));
        }
      },
      error: () => this.showMessage('request-monitoring.update-error')
    });
  }

  private showMessage(key: string): void {
    this.snackBar.open(this.translate.instant(key), undefined, {
      duration: 4000
    });
  }
}
