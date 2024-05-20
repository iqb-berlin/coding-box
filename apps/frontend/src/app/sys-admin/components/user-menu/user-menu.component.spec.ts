// eslint-disable-next-line max-classes-per-file
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { Component, Input } from '@angular/core';
import { UserMenuComponent } from './user-menu.component';
import { AccountActionComponent } from '../account-action/account-action.component';
import { WrappedIconComponent } from '../../../shared/wrapped-icon/wrapped-icon.component';

describe('UserMenuComponent', () => {
  let component: UserMenuComponent;
  let fixture: ComponentFixture<UserMenuComponent>;

  @Component({ selector: 'studio-lite-account-action', standalone: true, template: '' })
  class MockAccountActionComponentComponent {
    @Input() type!: string;
    @Input() iconName!: string;
  }

  @Component({ selector: 'studio-lite-wrapped-icon', standalone: true, template: '' })
  class MockWrappedIconComponent {
    @Input() icon!: string;
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        UserMenuComponent,
        TranslateModule.forRoot()
      ]
    }).overrideComponent(UserMenuComponent, {
      remove: {
        imports: [
          WrappedIconComponent,
          AccountActionComponent
        ]
      },
      add: { imports: [MockAccountActionComponentComponent, MockWrappedIconComponent] }
    })
      .compileComponents();
    fixture = TestBed.createComponent(UserMenuComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
