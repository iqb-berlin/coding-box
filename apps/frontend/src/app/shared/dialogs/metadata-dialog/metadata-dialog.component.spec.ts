import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { TestBed } from '@angular/core/testing';
import { MetadataDialogComponent } from './metadata-dialog.component';
import { MetadataWebComponentService } from '../../services/metadata-web-component.service';

describe('MetadataDialog read-only capability', () => {
  async function open(mode?: 'readonly' | 'edit') {
    const close = jest.fn();
    await TestBed.configureTestingModule({
      imports: [MetadataDialogComponent],
      providers: [
        { provide: MatDialogRef, useValue: { close } },
        { provide: MetadataWebComponentService, useValue: { ensureRegistered: jest.fn() } },
        { provide: MAT_DIALOG_DATA, useValue: { title: 'Metadata', mode, metadataValues: { items: [] } } }
      ]
    }).compileComponents();
    const fixture = TestBed.createComponent(MetadataDialogComponent);
    fixture.autoDetectChanges();
    await fixture.whenStable();
    jest.advanceTimersByTime(100);
    await fixture.whenStable();
    return { fixture, close, component: fixture.componentInstance };
  }

  beforeEach(() => { jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'requestAnimationFrame'] }); });
  afterEach(() => { jest.useRealTimers(); });

  it.each([undefined, 'readonly'] as const)('prevents editing, late events and saving in mode %s', async mode => {
    const { fixture, component, close } = await open(mode);
    expect(fixture.nativeElement.querySelector('mat-slide-toggle')).toBeNull();
    component.isEditing.set(true);
    const form = fixture.nativeElement.querySelector('metadata-profile-form');
    form.dispatchEvent(new CustomEvent('metadataChange', { detail: { profiles: [] } }));
    await fixture.whenStable();
    expect(component.hasChanges()).toBe(false);
    expect(fixture.nativeElement.textContent).not.toContain('Speichern');
    expect(form.hasAttribute('readonly')).toBe(true);
    component.onEditModeChange();
    expect(component.isEditing()).toBe(false);
    component.close(true);
    expect(close).toHaveBeenCalledWith(null);
  });

  it('lets the explicit file editor enable editing and save a metadata event', async () => {
    const { fixture, component, close } = await open('edit');
    expect(component.isEditing()).toBe(false);
    fixture.nativeElement.querySelector('mat-slide-toggle button').click();
    await fixture.whenStable();
    fixture.nativeElement.querySelector('metadata-profile-form').dispatchEvent(new CustomEvent('metadataChange', { detail: { profiles: [] } }));
    await fixture.whenStable();
    expect(component.hasChanges()).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Speichern');
    component.close(true);
    expect(close).toHaveBeenCalledWith(component.localMetadataValues());
  });
});
