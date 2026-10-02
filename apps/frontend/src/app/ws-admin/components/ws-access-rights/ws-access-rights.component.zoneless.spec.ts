import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { TranslateModule } from '@ngx-translate/core';
import { of, Subject } from 'rxjs';
import { WsAccessRightsComponent } from './ws-access-rights.component';
import { UserBackendService } from '../../../shared/services/user/user-backend.service';
import { AppService, AuthDataRefreshOutcome } from '../../../core/services/app.service';

jest.unmock('@angular/material/snack-bar');

describe('Workspace access rights save without ZoneJS', () => {
  let fixture: ComponentFixture<WsAccessRightsComponent>;
  let saveResponse: Subject<boolean>;
  let authResponse: Subject<AuthDataRefreshOutcome>;
  let saveUsers: jest.Mock;
  let refreshAuthData: jest.Mock;
  let button: HTMLButtonElement;

  beforeEach(async () => {
    saveResponse = new Subject<boolean>();
    authResponse = new Subject<AuthDataRefreshOutcome>();
    saveUsers = jest.fn().mockReturnValue(saveResponse);
    refreshAuthData = jest.fn().mockReturnValue(authResponse);
    await TestBed.configureTestingModule({
      imports: [WsAccessRightsComponent, MatSnackBarModule, TranslateModule.forRoot()],
      providers: [
        provideZonelessChangeDetection(),
        provideNoopAnimations(),
        {
          provide: UserBackendService,
          useValue: {
            getUsers: jest.fn().mockReturnValue(of([
              {
                id: 1, name: 'user1', displayName: 'User One', accessLevel: 1, canCode: true
              }
            ])),
            saveUsers
          }
        },
        { provide: AppService, useValue: { selectedWorkspaceId: 1, refreshAuthData } }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(WsAccessRightsComponent);
    await fixture.whenStable();
    button = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  afterEach(async () => {
    TestBed.inject(MatSnackBar).dismiss();
    await fixture.whenStable();
    fixture.destroy();
  });

  async function changeAccessLevelAndSave(): Promise<void> {
    const checkboxes = fixture.nativeElement.querySelectorAll('input[type="checkbox"]');
    (checkboxes[2] as HTMLInputElement).click();
    await fixture.whenStable();
    expect(fixture.componentInstance.workspaceUsers().entries[0].accessLevel).toBe(3);
    expect(button.disabled).toBe(false);
    button.click();
    await fixture.whenStable();
    expect(saveUsers).toHaveBeenCalledWith(1, [{ id: 1, accessLevel: 3, canCode: true }]);
  }

  it.each<AuthDataRefreshOutcome>(['updated', 'failed', 'invalidated'])(
    'disables Save after persisted rights and delayed auth refresh outcome %s', async outcome => {
      await changeAccessLevelAndSave();
      saveResponse.next(true);
      saveResponse.complete();
      await fixture.whenStable();
      expect(refreshAuthData).toHaveBeenCalled();

      authResponse.next(outcome);
      authResponse.complete();
      await fixture.whenStable();

      expect(fixture.componentInstance.workspaceUsers().hasChanged).toBe(false);
      expect(button.disabled).toBe(true);
      if (outcome === 'failed') {
        expect(document.querySelector('mat-snack-bar-container')?.textContent)
          .toContain('admin.change-saved-auth-data-refresh-failed');
      }
      if (outcome === 'updated') {
        expect(document.querySelector('mat-snack-bar-container')?.textContent)
          .toContain('admin.workspace-access-right-set');
      }

      const checkboxes = fixture.nativeElement.querySelectorAll('input[type="checkbox"]');
      (checkboxes[2] as HTMLInputElement).click();
      await fixture.whenStable();
      expect(button.disabled).toBe(false);
      expect(fixture.componentInstance.workspaceUsers().getChecks())
        .toEqual([{ id: 1, accessLevel: 0, canCode: false }]);
    }
  );

  it('keeps Save enabled when the delayed mutation fails', async () => {
    await changeAccessLevelAndSave();
    saveResponse.next(false);
    saveResponse.complete();
    await fixture.whenStable();

    expect(refreshAuthData).not.toHaveBeenCalled();
    expect(fixture.componentInstance.workspaceUsers().hasChanged).toBe(true);
    expect(button.disabled).toBe(false);
    expect(document.querySelector('mat-snack-bar-container')?.textContent)
      .toContain('admin.workspace-access-right-not-set');
  });
});
