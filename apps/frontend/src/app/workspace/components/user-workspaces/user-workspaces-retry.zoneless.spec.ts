import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { Subject } from 'rxjs';
import { UserWorkspacesComponent } from './user-workspaces.component';
import { AuthService } from '../../../core/services/auth.service';
import { AppService } from '../../../core/services/app.service';

describe('UserWorkspaces retry with OnPush', () => {
  it.each(['complete', 'error'] as const)('reenables the retry button after a delayed %s', async result => {
    const response = new Subject<boolean>();
    const retryAuthDataLoad = jest.fn(() => response);
    await TestBed.configureTestingModule({
      imports: [UserWorkspacesComponent, TranslateModule.forRoot()],
      providers: [
        provideZonelessChangeDetection(),
        { provide: AuthService, useValue: { isLoggedIn: () => true } },
        { provide: AppService, useValue: { retryAuthDataLoad } }
      ]
    }).compileComponents();
    const fixture = TestBed.createComponent(UserWorkspacesComponent);
    fixture.componentRef.setInput('workspaces', []);
    fixture.componentRef.setInput('authBootstrapStatus', 'auth-data-failed');
    await fixture.whenStable();
    const button = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)
      .find(candidate => candidate.textContent?.includes('home.retry-auth-data'))!;
    button.click();
    await fixture.whenStable();
    expect(button.disabled).toBe(true);
    expect(retryAuthDataLoad).toHaveBeenCalledTimes(1);
    if (result === 'complete') {
      response.next(false);
      response.complete();
    } else {
      response.error(new Error('auth retry failed'));
    }
    await fixture.whenStable();
    expect(button.disabled).toBe(false);
  });
});
