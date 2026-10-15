import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { of, Subject } from 'rxjs';
import { UsersSelectionComponent } from './users-selection.component';
import { UserBackendService } from '../../../shared/services/user/user-backend.service';
import { WorkspaceBackendService } from '../../../workspace/services/workspace-backend.service';
import { UserFullDto } from '../../../../../../../api-dto/user/user-full-dto';

describe('UsersSelectionComponent delayed lists', () => {
  let fixture: ComponentFixture<UsersSelectionComponent>;
  let response: Subject<UserFullDto[]>;
  let getUsersFull: jest.Mock;

  beforeEach(async () => {
    response = new Subject<UserFullDto[]>();
    getUsersFull = jest.fn().mockReturnValue(response);
    await TestBed.configureTestingModule({
      imports: [UsersSelectionComponent, TranslateModule.forRoot()],
      providers: [
        provideZonelessChangeDetection(),
        { provide: UserBackendService, useValue: { getUsersFull } },
        { provide: WorkspaceBackendService, useValue: { getAllWorkspacesList: () => of({ data: [] }) } }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(UsersSelectionComponent);
    fixture.componentRef.setInput('selectedUserIds', [7]);
    await fixture.whenStable();
  });

  afterEach(() => fixture.destroy());

  it('renders delayed users and existing access selections without another interaction', async () => {
    response.next([{ id: 7, username: 'delayed-user' }]);
    await fixture.whenStable();

    const row = fixture.nativeElement.querySelector('mat-row') as HTMLElement;
    expect(row?.textContent).toContain('delayed-user');
    expect((row.querySelector('input[type="checkbox"]') as HTMLInputElement).checked).toBe(true);
  });

  it('replaces the visible list when a later refresh arrives', async () => {
    response.next([{ id: 1, username: 'before-refresh' }]);
    response.complete();
    await fixture.whenStable();
    const refreshed = new Subject<UserFullDto[]>();
    getUsersFull.mockReturnValue(refreshed);
    fixture.componentInstance.updateUserList();
    refreshed.next([{ id: 1, username: 'after-refresh' }]);
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('after-refresh');
    expect(fixture.nativeElement.textContent).not.toContain('before-refresh');
  });
});
