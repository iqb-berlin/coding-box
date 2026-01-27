import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { of } from 'rxjs';
import { ExportJobService } from './export-job.service';
import { CodingJobBackendService } from '../../../coding/services/coding-job-backend.service';

describe('ExportJobService', () => {
  let service: ExportJobService;
  let codingJobBackendServiceMock: jest.Mocked<CodingJobBackendService>;

  beforeEach(() => {
    codingJobBackendServiceMock = {
      startExportJob: jest.fn(),
      getExportJobStatus: jest.fn(),
      cancelExportJob: jest.fn(),
      downloadExportFile: jest.fn()
    } as unknown as jest.Mocked<CodingJobBackendService>;

    TestBed.configureTestingModule({
      providers: [
        ExportJobService,
        { provide: CodingJobBackendService, useValue: codingJobBackendServiceMock }
      ]
    });

    service = TestBed.inject(ExportJobService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('startJob', () => {
    it('should start job and poll', fakeAsync(() => {
      codingJobBackendServiceMock.startExportJob.mockReturnValue(of({ jobId: 'j1', message: 'Job started' }));
      codingJobBackendServiceMock.getExportJobStatus.mockReturnValue(of({ status: 'completed', progress: 100 }));

      service.startJob(1, { exportType: 'aggregated', userId: 1 });

      expect(service.activeJobs.length).toBe(1);

      tick(2000);

      expect(service.completedJobs.length).toBe(1);
      expect(service.completedJobs[0].jobId).toBe('j1');

      service.ngOnDestroy(); // cleanup
    }));
  });
});
