import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { Subject } from 'rxjs';
import { UserWorkspacesComponent } from './user-workspaces.component';
import { AuthService } from '../../../core/services/auth.service';
import { AppService } from '../../../core/services/app.service';

describe('Workspace auth retry without Zone.js', () => {
  let fixture: ComponentFixture<UserWorkspacesComponent>;
  let response: Subject<boolean>;
  const retryAuthDataLoad = jest.fn();

  beforeEach(async () => {
    response = new Subject();
    retryAuthDataLoad.mockReset().mockImplementation(() => response);
    await TestBed.configureTestingModule({
      imports: [UserWorkspacesComponent, TranslateModule.forRoot()],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]), provideNoopAnimations(),
        { provide: AuthService, useValue: { isLoggedIn: () => true } },
        { provide: AppService, useValue: { retryAuthDataLoad } }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(UserWorkspacesComponent);
    fixture.componentRef.setInput('workspaces', []);
    fixture.componentRef.setInput('authBootstrapStatus', 'auth-data-failed');
    fixture.autoDetectChanges();
    await fixture.whenStable();
  });

  afterEach(() => fixture.destroy());

  it.each(['success', 'failure', 'error'])('enables retry after a delayed %s', async outcome => {
    const button = fixture.nativeElement.querySelector('.workspace-state-actions button') as HTMLButtonElement;
    button.click();
    await fixture.whenStable();
    expect(button.disabled).toBe(true);
    fixture.componentInstance.reloadAuthData();
    expect(retryAuthDataLoad).toHaveBeenCalledTimes(1);
    if (outcome === 'error') response.error(new Error('offline'));
    else {
      response.next(outcome === 'success');
      response.complete();
    }
    await fixture.whenStable();
    expect(button.disabled).toBe(false);
    response = new Subject();
    button.click();
    await fixture.whenStable();
    expect(retryAuthDataLoad).toHaveBeenCalledTimes(2);
    expect(button.disabled).toBe(true);
  });

  it('unsubscribes from a retry when the view is destroyed', async () => {
    fixture.componentInstance.reloadAuthData();
    await fixture.whenStable();
    fixture.destroy();
    expect(response.observed).toBe(false);
  });
});
