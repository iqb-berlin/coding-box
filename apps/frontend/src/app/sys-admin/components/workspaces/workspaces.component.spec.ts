// eslint-disable-next-line max-classes-per-file
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { HttpClientModule } from '@angular/common/http';
import { MatTableModule } from '@angular/material/table';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialogModule } from '@angular/material/dialog';
import {
  Component, EventEmitter, Input, Output
} from '@angular/core';
import { UntypedFormGroup } from '@angular/forms';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { WorkspacesComponent } from './workspaces.component';
import { WorkspaceInListDto } from '../../../../../api-dto/workspaces/workspace-in-list-dto';
import { environment } from '../../../../environments/environment';


describe('WorkspaceGroupsComponent', () => {
  let component: WorkspacesComponent;
  let fixture: ComponentFixture<WorkspacesComponent>;

  @Component({ selector: 'coding-box-search-filter', template: '' })
  class MockSearchFilterComponent {
    @Input() title!: string;
  }

  @Component({ selector: 'coding-box-workspace-groups-menu', template: '' })
  class MockWorkspaceGroupsMenuComponent {
    @Input() selectedWorkspaceGroupId!: number;
    @Input() selectedRows!: WorkspaceInListDto[];
    @Input() checkedRows!: WorkspaceInListDto[];

    @Output() groupAdded: EventEmitter<UntypedFormGroup> = new EventEmitter<UntypedFormGroup>();
    @Output() groupsDeleted: EventEmitter< WorkspaceInListDto[]> = new EventEmitter< WorkspaceInListDto[]>();
    @Output() groupEdited: EventEmitter<{ selection: WorkspaceInListDto[], group: UntypedFormGroup }> =
      new EventEmitter<{ selection: WorkspaceInListDto[], group: UntypedFormGroup }>();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [
        MockWorkspaceGroupsMenuComponent,
        MockSearchFilterComponent
      ],
      imports: [
        MatDialogModule,
        MatSnackBarModule,
        MatCheckboxModule,
        MatTooltipModule,
        MatIconModule,
        MatTableModule,
        HttpClientModule,
        NoopAnimationsModule,
        TranslateModule.forRoot()
      ],
      providers: [
        {
          provide: 'SERVER_URL',
          useValue: environment.backendUrl
        }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(WorkspacesComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
