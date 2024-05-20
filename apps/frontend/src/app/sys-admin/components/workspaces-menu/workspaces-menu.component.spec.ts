import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslateModule } from '@ngx-translate/core';
import { HttpClientModule } from '@angular/common/http';
import { WorkspacesMenuComponent } from './workspaces-menu.component';
import { environment } from '../../../../../environments/environment';

describe('WorkspacesMenuComponent', () => {
  let component: WorkspacesMenuComponent;
  let fixture: ComponentFixture<WorkspacesMenuComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [{
        provide: 'SERVER_URL',
        useValue: environment.backendUrl
      }],
      imports: [
        HttpClientModule,
        MatDialogModule,
        MatIconModule,
        MatTooltipModule,
        TranslateModule.forRoot()
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(WorkspacesMenuComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
