import { Clipboard } from '@angular/cdk/clipboard';
import { Component, provideZonelessChangeDetection, Type } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DEFAULT_OPTIONS, MatDialog, MatDialogConfig } from '@angular/material/dialog';
import { MAT_TABS_CONFIG } from '@angular/material/tabs';
import { TranslateModule } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
import { BookletInfoDialogComponent } from './booklet-info-dialog/booklet-info-dialog.component';
import { UnitInfoDialogComponent } from './unit-info-dialog/unit-info-dialog.component';

@Component({ standalone: true, template: '' })
class DialogHost {}

const variants = [
  {
    name: 'booklet',
    component: BookletInfoDialogComponent,
    selector: 'coding-box-booklet-info-dialog',
    data: {
      bookletId: 'BOOKLET_ZL',
      bookletInfo: {
        metadata: { id: 'BOOKLET_ZL', label: 'Booklet metadata' },
        rawXml: '<Booklet id="BOOKLET_ZL"/>',
        restrictions: [{ type: 'timeMax', value: '60' }],
        config: { items: [{ key: 'syntheticConfig', value: 'enabled' }] },
        units: [{ id: 'INSIDE', position: 1 }, { id: 'OUTSIDE', position: 2 }],
        testlets: [{ id: 'TESTLET_ZL', units: [{ id: 'INSIDE', position: 1 }] }]
      }
    },
    tabs: [['Metadaten', 'Booklet metadata'], ['Konfiguration (1)', 'syntheticConfig'], ['Testlets (1)', 'INSIDE'], ['Aufgaben (1)', 'OUTSIDE']]
  },
  {
    name: 'unit',
    component: UnitInfoDialogComponent,
    selector: 'coding-box-unit-info-dialog',
    data: {
      unitId: 'UNIT_ZL',
      unitInfo: {
        metadata: { id: 'UNIT_ZL', label: 'Unit metadata' },
        rawXml: '<Unit id="UNIT_ZL"/>',
        definition: { type: 'verona', player: 'PLAYER_ZL', content: 'Synthetic definition' },
        baseVariables: [{ id: 'BASE_ZL', type: 'string', values: [{ label: 'synthetic', value: 'value' }] }],
        derivedVariables: [{ id: 'DERIVED_ZL', type: 'integer' }],
        dependencies: [{ type: 'resource', for: 'PLAYER_ZL', content: 'RESOURCE_ZL' }],
        codingSchemeRef: { schemer: 'SCHEMER_ZL', content: 'SCHEME_ZL' }
      }
    },
    tabs: [['Metadaten', 'Unit metadata'], ['Definition', 'PLAYER_ZL'], ['Variablen', 'DERIVED_ZL'], ['Abhängigkeiten', 'RESOURCE_ZL'], ['Kodierungsschema', 'SCHEME_ZL']]
  }
];

describe.each(variants)('$name information dialog without Zone', variant => {
  let host: ComponentFixture<DialogHost>;
  let dialogs: MatDialog;
  let copy: jest.Mock;

  beforeEach(async () => {
    copy = jest.fn().mockReturnValue(true);
    await TestBed.configureTestingModule({
      imports: [DialogHost, BookletInfoDialogComponent, UnitInfoDialogComponent, TranslateModule.forRoot()],
      providers: [
        provideZonelessChangeDetection(),
        { provide: Clipboard, useValue: { copy } },
        // JSDOM has no CSS transition events. Use Material's supported timings.
        { provide: MAT_DIALOG_DEFAULT_OPTIONS, useValue: { ...new MatDialogConfig(), enterAnimationDuration: 0, exitAnimationDuration: 0 } },
        { provide: MAT_TABS_CONFIG, useValue: { animationDuration: '0ms' } }
      ]
    }).compileComponents();
    host = TestBed.createComponent(DialogHost);
    host.autoDetectChanges();
    dialogs = TestBed.inject(MatDialog);
    dialogs.open(variant.component as Type<unknown>, { data: variant.data });
    await host.whenStable();
  });

  afterEach(async () => {
    jest.useRealTimers();
    await closeAllDialogs();
    host.destroy();
  });

  async function closeAllDialogs(): Promise<void> {
    const closed = dialogs.openDialogs.map(dialog => firstValueFrom(dialog.afterClosed()));
    dialogs.closeAll();
    await Promise.all(closed);
    await host.whenStable();
  }

  function element(): HTMLElement {
    return document.querySelector(variant.selector)!;
  }

  it('renders every available tab after a regular tab click', async () => {
    for (const [label, content] of variant.tabs) {
      const tab = Array.from(element().querySelectorAll<HTMLElement>('[role="tab"]'))
        .find(item => item.textContent?.trim() === label)!;
      tab.click();
      await host.whenStable();
      expect(tab.getAttribute('aria-selected')).toBe('true');
      expect(element().querySelector('.mat-mdc-tab-body-active')?.textContent).toContain(content);
    }
  });

  it('updates the embedded copy confirmation after the timer', async () => {
    jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'requestAnimationFrame'] });
    const button = element().querySelector<HTMLButtonElement>('[aria-label="xml-viewer.copy-xml"]')!;
    button.click();
    await host.whenStable();
    expect(button.textContent).toContain('done');
    jest.advanceTimersByTime(1500);
    await host.whenStable();
    expect(button.textContent).toContain('content_copy');
    expect(copy).toHaveBeenCalledTimes(1);
  });

  it('renders minimal data without optional tabs or an endless loading indicator', async () => {
    await closeAllDialogs();
    const data = variant.name === 'booklet' ? {
      bookletId: 'EMPTY',
      bookletInfo: {
        metadata: { id: 'EMPTY' }, units: [], restrictions: [], rawXml: ''
      }
    } : {
      unitId: 'EMPTY', unitInfo: { metadata: { id: 'EMPTY' }, definition: { type: 'verona', player: 'PLAYER' }, rawXml: '' }
    };
    dialogs.open(variant.component as Type<unknown>, { data });
    await host.whenStable();
    const labels = Array.from(element().querySelectorAll('[role="tab"]')).map(tab => tab.textContent?.trim());
    expect(labels).toEqual(variant.name === 'booklet' ? ['XML', 'Metadaten'] : ['Roh-XML', 'Metadaten', 'Definition']);
    expect(element().querySelector('mat-spinner')).toBeNull();
    expect(element().querySelector('.xml-code')?.textContent).toBe('');
  });

  it.each(['header', 'footer'])('closes through the %s action and reopens without stale copy state', async position => {
    element().querySelector<HTMLButtonElement>('[aria-label="xml-viewer.copy-xml"]')!.click();
    await host.whenStable();
    expect(element().querySelector('[aria-label="xml-viewer.copy-xml"]')?.textContent).toContain('done');
    const button = position === 'header' ? element().querySelector<HTMLButtonElement>('.close-button')! :
      Array.from(element().querySelectorAll('button')).find(item => item.textContent?.trim() === 'Schließen')!;
    const closed = firstValueFrom(dialogs.openDialogs[0].afterClosed());
    button.click();
    await closed;
    await host.whenStable();
    expect(document.querySelector(variant.selector)).toBeNull();
    dialogs.open(variant.component as Type<unknown>, { data: variant.data });
    await host.whenStable();
    expect(element().querySelector('[aria-label="xml-viewer.copy-xml"]')?.textContent).toContain('content_copy');
  });
});
