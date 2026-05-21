import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { provideHttpClient } from '@angular/common/http';
import { provideNoopAnimations } from '@angular/platform-browser/animations'; // Importieren
import { MatSnackBar } from '@angular/material/snack-bar';
import { of } from 'rxjs';
import { SysAdminSettingsComponent } from './sys-admin-settings.component';
import { environment } from '../../../../environments/environment';
import { SERVER_URL } from '../../../injection-tokens';
import { SystemSettingsService } from '../../../core/services/system-settings.service';

describe('SysAdminSettingsComponent', () => {
  let component: SysAdminSettingsComponent;
  let fixture: ComponentFixture<SysAdminSettingsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        {
          provide: SERVER_URL,
          useValue: environment.backendUrl
        },
        {
          provide: MatSnackBar,
          useValue: { open: jest.fn() }
        },
        {
          provide: SystemSettingsService,
          useValue: {
            getContentPoolSettings: () => of({ enabled: false, baseUrl: '' }),
            updateContentPoolSettings: () => of({ enabled: false, baseUrl: '' })
          }
        },
        provideNoopAnimations() // Hier hinzufügen
      ],
      imports: [TranslateModule.forRoot()]
    }).compileComponents();
    fixture = TestBed.createComponent(SysAdminSettingsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
