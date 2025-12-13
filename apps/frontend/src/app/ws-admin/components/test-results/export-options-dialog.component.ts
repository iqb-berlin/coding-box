import { Component, inject, OnInit } from '@angular/core';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { FormsModule } from '@angular/forms';
import { MatListModule } from '@angular/material/list';
import { MatTabsModule } from '@angular/material/tabs';
import { CommonModule } from '@angular/common';
import { BackendService } from '../../../services/backend.service';

export interface ExportOptions {
  groupNames: string[];
  bookletNames: string[];
  unitNames: string[];
  personIds: number[];
}

@Component({
  selector: 'coding-box-export-options-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    FormsModule,
    MatListModule,
    MatTabsModule
  ],
  template: `
    <h1 mat-dialog-title>Export-Optionen</h1>
    <div mat-dialog-content>
      <p>Wählen Sie die Daten aus, die exportiert werden sollen.</p>

      <mat-tab-group>
        <mat-tab label="Testgruppen">
          <div class="selection-actions">
            <button mat-button (click)="groupsList.selectAll()">Alle auswählen</button>
            <button mat-button (click)="groupsList.deselectAll()">Alle abwählen</button>
          </div>
          <div class="list-container">
            <mat-selection-list #groupsList [(ngModel)]="data.groupNames">
              @for (group of availableOptions.groups; track group) {
                <mat-list-option [value]="group">
                  {{ group }}
                </mat-list-option>
              }
            </mat-selection-list>
          </div>
        </mat-tab>

        <mat-tab label="Testpersonen">
          <div class="selection-actions">
            <button mat-button (click)="personsList.selectAll()">Alle auswählen</button>
            <button mat-button (click)="personsList.deselectAll()">Alle abwählen</button>
          </div>
          <div class="list-container">
            <mat-selection-list #personsList [(ngModel)]="data.personIds">
              @for (person of availableOptions.testPersons; track person.id) {
                <mat-list-option [value]="person.id">
                  {{ person.groupName }} - {{ person.code }} - {{ person.login }}
                </mat-list-option>
              }
            </mat-selection-list>
          </div>
        </mat-tab>

        <mat-tab label="Testhefte">
          <div class="selection-actions">
            <button mat-button (click)="bookletsList.selectAll()">Alle auswählen</button>
            <button mat-button (click)="bookletsList.deselectAll()">Alle abwählen</button>
          </div>
          <div class="list-container">
            <mat-selection-list #bookletsList [(ngModel)]="data.bookletNames">
              @for (booklet of availableOptions.booklets; track booklet) {
                <mat-list-option [value]="booklet">
                  {{ booklet }}
                </mat-list-option>
              }
            </mat-selection-list>
          </div>
        </mat-tab>

        <mat-tab label="Aufgaben">
          <div class="selection-actions">
            <button mat-button (click)="unitsList.selectAll()">Alle auswählen</button>
            <button mat-button (click)="unitsList.deselectAll()">Alle abwählen</button>
          </div>
          <div class="list-container">
            <mat-selection-list #unitsList [(ngModel)]="data.unitNames">
              @for (unit of availableOptions.units; track unit) {
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
      <button mat-button (click)="onNoClick()">Abbrechen</button>
      <button mat-raised-button color="primary" [mat-dialog-close]="data">Exportieren</button>
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
  `]
})
export class ExportOptionsDialogComponent implements OnInit {
  readonly dialogRef = inject(MatDialogRef<ExportOptionsDialogComponent>);
  readonly backendService = inject(BackendService);
  readonly dialogData = inject(MAT_DIALOG_DATA);

  data: ExportOptions = {
    groupNames: [],
    bookletNames: [],
    unitNames: [],
    personIds: []
  };

  availableOptions: {
    testPersons: { id: number; code: string; groupName: string; login: string }[];
    groups: string[];
    booklets: string[];
    units: string[];
  } = {
      testPersons: [],
      groups: [],
      booklets: [],
      units: []
    };

  ngOnInit(): void {
    if (this.dialogData && this.dialogData.workspaceId) {
      this.backendService.getExportOptions(this.dialogData.workspaceId).subscribe(options => {
        this.availableOptions = options;
      });
    }
  }

  onNoClick(): void {
    this.dialogRef.close();
  }
}
