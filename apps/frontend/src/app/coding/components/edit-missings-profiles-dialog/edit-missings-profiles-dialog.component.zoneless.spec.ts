import { computed, provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateModule } from '@ngx-translate/core';
import { of } from 'rxjs';
import { EditMissingsProfilesDialogComponent } from './edit-missings-profiles-dialog.component';
import { AppService } from '../../../core/services/app.service';
import { MissingsProfileService } from '../../services/missings-profile.service';

describe('EditMissingsProfilesDialogComponent in zoneless mode', () => {
  let fixture: ComponentFixture<EditMissingsProfilesDialogComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EditMissingsProfilesDialogComponent, TranslateModule.forRoot()],
      providers: [
        provideZonelessChangeDetection(),
        { provide: MAT_DIALOG_DATA, useValue: { workspaceId: 1 } },
        { provide: MatDialogRef, useValue: { close: jest.fn() } },
        { provide: MatSnackBar, useValue: { open: jest.fn() } },
        { provide: AppService, useValue: {} },
        { provide: MissingsProfileService, useValue: { getMissingsProfiles: () => of([]) } }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(EditMissingsProfilesDialogComponent);
    fixture.autoDetectChanges();
    await fixture.whenStable();
    fixture.componentInstance.createProfile();
    await fixture.whenStable();
  });

  afterEach(() => fixture.destroy());

  it('keeps input identity and focus while successive edits publish fresh signal rows', async () => {
    const component = fixture.componentInstance;
    const previousRows = component.editMissings();
    const label = computed(() => component.editMissings()[0].label);
    const id = computed(() => component.editMissings()[0].id);
    expect(label()).toBe('missing invalid response');
    expect(id()).toBe('mir');
    const labelInput: HTMLInputElement = fixture.nativeElement.querySelector('.mat-column-label input');
    labelInput.focus();
    labelInput.value = 'A';
    labelInput.dispatchEvent(new Event('input', { bubbles: true }));
    labelInput.value = 'AB';
    labelInput.dispatchEvent(new Event('input', { bubbles: true }));
    await fixture.whenStable();
    expect(label()).toBe('AB');
    expect(fixture.nativeElement.querySelector('.mat-column-label input')).toBe(labelInput);
    expect(document.activeElement).toBe(labelInput);
    expect(previousRows[0].label).toBe('missing invalid response');

    labelInput.value = 'ABC';
    labelInput.dispatchEvent(new Event('input', { bubbles: true }));
    await fixture.whenStable();
    expect(label()).toBe('ABC');
    expect(document.activeElement).toBe(labelInput);

    const idInput: HTMLInputElement = fixture.nativeElement.querySelector('.mat-column-id input');
    idInput.focus();
    idInput.value = 'changed-id';
    idInput.dispatchEvent(new Event('input', { bubbles: true }));
    await fixture.whenStable();
    expect(id()).toBe('changed-id');
    expect(fixture.nativeElement.querySelector('.mat-column-id input')).toBe(idInput);
    expect(document.activeElement).toBe(idInput);
    expect(previousRows[0].id).toBe('mir');

    component.setMissingField(0, 'label', 'External update');
    await fixture.whenStable();
    expect(labelInput.value).toBe('External update');
    expect(fixture.nativeElement.querySelector('.mat-column-label input')).toBe(labelInput);
  });
});
