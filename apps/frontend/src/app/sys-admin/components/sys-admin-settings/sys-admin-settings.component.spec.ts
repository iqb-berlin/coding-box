import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { SysAdminSettingsComponent } from './sys-admin-settings.component';
import { environment } from '../../../../environments/environment';

describe('SysAdminSettingsComponent', () => {
  let component: SysAdminSettingsComponent;
  let fixture: ComponentFixture<SysAdminSettingsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({

      providers: [{
        provide: 'SERVER_URL',
        useValue: environment.backendUrl
      }],
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
