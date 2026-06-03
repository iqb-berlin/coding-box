import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateModule } from '@ngx-translate/core';
import { MatTabsModule } from '@angular/material/tabs';
import { ActivatedRoute } from '@angular/router';
import { of } from 'rxjs';
import { WsAdminComponent } from './ws-admin.component';
import { environment } from '../../../../environments/environment';
import { SERVER_URL } from '../../../injection-tokens';
import { CodingJobBackendService } from '../../../coding/services/coding-job-backend.service';
import { AppService } from '../../../core/services/app.service';

describe('WsAdminComponent', () => {
  let component: WsAdminComponent;
  let fixture: ComponentFixture<WsAdminComponent>;
  let codingJobBackendServiceMock: { getCodingJobs: jest.Mock };

  beforeEach(async () => {
    codingJobBackendServiceMock = {
      getCodingJobs: jest.fn().mockReturnValue(of({
        data: [],
        total: 0,
        page: 1,
        limit: 1
      }))
    };

    await TestBed.configureTestingModule({
      imports: [WsAdminComponent, MatTabsModule, TranslateModule.forRoot()],
      providers: [
        {
          provide: ActivatedRoute,
          useValue: {
            params: of({ ws: 1 }) // Provide default params as needed
          }
        },
        {
          provide: SERVER_URL,
          useValue: environment.backendUrl
        },
        {
          provide: MatSnackBar,
          useValue: { open: jest.fn() }
        },
        {
          provide: CodingJobBackendService,
          useValue: codingJobBackendServiceMock
        },
        provideHttpClient()
      ]
    }).compileComponents();
  });

  beforeEach(() => {
    fixture = TestBed.createComponent(WsAdminComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  function renderNavLinks(
    accessLevel: number,
    canCode: boolean,
    hasAssignedCodingJobs = false,
    isAdmin = false
  ): string[] {
    component.accessLevel = accessLevel;
    component.canCode = canCode;
    component.hasAssignedCodingJobs = hasAssignedCodingJobs;
    component.authData = {
      ...AppService.defaultAuthData,
      isAdmin
    };
    (component as unknown as { updateNavLinks: () => void }).updateNavLinks();

    fixture.detectChanges();

    return Array.from<Element>(fixture.nativeElement.querySelectorAll('a.mat-mdc-tab-link'))
      .map((element: Element) => element.textContent?.trim() || '');
  }

  it('should not render coder jobs for level 1 users when canCode is false', () => {
    renderNavLinks(1, false);

    expect(fixture.nativeElement.querySelector('coding-box-my-coding-jobs')).toBeNull();
    expect(fixture.nativeElement.querySelector('.no-access-message')).not.toBeNull();
  });

  it('should render own coding jobs navigation for level 1 users with assigned jobs', () => {
    const links = renderNavLinks(1, false, true);

    expect(fixture.nativeElement.querySelector('.no-access-message')).toBeNull();
    expect(links).toEqual(['ws-admin.my-coding-jobs']);
  });

  it('should render own coding jobs navigation for level 1 users with canCode', () => {
    const links = renderNavLinks(1, true);

    expect(fixture.nativeElement.querySelector('.no-access-message')).toBeNull();
    expect(links).toEqual(['ws-admin.my-coding-jobs']);
  });

  it('should render coding manager links without own coding jobs when canCode is false', () => {
    const links = renderNavLinks(2, false);
    const navLinks = (component as unknown as { navLinks: Array<{ path: string }> }).navLinks;

    expect(links).toEqual([
      'ws-admin.coding-overview',
      'ws-admin.manual-coding',
      'ws-admin.export'
    ]);
    expect(navLinks.map(link => link.path)).toEqual([
      'coding/statistics',
      'coding/manual',
      'coding/export'
    ]);
  });

  it('should render own coding jobs and coding manager links for coding managers with canCode', () => {
    const links = renderNavLinks(2, true);

    expect(links).toEqual([
      'ws-admin.my-coding-jobs',
      'ws-admin.coding-overview',
      'ws-admin.manual-coding',
      'ws-admin.export'
    ]);
  });

  it('should render own coding jobs for coding managers with historical assignments', () => {
    const links = renderNavLinks(2, false, true);

    expect(links).toEqual([
      'ws-admin.my-coding-jobs',
      'ws-admin.coding-overview',
      'ws-admin.manual-coding',
      'ws-admin.export'
    ]);
  });

  it('should render full navigation without own coding jobs for study managers without canCode', () => {
    const links = renderNavLinks(3, false);
    const navLinks = (component as unknown as { navLinks: Array<{ path: string }> }).navLinks;

    expect(links).toEqual([
      'ws-admin.test-files',
      'ws-admin.test-results',
      'ws-admin.coding-overview',
      'ws-admin.manual-coding',
      'ws-admin.export',
      'ws-admin.settings'
    ]);
    expect(navLinks.map(link => link.path)).toContain('coding/management');
  });

  it('should render own coding jobs and full navigation for study managers with canCode', () => {
    const links = renderNavLinks(3, true);

    expect(links).toContain('ws-admin.my-coding-jobs');
    expect(links).toContain('ws-admin.test-files');
    expect(links).toContain('ws-admin.settings');
  });

  it('should render own coding jobs and full navigation for study managers with historical assignments', () => {
    const links = renderNavLinks(3, false, true);

    expect(links).toContain('ws-admin.my-coding-jobs');
    expect(links).toContain('ws-admin.test-files');
    expect(links).toContain('ws-admin.settings');
  });

  it('should render full admin navigation without own coding jobs for admins without coding access', () => {
    const links = renderNavLinks(3, false, false, true);

    expect(links).toEqual([
      'ws-admin.test-files',
      'ws-admin.test-results',
      'ws-admin.coding-overview',
      'ws-admin.manual-coding',
      'ws-admin.export',
      'ws-admin.settings'
    ]);
  });

  it('should render own coding jobs and full admin navigation for admins with coding access', () => {
    const links = renderNavLinks(1, true, true, true);

    expect(links).toEqual([
      'ws-admin.my-coding-jobs',
      'ws-admin.test-files',
      'ws-admin.test-results',
      'ws-admin.coding-overview',
      'ws-admin.manual-coding',
      'ws-admin.export',
      'ws-admin.settings'
    ]);
  });
});
