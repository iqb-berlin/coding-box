import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { of, Subject, throwError } from 'rxjs';
import { GermanTranslationsTestingModule } from '../../../../testing/german-translations';
import { TestcenterInstancesService } from '../../../core/services/testcenter-instances.service';
import { TestcenterSettingsComponent } from './testcenter-settings.component';
import type { TestcenterInstanceDto } from '../../../../../../../api-dto/testcenter/testcenter-instance.dto';

describe('System administrator Testcenter approvals', () => {
  const custom: TestcenterInstanceDto = { label: 'Study', baseUrl: 'https://study.example/tci', source: 'administrator' };
  const builtin: TestcenterInstanceDto = { label: 'Testcenter 1', baseUrl: 'https://iqb-testcenter1.de', source: 'standard' };
  const service = {
    getInstances: jest.fn(), saveInstance: jest.fn(), deleteInstance: jest.fn(), testConnection: jest.fn()
  };

  const dialog = { open: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    dialog.open.mockReturnValue({ afterClosed: () => of(true) });
    service.getInstances.mockReturnValue(of([builtin]));
    await TestBed.configureTestingModule({
      imports: [GermanTranslationsTestingModule, TestcenterSettingsComponent],
      providers: [provideZonelessChangeDetection(), { provide: TestcenterInstancesService, useValue: service }, { provide: MatDialog, useValue: dialog }]
    }).compileComponents();
  });

  it.each(['https://study.example/tci', 'http://study.example:8080/tci'])('saves an approval and immediately renders its name and revocation action: %s', async baseUrl => {
    service.saveInstance.mockReturnValue(of([builtin, { ...custom, baseUrl }]));
    const fixture = TestBed.createComponent(TestcenterSettingsComponent);
    fixture.autoDetectChanges();
    await fixture.whenStable();
    const enter = (name: string, value: string) => {
      const input: HTMLInputElement = fixture.nativeElement.querySelector(`input[name="${name}"]`);
      input.value = value;
      input.dispatchEvent(new Event('input'));
    };
    enter('name', 'Study');
    enter('baseUrl', baseUrl);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('button[type="submit"]').disabled).toBe(false);
    const warning = fixture.nativeElement.querySelector('form .http-warning');
    if (baseUrl.startsWith('http:')) {
      expect(warning.textContent).toContain('Unverschlüsselte Übertragung (HTTP)');
      expect(warning.textContent).toContain('Kennwort, Sitzungstoken und Testdaten');
    } else expect(warning).toBeNull();
    fixture.nativeElement.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await fixture.whenStable();
    expect(service.saveInstance).toHaveBeenCalledWith({ label: 'Study', baseUrl });
    const rows: HTMLLIElement[] = [...fixture.nativeElement.querySelectorAll('li')];
    expect(rows[0].textContent).toContain('Study');
    expect(rows[0].textContent).toContain('Freigabe aufheben');
    expect(rows[1].textContent).toContain('Freigabe aufheben');
    expect(rows[0].querySelector('.http-warning') !== null).toBe(baseUrl.startsWith('http:'));
    expect(rows[1].querySelector('.http-warning')).toBeNull();
    expect(fixture.nativeElement.querySelector('form').classList.contains('ng-submitted')).toBe(false);
  });

  it('updates the transport warning while typing and keeps unsupported protocols invalid', async () => {
    const fixture = TestBed.createComponent(TestcenterSettingsComponent);
    fixture.autoDetectChanges();
    await fixture.whenStable();
    const input: HTMLInputElement = fixture.nativeElement.querySelector('input[name="baseUrl"]');
    for (const [value, warning, valid] of [
      ['HTTP://study.example:8080/tci', true, true],
      ['https://study.example/tci', false, true],
      ['ftp://study.example/tci', false, false]
    ] as const) {
      input.value = value;
      input.dispatchEvent(new Event('input'));
      await fixture.whenStable();
      expect(fixture.nativeElement.querySelector('form .http-warning') !== null).toBe(warning);
      expect(input.classList.contains('ng-valid')).toBe(valid);
    }
  });

  it('reports the version probe scope without claiming that login or data access succeeded', async () => {
    service.testConnection.mockReturnValue(of({ version: '19.0.1', checkedAt: '2026-11-04T12:00:00Z' }));
    const fixture = TestBed.createComponent(TestcenterSettingsComponent);
    fixture.autoDetectChanges();
    await fixture.whenStable();
    fixture.nativeElement.querySelector('li button').click();
    await fixture.whenStable();
    expect(service.testConnection).toHaveBeenCalledWith(builtin.baseUrl);
    expect(fixture.nativeElement.textContent).toContain('gemeldete Testcenter-Version: 19.0.1');
    expect(fixture.nativeElement.textContent).toContain('vollständiger Import werden damit nicht geprüft');
  });

  it('renames only the selected instance and keeps its original URL even if the form value changes', async () => {
    service.getInstances.mockReturnValue(of([builtin, custom]));
    service.saveInstance.mockReturnValue(of([builtin, { ...custom, label: 'Renamed study' }]));
    const fixture = TestBed.createComponent(TestcenterSettingsComponent);
    fixture.autoDetectChanges();
    await fixture.whenStable();
    const edit: HTMLButtonElement = [...fixture.nativeElement.querySelectorAll('button')]
      .find(button => button.textContent.includes('Name bearbeiten'));
    edit.click();
    await fixture.whenStable();
    const url: HTMLInputElement = fixture.nativeElement.querySelector('input[name="baseUrl"]');
    expect(url.readOnly).toBe(true);
    expect(url.value).toBe(custom.baseUrl);
    const name: HTMLInputElement = fixture.nativeElement.querySelector('input[name="name"]');
    name.value = 'Renamed study';
    name.dispatchEvent(new Event('input'));
    // Readonly blocks ordinary edits; retaining the URL also protects against a stale/form-programmatic change.
    url.value = 'https://another.example/tci';
    url.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    fixture.nativeElement.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await fixture.whenStable();
    expect(service.saveInstance).toHaveBeenCalledWith({ label: 'Renamed study', baseUrl: custom.baseUrl });
    expect(fixture.nativeElement.querySelectorAll('li')).toHaveLength(2);
    expect(url.readOnly).toBe(false);
    expect(url.value).toBe('');
  });

  it('can cancel renaming and enter a new URL without changing the saved approval', async () => {
    service.getInstances.mockReturnValue(of([custom]));
    const fixture = TestBed.createComponent(TestcenterSettingsComponent);
    fixture.autoDetectChanges();
    await fixture.whenStable();
    const button = (label: string): HTMLButtonElement => [...fixture.nativeElement.querySelectorAll('button')]
      .find(entry => entry.textContent.includes(label));
    button('Name bearbeiten').click();
    await fixture.whenStable();
    expect(button('Name speichern')).toBeDefined();
    button('Abbrechen').click();
    await fixture.whenStable();
    const url: HTMLInputElement = fixture.nativeElement.querySelector('input[name="baseUrl"]');
    expect(url.readOnly).toBe(false);
    expect(url.value).toBe('');
    expect(fixture.nativeElement.querySelector('input[name="name"]').value).toBe('');
    expect(service.saveInstance).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('li').textContent).toContain(custom.baseUrl);
  });

  it('clears an unfinished rename when that approval is revoked', async () => {
    service.getInstances.mockReturnValue(of([custom]));
    service.deleteInstance.mockReturnValue(of([]));
    const fixture = TestBed.createComponent(TestcenterSettingsComponent);
    fixture.autoDetectChanges();
    await fixture.whenStable();
    const button = (label: string): HTMLButtonElement => [...fixture.nativeElement.querySelectorAll('button')]
      .find(entry => entry.textContent.includes(label));
    button('Name bearbeiten').click();
    await fixture.whenStable();
    button('Freigabe aufheben').click();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('input[name="baseUrl"]').readOnly).toBe(false);
    expect(fixture.nativeElement.querySelector('input[name="baseUrl"]').value).toBe('');
    expect(fixture.nativeElement.querySelector('button[type="submit"]').disabled).toBe(true);
  });

  it('requires confirmation for installation-wide revocation and preserves approvals when cancelled', async () => {
    service.getInstances.mockReturnValue(of([builtin]));
    dialog.open.mockReturnValue({ afterClosed: () => of(false) });
    const fixture = TestBed.createComponent(TestcenterSettingsComponent);
    fixture.autoDetectChanges();
    await fixture.whenStable();
    const remove = [...fixture.nativeElement.querySelectorAll('button')].find(button => button.textContent.includes('Freigabe aufheben')) as HTMLButtonElement;
    remove.click();
    await fixture.whenStable();
    expect(dialog.open).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      data: expect.objectContaining({
        content: expect.stringContaining('gesamte Kodierbox'), showCancel: true
      })
    }));
    expect(service.deleteInstance).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain(builtin.baseUrl);
    expect(remove.disabled).toBe(false);
  });

  it.each([
    ['TESTCENTER_INSTANCE_LIMIT', '100 zusätzliche'],
    ['TESTCENTER_OPERATOR_MANAGED', 'Betreiber'],
    ['TESTCENTER_INVALID_URL', 'Basisadresse ist ungültig']
  ])('explains save failure %s with an actionable message', async (code, expected) => {
    service.saveInstance.mockReturnValue(throwError(() => ({ status: 400, error: { code } })));
    const fixture = TestBed.createComponent(TestcenterSettingsComponent);
    fixture.autoDetectChanges();
    await fixture.whenStable();
    for (const [name, value] of [['name', 'Study'], ['baseUrl', custom.baseUrl]]) {
      const input: HTMLInputElement = fixture.nativeElement.querySelector(`input[name="${name}"]`);
      input.value = value;
      input.dispatchEvent(new Event('input'));
    }
    await fixture.whenStable();
    fixture.nativeElement.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('[role="alert"]').textContent).toContain(expected);
  });

  it.each([
    ['TESTCENTER_CERTIFICATE_ERROR', 'HTTPS-Zertifikat'],
    ['TESTCENTER_INVALID_VERSION', 'keine gültige Testcenter-Version'],
    ['TESTCENTER_CONNECTION_TIMEOUT', 'zehn Sekunden']
  ])('explains probe failure %s', async (code, expected) => {
    service.testConnection.mockReturnValue(throwError(() => ({ status: 503, error: { code } })));
    const fixture = TestBed.createComponent(TestcenterSettingsComponent);
    fixture.autoDetectChanges();
    await fixture.whenStable();
    fixture.nativeElement.querySelector('li button').click();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('[role="status"]').textContent).toContain(expected);
  });

  it('does not let an older discovery response overwrite a revocation', async () => {
    service.getInstances.mockReturnValue(of([custom]));
    service.deleteInstance.mockReturnValue(of([]));
    service.saveInstance.mockReturnValue(throwError(() => ({ status: 400 })));
    const fixture = TestBed.createComponent(TestcenterSettingsComponent);
    fixture.autoDetectChanges();
    await fixture.whenStable();
    const state = fixture.componentInstance as unknown as { load(): void; remove(value: TestcenterInstanceDto): void };
    for (const [name, value] of [['name', 'Study'], ['baseUrl', custom.baseUrl]]) {
      const input: HTMLInputElement = fixture.nativeElement.querySelector(`input[name="${name}"]`);
      input.value = value;
      input.dispatchEvent(new Event('input'));
    }
    await fixture.whenStable();
    fixture.nativeElement.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await fixture.whenStable();
    const discovery = new Subject<TestcenterInstanceDto[]>();
    service.getInstances.mockReturnValue(discovery);
    const reload: HTMLButtonElement = [...fixture.nativeElement.querySelectorAll('button')].find(button => button.textContent.includes('Liste erneut laden'));
    reload.click();
    await fixture.whenStable();
    expect(fixture.nativeElement.contains(reload)).toBe(false);
    const remove: HTMLButtonElement = [...fixture.nativeElement.querySelectorAll('li button')].find(button => button.textContent.includes('Freigabe aufheben'));
    expect(remove.disabled).toBe(true);
    state.remove(custom);
    expect(dialog.open).not.toHaveBeenCalled();
    expect(service.deleteInstance).not.toHaveBeenCalled();
    discovery.next([custom]);
    discovery.complete();
    await fixture.whenStable();
    state.remove(custom);
    expect(service.deleteInstance).toHaveBeenCalledWith(custom.baseUrl);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelectorAll('li')).toHaveLength(0);
  });

  it('waits for an active connection probe before allowing approval changes or reload', async () => {
    service.getInstances.mockReturnValue(of([custom]));
    service.deleteInstance.mockReturnValue(of([]));
    const probe = new Subject<{ version: string; checkedAt: string }>();
    service.testConnection.mockReturnValue(probe);
    const fixture = TestBed.createComponent(TestcenterSettingsComponent);
    fixture.autoDetectChanges();
    await fixture.whenStable();
    fixture.nativeElement.querySelector('li button').click();
    await fixture.whenStable();
    const actions: HTMLButtonElement[] = [...fixture.nativeElement.querySelectorAll('li button')];
    expect(actions.every(button => button.disabled)).toBe(true);
    const state = fixture.componentInstance as unknown as { load(): void; remove(value: TestcenterInstanceDto): void };
    state.load();
    state.remove(custom);
    expect(service.getInstances).toHaveBeenCalledTimes(1);
    expect(dialog.open).not.toHaveBeenCalled();
    probe.next({ version: '19.0.1', checkedAt: '2026-11-09T13:00:00Z' });
    probe.complete();
    await fixture.whenStable();
    expect(actions.every(button => !button.disabled)).toBe(true);
  });

  it('cancels outstanding discovery when the settings screen is destroyed', async () => {
    const discovery = new Subject<TestcenterInstanceDto[]>();
    service.getInstances.mockReturnValue(discovery);
    const fixture = TestBed.createComponent(TestcenterSettingsComponent);
    fixture.detectChanges();
    expect(discovery.observed).toBe(true);
    fixture.destroy();
    expect(discovery.observed).toBe(false);
  });
});
