import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ImpressumDialogComponent } from './impressum-dialog.component';
import { SystemSettingsService } from '../../core/services/system-settings.service';

describe('ImpressumDialogComponent', () => {
  let fixture: ComponentFixture<ImpressumDialogComponent>;
  let systemSettingsService: { getLegalNotice: jest.Mock };
  let consoleWarnSpy: jest.SpyInstance;

  beforeEach(async () => {
    systemSettingsService = {
      getLegalNotice: jest.fn(() => of({
        html: '<p>Stored</p><img src="x" onerror="alert(1)">',
        isDefault: false
      }))
    };
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await TestBed.configureTestingModule({
      imports: [ImpressumDialogComponent],
      providers: [
        { provide: SystemSettingsService, useValue: systemSettingsService },
        provideNoopAnimations()
      ]
    }).compileComponents();
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
  });

  it('loads and sanitizes stored legal notice html', () => {
    fixture = TestBed.createComponent(ImpressumDialogComponent);
    fixture.detectChanges();

    expect(systemSettingsService.getLegalNotice).toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Stored');
    expect(fixture.nativeElement.innerHTML).not.toContain('onerror');
  });

  it('falls back to the built-in text when loading fails', () => {
    systemSettingsService.getLegalNotice.mockReturnValue(throwError(() => new Error('failed')));

    fixture = TestBed.createComponent(ImpressumDialogComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('https://www.iqb.hu-berlin.de/de/datenschutz/');
  });
});
