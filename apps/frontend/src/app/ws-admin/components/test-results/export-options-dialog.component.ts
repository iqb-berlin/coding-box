import { TranslateModule } from '@ngx-translate/core';
import {
  Component, inject, OnInit, signal, ChangeDetectionStrategy, DestroyRef
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { FormsModule } from '@angular/forms';
import { MatListModule } from '@angular/material/list';
import { MatTabsModule } from '@angular/material/tabs';
import { MatCheckboxModule } from '@angular/material/checkbox';

import { TestResultBackendService } from '../../../shared/services/test-result/test-result-backend.service';

export interface ExportOptions {
  groupNames: string[];
  bookletNames: string[];
  unitNames: string[];
  personIds: number[];
  includeLogAnomalies: boolean;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'coding-box-export-options-dialog',
  standalone: true,
  imports: [TranslateModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    FormsModule,
    MatListModule,
    MatTabsModule,
    MatCheckboxModule
  ],
  template: `
    <h1 mat-dialog-title>{{ 'ui-text.test-files-zip-export-options-dialog.title' | translate }}</h1>
    <div mat-dialog-content>
      <p>{{ 'ui-text.export-options-dialog.description' | translate }}</p>

      @if (dialogData?.exportType === 'results') {
        <div class="export-extra-options">
          <mat-checkbox [(ngModel)]="data.includeLogAnomalies">
            {{ 'ui-text.export-options-dialog.include-log-anomalies' | translate }}
          </mat-checkbox>
        </div>
      }

      <mat-tab-group>
        <mat-tab [label]="'ws-admin.test-groups' | translate">
          <div class="selection-actions">
            <button mat-button (click)="groupsList.selectAll()">{{ 'manual-coding-export.select-all' | translate }}</button>
            <button mat-button (click)="groupsList.deselectAll()">{{ 'manual-coding-export.deselect-all' | translate }}</button>
          </div>
          <div class="list-container">
            <mat-selection-list #groupsList [(ngModel)]="data.groupNames">
              @for (group of availableOptions().groups; track group) {
                <mat-list-option [value]="group">
                  {{ group }}
                </mat-list-option>
              }
            </mat-selection-list>
          </div>
        </mat-tab>

        <mat-tab [label]="'ws-admin.test-persons' | translate">
          <div class="selection-actions">
            <button mat-button (click)="personsList.selectAll()">{{ 'manual-coding-export.select-all' | translate }}</button>
            <button mat-button (click)="personsList.deselectAll()">{{ 'manual-coding-export.deselect-all' | translate }}</button>
          </div>
          <div class="list-container">
            <mat-selection-list #personsList [(ngModel)]="data.personIds">
              @for (person of availableOptions().testPersons; track person.id) {
                <mat-list-option [value]="person.id">
                  {{ person.groupName }} - {{ person.code }} - {{ person.login }}
                </mat-list-option>
              }
            </mat-selection-list>
          </div>
        </mat-tab>

        <mat-tab [label]="'ui-text.files-validation.booklets' | translate">
          <div class="selection-actions">
            <button mat-button (click)="bookletsList.selectAll()">{{ 'manual-coding-export.select-all' | translate }}</button>
            <button mat-button (click)="bookletsList.deselectAll()">{{ 'manual-coding-export.deselect-all' | translate }}</button>
          </div>
          <div class="list-container">
            <mat-selection-list #bookletsList [(ngModel)]="data.bookletNames">
              @for (booklet of availableOptions().booklets; track booklet) {
                <mat-list-option [value]="booklet">
                  {{ booklet }}
                </mat-list-option>
              }
            </mat-selection-list>
          </div>
        </mat-tab>

        <mat-tab [label]="'coding.jobs.table.units' | translate">
          <div class="selection-actions">
            <button mat-button (click)="unitsList.selectAll()">{{ 'manual-coding-export.select-all' | translate }}</button>
            <button mat-button (click)="unitsList.deselectAll()">{{ 'manual-coding-export.deselect-all' | translate }}</button>
          </div>
          <div class="list-container">
            <mat-selection-list #unitsList [(ngModel)]="data.unitNames">
              @for (unit of availableOptions().units; track unit) {
                <mat-list-option [value]="unit">
                  {{ unit }}
                </mat-list-option>
              }
            </mat-selection-list>
          </div>
        </mat-tab>
      </mat-tab-group>

    </div>
    <div mat-dialog-actions align="end">
      <button mat-button (click)="onNoClick()">{{ 'cancel' | translate }}</button>
      <button mat-raised-button color="primary" [mat-dialog-close]="data">{{ 'export' | translate }}</button>
    </div>
  `,
  styles: [`
    .full-width {
      width: 100%;
      margin-bottom: 10px;
    }
    .list-container {
      height: 400px;
      overflow-y: auto;
      border: 1px solid #ccc;
      margin-top: 10px;
    }
    .selection-actions {
      display: flex;
      gap: 10px;
      margin-top: 10px;
      margin-bottom: 5px;
    }
    .export-extra-options {
      margin: 8px 0 12px;
    }
  `]
})
export class ExportOptionsDialogComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);

  readonly dialogRef = inject(MatDialogRef<ExportOptionsDialogComponent>);
  readonly testResultBackendService = inject(TestResultBackendService);
  protected readonly dialogData = inject(MAT_DIALOG_DATA);

  protected data: ExportOptions = {
    groupNames: [],
    bookletNames: [],
    unitNames: [],
    personIds: [],
    includeLogAnomalies: false
  };

  protected readonly availableOptions = signal<{
    testPersons: {
      id: number;
      code: string;
      groupName: string;
      login: string;
    }[];
    groups: string[];
    booklets: string[];
    units: string[];
  }>({
    testPersons: [],
    groups: [],
    booklets: [],
    units: []
  });

  ngOnInit(): void {
    if (this.dialogData && this.dialogData.workspaceId) {
      this.testResultBackendService.getExportOptions(this.dialogData.workspaceId).pipe(takeUntilDestroyed(this.destroyRef)).subscribe((options: ReturnType<typeof this.availableOptions>) => {
        this.availableOptions.set(options);
      });
    }
  }

  protected onNoClick(): void {
    this.dialogRef.close();
  }
}
