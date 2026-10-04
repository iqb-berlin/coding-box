import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import {
  MAT_DIALOG_DEFAULT_OPTIONS, MatDialog, MatDialogConfig, MatDialogRef
} from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { WorkspacesMenuComponent } from './workspaces-menu.component';
import { EditWorkspaceComponent, EditWorkspaceForm } from '../../../workspace/components/edit-workspace/edit-workspace.component';
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
        TranslateModule.forRoot()
      ],
      providers: [
        { provide: SERVER_URL, useValue: environment.backendUrl },
        { provide: MAT_DIALOG_DEFAULT_OPTIONS, useValue: { ...new MatDialogConfig(), enterAnimationDuration: 0, exitAnimationDuration: 0 } }
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

  function editor(): MatDialogRef<EditWorkspaceComponent, EditWorkspaceForm | false> {
    return TestBed.inject(MatDialog).openDialogs[0];
  }

  async function closeEditor(result: EditWorkspaceForm | false | undefined): Promise<void> {
    const ref = editor();
    const closed = firstValueFrom(ref.afterClosed());
    ref.close(result);
    await closed;
  }

  it('opens creation with an empty name and emits the typed form after saving', async () => {
    const emitted = jest.spyOn(component.workspaceAdded, 'emit');
    component.addWorkspace();
    const form = editor().componentInstance.editWorkspaceForm;
    expect(form.controls.name.value).toBe('');
    expect(form.invalid).toBe(true);
    form.controls.name.setValue('New workspace');
    await closeEditor(form);
    expect(emitted).toHaveBeenCalledWith(form);
  });

  it('prefills the checked workspace and keeps the original target when selection changes', async () => {
    const emitted = jest.spyOn(component.workspaceEdited, 'emit');
    fixture.componentRef.setInput('selectedWorkspaces', [7]);
    fixture.componentRef.setInput('selectedRows', []);
    fixture.componentRef.setInput('checkedRows', [{ id: 7, name: 'Checked workspace' }]);
    component.editWorkspace();
    const form = editor().componentInstance.editWorkspaceForm;
    expect(form.controls.name.value).toBe('Checked workspace');
    fixture.componentRef.setInput('selectedWorkspaces', [9]);
    form.controls.name.setValue('Renamed workspace');
    await closeEditor(form);
    expect(emitted).toHaveBeenCalledWith({ selection: [7], formData: form });
  });

  it.each([false, undefined])('does not emit a mutation after closing with %s', async result => {
    const emitted = jest.spyOn(component.workspaceAdded, 'emit');
    component.addWorkspace();
    await closeEditor(result);
    expect(emitted).not.toHaveBeenCalled();
  });
});
