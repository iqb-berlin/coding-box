import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, Subject } from 'rxjs';
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

  beforeEach(async () => {
    jest.resetAllMocks();
    service.getInstances.mockReturnValue(of([builtin]));
    await TestBed.configureTestingModule({
      imports: [GermanTranslationsTestingModule, TestcenterSettingsComponent],
      providers: [provideZonelessChangeDetection(), { provide: TestcenterInstancesService, useValue: service }]
    }).compileComponents();
  });

  it('saves an approval and immediately renders its name and revocation action', async () => {
    service.saveInstance.mockReturnValue(of([builtin, custom]));
    const fixture = TestBed.createComponent(TestcenterSettingsComponent);
    fixture.autoDetectChanges();
    await fixture.whenStable();
    const enter = (name: string, value: string) => {
      const input: HTMLInputElement = fixture.nativeElement.querySelector(`input[name="${name}"]`);
      input.value = value;
      input.dispatchEvent(new Event('input'));
    };
    enter('name', 'Study');
    enter('baseUrl', 'https://study.example/tci');
    await fixture.whenStable();
    fixture.nativeElement.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await fixture.whenStable();
    expect(service.saveInstance).toHaveBeenCalledWith({ label: 'Study', baseUrl: 'https://study.example/tci' });
    const rows: HTMLLIElement[] = [...fixture.nativeElement.querySelectorAll('li')];
    expect(rows[0].textContent).toContain('Study');
    expect(rows[0].textContent).toContain('Freigabe aufheben');
    expect(rows[1].textContent).not.toContain('Freigabe aufheben');
    expect(fixture.nativeElement.querySelector('form').classList.contains('ng-submitted')).toBe(false);
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
