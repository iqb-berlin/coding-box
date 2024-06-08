import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { HttpService } from '@nestjs/axios';
import { createMock } from '@golevelup/ts-jest';
import { KeycloakService } from 'keycloak-angular';
import { UserWorkspacesComponent } from './user-workspaces.component';

describe('UserWorkspacesComponent', () => {
  let component: UserWorkspacesComponent;
  let fixture: ComponentFixture<UserWorkspacesComponent>;

  class KeycloakService {}

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TranslateModule.forRoot()]
    }).compileComponents();

    fixture = TestBed.createComponent(UserWorkspacesComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
