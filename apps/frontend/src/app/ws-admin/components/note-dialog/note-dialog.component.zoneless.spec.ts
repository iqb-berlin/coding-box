import {
  Component, inject, provideZonelessChangeDetection
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { Subject } from 'rxjs';
import { NoteDialogComponent } from './note-dialog.component';
import { UnitNoteService } from '../../../shared/services/unit/unit-note.service';
import { AppService } from '../../../core/services/app.service';
import { UnitNoteDto } from '../../../../../../../api-dto/unit-notes/unit-note.dto';

jest.unmock('@angular/material/snack-bar');

@Component({
  standalone: true,
  template: '<button (click)="open()">Open notes</button>'
})
class NotesDialogHostComponent {
  readonly dialog = inject(MatDialog);
  notes: UnitNoteDto[] = [];

  open(): void {
    this.dialog.open(NoteDialogComponent, { data: { unitId: 9, notes: this.notes } });
  }
}

describe('NoteDialogComponent zoneless mutations', () => {
  let fixture: ComponentFixture<NotesDialogHostComponent>;
  let createResponse: Subject<UnitNoteDto>;
  let deleteResponse: Subject<boolean>;
  let createUnitNote: jest.Mock;
  let deleteUnitNote: jest.Mock;

  const note: UnitNoteDto = {
    id: 1,
    unitId: 9,
    note: 'Prüfnotiz',
    createdAt: new Date('2026-01-01T12:00:00Z'),
    updatedAt: new Date('2026-01-01T12:00:00Z')
  };

  beforeEach(async () => {
    createResponse = new Subject<UnitNoteDto>();
    deleteResponse = new Subject<boolean>();
    createUnitNote = jest.fn().mockReturnValue(createResponse);
    deleteUnitNote = jest.fn().mockReturnValue(deleteResponse);
    await TestBed.configureTestingModule({
      imports: [NotesDialogHostComponent, MatDialogModule, MatSnackBarModule],
      providers: [
        provideZonelessChangeDetection(),
        { provide: UnitNoteService, useValue: { createUnitNote, deleteUnitNote } },
        { provide: AppService, useValue: { selectedWorkspaceId: 1 } }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(NotesDialogHostComponent);
    await fixture.whenStable();
  });

  afterEach(async () => {
    TestBed.inject(MatSnackBar).dismiss();
    TestBed.inject(MatDialog).closeAll();
    await fixture.whenStable();
    fixture.destroy();
  });

  async function openDialog(notes: UnitNoteDto[] = []): Promise<MatDialogRef<NoteDialogComponent>> {
    fixture.componentInstance.notes = notes;
    fixture.nativeElement.querySelector('button').click();
    await fixture.whenStable();
    return TestBed.inject(MatDialog).openDialogs[0] as MatDialogRef<NoteDialogComponent>;
  }

  it('renders a delayed added note and clears the input without another interaction', async () => {
    const dialogRef = await openDialog();
    const textarea = document.querySelector('app-note-dialog textarea') as HTMLTextAreaElement;
    textarea.value = note.note;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    await fixture.whenStable();
    (document.querySelector('.add-note-button') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(createUnitNote).toHaveBeenCalledWith(1, { unitId: 9, note: note.note });
    expect(document.querySelector('.note-content')).toBeNull();

    createResponse.next(note);
    createResponse.complete();
    await fixture.whenStable();

    expect(dialogRef.componentInstance.notes).toEqual([note]);
    expect(document.querySelector('.note-content')?.textContent).toContain(note.note);
    expect(document.querySelector('.note-count')?.textContent).toContain('1 Notizen');
    expect(textarea.value).toBe('');
    expect(document.querySelector('mat-snack-bar-container')?.textContent).toContain('Notiz erfolgreich hinzugefügt');
  });

  it('removes a note after delayed delete success without another interaction', async () => {
    const dialogRef = await openDialog([note]);
    expect(document.querySelector('.note-content')?.textContent).toContain(note.note);
    (document.querySelector('.note-action-button') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(deleteUnitNote).toHaveBeenCalledWith(1, note.id);
    expect(document.querySelector('.note-content')).not.toBeNull();

    deleteResponse.next(true);
    deleteResponse.complete();
    await fixture.whenStable();

    expect(dialogRef.componentInstance.notes).toEqual([]);
    expect(document.querySelector('.note-content')).toBeNull();
    expect(document.querySelector('.note-count')?.textContent).toContain('0 Notizen');
    expect(document.querySelector('mat-snack-bar-container')?.textContent).toContain('Notiz erfolgreich gelöscht');
  });
});
