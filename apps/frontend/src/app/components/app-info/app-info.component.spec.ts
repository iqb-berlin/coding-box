import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialogModule } from '@angular/material/dialog';
import { TranslateModule } from '@ngx-translate/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { AppInfoComponent } from './app-info.component';

describe('AppInfoComponent', () => {
  let component: AppInfoComponent;
  let fixture: ComponentFixture<AppInfoComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        AppInfoComponent,
        MatDialogModule,
        NoopAnimationsModule,
        TranslateModule.forRoot()
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(AppInfoComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('appTitle', 'Test Title');
    fixture.componentRef.setInput('introHtml', undefined);
    fixture.componentRef.setInput('appName', 'Test App');
    fixture.componentRef.setInput('appVersion', '1.0');
    fixture.componentRef.setInput('userName', 'testuser');
    fixture.componentRef.setInput('userLongName', 'Test User');
    fixture.componentRef.setInput('isUserLoggedIn', true);
    fixture.componentRef.setInput('isAdmin', false);
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
