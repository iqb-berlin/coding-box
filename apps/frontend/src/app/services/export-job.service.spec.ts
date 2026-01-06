import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { of } from 'rxjs';
import { ExportJobService } from './export-job.service';
import { BackendService } from './backend.service';

describe('ExportJobService', () => {
  let service: ExportJobService;
  let backendServiceMock: jest.Mocked<BackendService>;

  beforeEach(() => {
    backendServiceMock = {
      startExportJob: jest.fn(),
      getExportJobStatus: jest.fn(),
      cancelExportJob: jest.fn(),
      downloadExportFile: jest.fn()
    } as unknown as jest.Mocked<BackendService>;

    TestBed.configureTestingModule({
      providers: [
        ExportJobService,
        { provide: BackendService, useValue: backendServiceMock }
      ]
    });

    service = TestBed.inject(ExportJobService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('startJob', () => {
    it('should start job and poll', fakeAsync(() => {
      backendServiceMock.startExportJob.mockReturnValue(of({ jobId: 'j1', message: 'Job started' }));
      backendServiceMock.getExportJobStatus.mockReturnValue(of({ status: 'completed', progress: 100 }));

      service.startJob(1, { exportType: 'aggregated', userId: 1 });

      expect(service.activeJobs.length).toBe(1);

      tick(2000);

      expect(service.completedJobs.length).toBe(1);
      expect(service.completedJobs[0].jobId).toBe('j1');

      service.ngOnDestroy(); // cleanup
    }));
  });
});
