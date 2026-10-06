import { computed, provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateModule } from '@ngx-translate/core';
import { of, Subject } from 'rxjs';
import { EditMissingsProfilesDialogComponent } from './edit-missings-profiles-dialog.component';
import { AppService } from '../../../core/services/app.service';
import { MissingsProfileService } from '../../services/missings-profile.service';

describe('EditMissingsProfilesDialogComponent in zoneless mode', () => {
  let fixture: ComponentFixture<EditMissingsProfilesDialogComponent>;
  let closing: Subject<void>;

  beforeEach(async () => {
    closing = new Subject<void>();
    await TestBed.configureTestingModule({
      imports: [EditMissingsProfilesDialogComponent, TranslateModule.forRoot()],
      providers: [
        provideZonelessChangeDetection(),
        { provide: MAT_DIALOG_DATA, useValue: { workspaceId: 1 } },
        { provide: MatDialogRef, useValue: { close: jest.fn(), beforeClosed: () => closing } },
        { provide: MatSnackBar, useValue: { open: jest.fn() } },
        { provide: AppService, useValue: { selectedWorkspaceId: 1, selectedWorkspaceId$: of() } },
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
  it('keeps the newer profile selection when an older detail response arrives late', async () => {
    const component = fixture.componentInstance;
    const old = new Subject<{ id: number; label: string; missings: string }>();
    const latest = new Subject<{ id: number; label: string; missings: string }>();
    const service = TestBed.inject(MissingsProfileService);
    service.getMissingsProfileDetails = jest.fn().mockReturnValueOnce(old).mockReturnValueOnce(latest);
    component.missingsProfiles.set([{ id: 1, label: 'OLD' }, { id: 2, label: 'LATEST' }]);
    component.selectProfile('OLD');
    component.selectProfile('LATEST');
    expect(old.observed).toBe(false);
    old.next({ id: 1, label: 'OLD', missings: '[]' });
    expect(component.loading()).toBe(true);
    latest.next({ id: 2, label: 'LATEST', missings: '[]' });
    await fixture.whenStable();
    expect(component.selectedProfile()?.label).toBe('LATEST');
    expect(fixture.nativeElement.textContent).toContain('LATEST');
  });

  it('cancels a pending detail read when starting a new profile', async () => {
    const component = fixture.componentInstance;
    const detail = new Subject<{ id: number; label: string; missings: string }>();
    TestBed.inject(MissingsProfileService).getMissingsProfileDetails = jest.fn(() => detail) as never;
    component.missingsProfiles.set([{ id: 1, label: 'OLD' }]);
    component.selectProfile('OLD');
    component.createProfile();
    detail.next({ id: 1, label: 'OLD', missings: '[]' });
    await fixture.whenStable();
    expect(detail.observed).toBe(false);
    expect(component.selectedProfile()?.id).toBeUndefined();
    expect(component.editMode()).toBe(true);
    expect(component.editMissings()).toHaveLength(2);
  });

  it('stops save callbacks as soon as the dialog starts closing', async () => {
    const saved = new Subject<unknown>();
    TestBed.inject(MissingsProfileService).createMissingsProfile = jest.fn(() => saved) as never;
    fixture.componentInstance.saveProfile();
    expect(saved.observed).toBe(true);
    closing.next();
    expect(saved.observed).toBe(false);
    saved.next({ id: 1, label: 'LATE', missings: '[]' });
    expect(TestBed.inject(MatSnackBar).open).not.toHaveBeenCalled();
  });

  it('protects the submitted draft from selection and editing while a save is pending', async () => {
    const saved = new Subject<unknown>();
    const service = TestBed.inject(MissingsProfileService);
    service.createMissingsProfile = jest.fn(() => saved) as never;
    const component = fixture.componentInstance;
    component.setSelectedProfileField('label', 'DRAFT');
    component.missingsProfiles.set([{ id: 2, label: 'OTHER' }]);
    const draft = component.selectedProfile();
    const rows = component.editMissings();
    component.saveProfile();
    await fixture.whenStable();
    expect([...fixture.nativeElement.querySelectorAll('input')].every((input: HTMLInputElement) => input.disabled)).toBe(true);
    component.selectProfile('OTHER');
    component.createProfile();
    component.cancelEdit();
    component.setSelectedProfileField('label', 'CHANGED');
    component.setMissingField(0, 'label', 'CHANGED');
    component.addMissing();
    component.removeMissing(0);
    component.saveProfile();
    component.deleteProfile();
    expect(component.selectedProfile()).toBe(draft);
    expect(component.editMissings()).toBe(rows);
    expect(service.createMissingsProfile).toHaveBeenCalledTimes(1);
    saved.next(null);
    await fixture.whenStable();
    expect(component.saving()).toBe(false);
    component.createProfile();
    expect(component.selectedProfile()).not.toBe(draft);
  });
});
