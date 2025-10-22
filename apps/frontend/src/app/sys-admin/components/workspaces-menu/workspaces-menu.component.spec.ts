import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { WorkspacesMenuComponent } from './workspaces-menu.component';
import { environment } from '../../../../environments/environment';
import { SERVER_URL } from '../../../injection-tokens';
import { WorkspaceInListDto } from '../../../../../../../api-dto/workspaces/workspace-in-list-dto';

describe('WorkspacesMenuComponent', () => {
  let component: WorkspacesMenuComponent;
  let fixture: ComponentFixture<WorkspacesMenuComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        WorkspacesMenuComponent,
        TranslateModule.forRoot(),
        NoopAnimationsModule
      ],
      providers: [
        { provide: SERVER_URL, useValue: environment.backendUrl }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(WorkspacesMenuComponent);
    component = fixture.componentInstance;

    fixture.componentRef.setInput('selectedWorkspaces', [1, 2, 3]);
    fixture.componentRef.setInput('selectedRows', [{
      id: 1,
      name: 'Test Workspace 1',
      description: 'Test Description 1'
    } as WorkspaceInListDto]);
    fixture.componentRef.setInput('checkedRows', [{
      id: 1,
      name: 'Test Workspace 1',
      description: 'Test Description 1'
    } as WorkspaceInListDto]);

    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
