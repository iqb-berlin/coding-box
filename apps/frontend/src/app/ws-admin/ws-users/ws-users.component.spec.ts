// eslint-disable-next-line max-classes-per-file
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { HttpClientModule } from '@angular/common/http';
import {
  Component, EventEmitter, Input, Output
} from '@angular/core';
import { MatTableModule } from '@angular/material/table';
import { UntypedFormGroup } from '@angular/forms';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { WsUsersComponent } from './ws-users.component';
import { UserFullDto } from '../../../../api-dto/user/user-full-dto';
import { environment } from '../../../environments/environment';


describe('WsUsersComponent', () => {
  let component: WsUsersComponent;
  let fixture: ComponentFixture<WsUsersComponent>;

  @Component({ selector: 'coding-box-search-filter', template: '' })
  class MockSearchFilterComponent {
    @Input() title!: string;
  }

  @Component({ selector: 'coding-box-users-menu', template: '' })
  class MockUsersMenuComponent {
    @Input() selectedUser!: number;
    @Input() selectedRows!: UserFullDto[];
    @Input() checkedRows!: UserFullDto[];

    @Output() userAdded: EventEmitter<UntypedFormGroup> = new EventEmitter<UntypedFormGroup>();
    @Output() usersDeleted: EventEmitter< UserFullDto[]> = new EventEmitter< UserFullDto[]>();
    @Output() userEdited: EventEmitter<{ selection: UserFullDto[], user: UntypedFormGroup }> =
      new EventEmitter<{ selection: UserFullDto[], user: UntypedFormGroup }>();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [
        MockUsersMenuComponent,
        MockSearchFilterComponent
      ],
      imports: [
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

    fixture = TestBed.createComponent(WsUsersComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
