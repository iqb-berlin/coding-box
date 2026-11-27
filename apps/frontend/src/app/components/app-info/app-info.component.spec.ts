import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialogModule } from '@angular/material/dialog';
import { TranslateModule } from '@ngx-translate/core';
import { of } from 'rxjs';
import { SystemSettingsService } from '../../core/services/system-settings.service';
import { AppInfoComponent } from './app-info.component';

describe('AppInfoComponent', () => {
  let component: AppInfoComponent;
  let fixture: ComponentFixture<AppInfoComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [{ provide: SystemSettingsService, useValue: { getLegalNotice: () => of({ imprintUrl: 'https://example.org/impressum' }) } }],
      imports: [
        AppInfoComponent,
        MatDialogModule,
        TranslateModule.forRoot()
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(AppInfoComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('appVersion', '1.0');
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
    expect(fixture.nativeElement.querySelector('nav a').href).toBe('https://example.org/impressum');
    expect(fixture.nativeElement.querySelector('nav button')).toBeTruthy();
  });
});
