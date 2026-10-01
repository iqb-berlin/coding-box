import { provideHttpClient } from '@angular/common/http';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import { of, Subject } from 'rxjs';

import { CodingJobDefinitionsComponent } from './coding-job-definitions.component';
import { CodingJobBackendService } from '../../services/coding-job-backend.service';
import { CoderService } from '../../services/coder.service';
import { CodingJobService } from '../../services/coding-job.service';
import { AppService } from '../../../core/services/app.service';
import { SERVER_URL } from '../../../injection-tokens';
import { environment } from '../../../../environments/environment';

describe('CodingJobDefinitionsComponent in zoneless mode', () => {
  it('renders a delayed definition response without manual change detection', async () => {
    const definitions = new Subject<[]>();

    await TestBed.configureTestingModule({
      imports: [CodingJobDefinitionsComponent, TranslateModule.forRoot()],
      providers: [
        provideZonelessChangeDetection(),
        provideNoopAnimations(),
        provideHttpClient(),
        { provide: SERVER_URL, useValue: environment.backendUrl },
        { provide: MatSnackBar, useValue: { open: jest.fn() } },
        { provide: AppService, useValue: { selectedWorkspaceId: 1 } },
        { provide: CodingJobService, useValue: { jobsCreatedEvent: { emit: jest.fn() } } },
        { provide: CoderService, useValue: { getCoders: jest.fn().mockReturnValue(of([])) } },
        {
          provide: CodingJobBackendService,
          useValue: { getJobDefinitions: jest.fn().mockReturnValue(definitions.asObservable()) }
        }
      ]
    }).compileComponents();

    const fixture = TestBed.createComponent(CodingJobDefinitionsComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.loading-container')).toBeTruthy();

    definitions.next([]);
    definitions.complete();
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('.loading-container')).toBeNull();
    expect(fixture.nativeElement.querySelector('.empty-state button')).toBeTruthy();
  });
});
