import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { provideHttpClient } from '@angular/common/http';
import { provideNoopAnimations } from '@angular/platform-browser/animations'; // Importieren
import { SysAdminSettingsComponent } from './sys-admin-settings.component';
import { environment } from '../../../../environments/environment';
import { SERVER_URL } from '../../../injection-tokens';

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
        provideNoopAnimations() // Hier hinzufügen
      ],
      imports: [
        TranslateModule.forRoot()
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(SysAdminSettingsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
