import { Component, OnInit, inject } from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle
} from '@angular/material/dialog';

import { MatButton, MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { FormsModule } from '@angular/forms';
import { MatTooltip } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';
import { UnitNoteDto } from '../../../../../../../api-dto/unit-notes/unit-note.dto';
import { BackendService } from '../../../services/backend.service';
import { AppService } from '../../../services/app.service';
import { CreateUnitNoteDto } from '../../../../../../../api-dto/unit-notes/create-unit-note.dto';

@Component({
  selector: 'app-note-dialog',
  template: `
    <div class="dialog-header">
      <h1 mat-dialog-title>{{ data.title || 'Unit Notes' }}</h1>
      <div class="header-info">
        <span class="note-count">{{ notes.length }} Notes</span>
      </div>
    </div>

    <div mat-dialog-content>
      <div class="notes-section">
        <div class="section-header">
          <h2>Notes</h2>
        </div>

        <div class="notes-container">
          <div class="notes-list">
            @for (note of notes; track note) {
              <div class="note-item">
                <div class="note-header">
                  <span class="note-date">{{ formatDate(note.updatedAt) }}</span>
                  <div class="note-actions">
                    <button mat-icon-button (click)="deleteNote(note.id)" class="note-action-button" matTooltip="Note löschen">
                      <mat-icon>delete</mat-icon>
                    </button>
                  </div>
                </div>
                <div class="note-content">
                  {{ note.note }}
                </div>
              </div>
            }
          </div>
          <div class="add-note-form">
            <mat-form-field appearance="outline" class="note-input">
              <mat-label>Neue Notiz</mat-label>
              <textarea matInput [(ngModel)]="newNoteText" placeholder="Notiz eingeben" rows="3"></textarea>
            </mat-form-field>
            <button mat-raised-button color="primary" (click)="addNote()" class="add-note-button">
              <mat-icon>add</mat-icon>
              Hinzufügen
            </button>
          </div>
        </div>
      </div>
    </div>

    <div mat-dialog-actions align="end">
      <button mat-stroked-button (click)="closeDialog()">Schließen</button>
    </div>
    `,
  styles: [`
    /* Dialog Header */
    .dialog-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0 16px;
      margin-bottom: 8px;
    }

    h1 {
      margin: 0;
      font-size: 24px;
      color: #1976d2;
    }

    .header-info {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 8px;
    }

    .note-count {
      background-color: #e3f2fd;
      color: #1976d2;
      padding: 4px 8px;
      border-radius: 16px;
      font-size: 14px;
      font-weight: 500;
    }

    /* Section Headers */
    .section-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
      border-bottom: 1px solid #e0e0e0;
      padding-bottom: 8px;
    }

    h2 {
      margin: 0;
      font-size: 18px;
      color: #333;
      font-weight: 500;
    }

    /* Notes Section */
    .notes-section {
      background-color: #f9f9f9;
      border-radius: 8px;
      padding: 16px;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
    }

    .notes-container {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .notes-list {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .note-item {
      background-color: white;
      border-radius: 8px;
      padding: 12px;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
    }

    .note-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
      padding-bottom: 4px;
      border-bottom: 1px dashed #e0e0e0;
    }

    .note-date {
      font-size: 12px;
      color: #757575;
      font-style: italic;
    }

    .note-actions {
      display: flex;
      align-items: center;
    }

    .note-action-button {
      width: 24px;
      height: 24px;
      line-height: 24px;
    }

    .note-action-button mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
      line-height: 16px;
    }

    .note-content {
      font-size: 14px;
      color: #333;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .add-note-form {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-top: 16px;
    }

    .note-input {
      width: 100%;
    }

    .add-note-button {
      align-self: flex-end;
    }

    /* Dialog Content and Actions */
    mat-dialog-content {
      max-height: 500px;
      overflow-y: auto;
      padding: 0 16px;
    }

    mat-dialog-actions {
      margin-top: 16px;
      padding: 8px 16px;
      border-top: 1px solid #eee;
    }

    button[mat-stroked-button] {
      min-width: 100px;
    }
  `],
  imports: [
    MatDialogContent,
    MatDialogTitle,
    MatDialogActions,
    MatButton,
    MatIconButton,
    MatIcon,
    MatFormField,
    MatLabel,
    MatInput,
    FormsModule,
    MatTooltip
  ],
  standalone: true
})
export class NoteDialogComponent implements OnInit {
  dialogRef = inject<MatDialogRef<NoteDialogComponent>>(MatDialogRef);
  data = inject<{
    unitId: number;
    notes: UnitNoteDto[];
    title?: string;
  }>(MAT_DIALOG_DATA);

  private backendService = inject(BackendService);
  private appService = inject(AppService);
  private snackBar = inject(MatSnackBar);

  notes: UnitNoteDto[] = [];
  newNoteText: string = '';

  ngOnInit(): void {
    this.notes = [...this.data.notes];
  }

  /**
   * Format a date to a readable string
   * @param date The date to format
   * @returns A formatted date string
   */
  formatDate(date: Date): string {
    return new Date(date).toLocaleString('de-DE', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  /**
   * Add a new note to the unit
   */
  addNote(): void {
    if (!this.newNoteText.trim()) {
      this.snackBar.open(
        'Bitte geben Sie einen Notiz-Text ein',
        'Fehler',
        { duration: 3000 }
      );
      return;
    }

    const createNoteDto: CreateUnitNoteDto = {
      unitId: this.data.unitId,
      note: this.newNoteText.trim()
    };

    this.backendService.createUnitNote(
      this.appService.selectedWorkspaceId,
      createNoteDto
    ).subscribe({
      next: note => {
        this.notes.unshift(note); // Add to the beginning of the array
        this.newNoteText = ''; // Clear the input field

        this.snackBar.open(
          'Notiz erfolgreich hinzugefügt',
          'Erfolg',
          { duration: 3000 }
        );
      },
      error: () => {
        this.snackBar.open(
          'Fehler beim Hinzufügen der Notiz',
          'Fehler',
          { duration: 3000 }
        );
      }
    });
  }

  /**
   * Delete a note from the unit
   * @param noteId The ID of the note to delete
   */
  deleteNote(noteId: number): void {
    this.backendService.deleteUnitNote(
      this.appService.selectedWorkspaceId,
      noteId
    ).subscribe({
      next: success => {
        if (success) {
          this.notes = this.notes.filter(note => note.id !== noteId);

          this.snackBar.open(
            'Notiz erfolgreich gelöscht',
            'Erfolg',
            { duration: 3000 }
          );
        } else {
          this.snackBar.open(
            'Fehler beim Löschen der Notiz',
            'Fehler',
            { duration: 3000 }
          );
        }
      },
      error: () => {
        this.snackBar.open(
          'Fehler beim Löschen der Notiz',
          'Fehler',
          { duration: 3000 }
        );
      }
    });
  }

  /**
   * Closes the dialog and returns the updated notes
   */
  closeDialog(): void {
    this.dialogRef.close(this.notes);
  }
}
