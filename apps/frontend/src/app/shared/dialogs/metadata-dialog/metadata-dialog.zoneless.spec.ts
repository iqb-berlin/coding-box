import { MetadataResolver } from '@iqb/metadata-resolver';
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MetadataDialogComponent } from './metadata-dialog.component';

import { MetadataWebComponentService } from '../../services/metadata-web-component.service';

describe('Metadata dialog without Zone.js', () => {
  beforeEach(async () => {
    jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'requestAnimationFrame'] });
    await TestBed.configureTestingModule({
      imports: [MetadataDialogComponent, NoopAnimationsModule],
      providers: [
        provideZonelessChangeDetection(),
        { provide: MetadataWebComponentService, useValue: { ensureRegistered: jest.fn() } },
        { provide: MatDialogRef, useValue: { close: jest.fn() } },
        { provide: MAT_DIALOG_DATA, useValue: { title: 'Metadata', metadataValues: { profiles: [], items: [] } } }
      ]
    }).compileComponents();
  });
  afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

  it('removes the loading indicator after deferred initialization', async () => {
    const fixture = TestBed.createComponent(MetadataDialogComponent);
    fixture.autoDetectChanges();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('mat-progress-spinner')).not.toBeNull();
    jest.advanceTimersByTime(100);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('mat-progress-spinner')).toBeNull();
  });

  it('shows the save action after a metadata web-component event', async () => {
    const fixture = TestBed.createComponent(MetadataDialogComponent);
    fixture.autoDetectChanges();
    await fixture.whenStable();
    jest.advanceTimersByTime(100);
    await fixture.whenStable();
    fixture.nativeElement.querySelector('mat-slide-toggle button').click();
    await fixture.whenStable();
    const form = fixture.nativeElement.querySelector('metadata-profile-form');
    form.dispatchEvent(new CustomEvent('metadataChange', { detail: { profiles: [] } }));
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('Speichern');
  });
  it('cancels its initialization timer when destroyed', async () => {
    const fixture = TestBed.createComponent(MetadataDialogComponent);
    fixture.autoDetectChanges();
    await fixture.whenStable();
    fixture.destroy();
    const replacement = document.createElement('metadata-profile-form') as HTMLElement & { metadataValues?: unknown };
    replacement.id = 'metadata-form';
    document.body.appendChild(replacement);
    try {
      jest.advanceTimersByTime(100);
      expect(replacement.metadataValues).toBeUndefined();
    } finally {
      replacement.remove();
    }
  });

  it('removes the web-component listener when destroyed', async () => {
    const fixture = TestBed.createComponent(MetadataDialogComponent);
    fixture.autoDetectChanges();
    await fixture.whenStable();
    jest.advanceTimersByTime(100);
    await fixture.whenStable();
    const form = fixture.nativeElement.querySelector('metadata-profile-form');
    fixture.destroy();
    form.dispatchEvent(new CustomEvent('metadataChange', { detail: { profiles: [] } }));
    expect(fixture.componentInstance.hasChanges()).toBe(false);
  });
  async function openPair() {
    const fixtures = ['first', 'second'].map(title => {
      const fixture = TestBed.createComponent(MetadataDialogComponent);
      fixture.componentInstance.data = {
        title,
        profileData: {
          id: `${title}-unit`, label: [], target: ['UNIT'], groups: []
        },
        itemProfileData: {
          id: `${title}-item`, label: [], target: ['ITEM'], groups: []
        },
        metadataValues: {
          profiles: [{ profileId: `${title}-unit`, entries: [] }],
          items: [{
            id: `${title}-item`, uuid: `${title}-uuid`, variableId: null, description: null, profiles: [{ profileId: `${title}-item`, entries: [] }]
          }]
        }
      };
      fixture.autoDetectChanges();
      return fixture;
    });
    await Promise.all(fixtures.map(fixture => fixture.whenStable()));
    jest.advanceTimersByTime(100);
    await Promise.all(fixtures.map(fixture => fixture.whenStable()));
    return fixtures;
  }

  it('initializes each simultaneously opened dialog with its own profile', async () => {
    const fixtures = await openPair();
    expect(fixtures[0].nativeElement.querySelector('metadata-profile-form').profileData.id).toBe('first-unit');
    expect(fixtures[1].nativeElement.querySelector('metadata-profile-form').profileData.id).toBe('second-unit');
  });

  it('changes edit mode only in the dialog whose toggle was clicked', async () => {
    const [first, second] = await openPair();
    second.nativeElement.querySelector('mat-slide-toggle button').click();
    await second.whenStable();
    expect(first.nativeElement.querySelector('metadata-profile-form').readonly).toBe(true);
    expect(second.nativeElement.querySelector('metadata-profile-form').readonly).toBe(false);
  });

  it('routes metadata changes to their originating dialog only', async () => {
    const [first, second] = await openPair();
    second.nativeElement.querySelector('metadata-profile-form').dispatchEvent(new CustomEvent('metadataChange', {
      detail: { profiles: [{ profileId: 'second-unit', entries: [] }] }
    }));
    await second.whenStable();
    expect(second.componentInstance.hasChanges()).toBe(true);
    expect(first.componentInstance.hasChanges()).toBe(false);
  });

  it('changes the selected profile only in the dialog whose selector was used', async () => {
    const [first, second] = await openPair();
    second.nativeElement.querySelector('mat-select').click();
    await second.whenStable();
    const option = Array.from(document.querySelectorAll('mat-option')).find(element => element.textContent?.includes('second-item')) as HTMLElement;
    option.click();
    await second.whenStable();
    expect(first.nativeElement.querySelector('metadata-profile-form').profileData.id).toBe('first-unit');
    expect(second.nativeElement.querySelector('metadata-profile-form').profileData.id).toBe('second-item');
  });
  it('provides vocabularies using the library contract without mutating resolver data', async () => {
    const resolver = new MetadataResolver();
    const vocabulary = { url: '/vocabulary', data: { hasTopConcept: [{ id: 'A', prefLabel: { en: 'Term A' }, narrower: [{ id: 'B' }] }] }, dictionary: {} };
    jest.spyOn(resolver, 'getVocabularies').mockReturnValue([vocabulary]);
    const fixture = TestBed.createComponent(MetadataDialogComponent);
    fixture.componentInstance.data.resolver = resolver;
    fixture.autoDetectChanges();
    await fixture.whenStable();
    jest.advanceTimersByTime(100);
    await fixture.whenStable();
    const provider = fixture.nativeElement.querySelector('metadata-profile-form').vocabularyProvider;
    expect(provider.getVocabularies()[0].data.hasTopConcept).toEqual([
      {
        id: 'A',
        notation: [],
        prefLabel: { en: 'Term A', de: 'Term A' },
        narrower: [
          {
            id: 'B', notation: [], prefLabel: { de: '' }, narrower: []
          }
        ]
      }
    ]);
    expect(vocabulary.data.hasTopConcept[0]).not.toHaveProperty('notation');
    expect(vocabulary.data.hasTopConcept[0].prefLabel).toEqual({ en: 'Term A' });
  });
});
