import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { WorkspaceProcessesService } from './workspace-processes.service';
import { SERVER_URL } from '../../injection-tokens';

describe('WorkspaceProcessesService', () => {
  let service: WorkspaceProcessesService;
  let httpMock: HttpTestingController;

  const serverUrl = 'http://localhost/api/';

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        WorkspaceProcessesService,
        provideHttpClient(withInterceptorsFromDi()),
        provideHttpClientTesting(),
        { provide: SERVER_URL, useValue: serverUrl }
      ]
    });

    service = TestBed.inject(WorkspaceProcessesService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('loads workspace processes without duplicating server URL slashes', () => {
    service.getProcesses(7).subscribe();

    const req = httpMock.expectOne('http://localhost/api/admin/workspace/7/processes');
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });

  it('loads the latest file upload for the requested workspace', () => {
    const next = jest.fn();
    service.getFileUpload(7).subscribe(next);
    const req = httpMock.expectOne('http://localhost/api/admin/workspace/7/processes/test-files-upload');
    expect(req.request.method).toBe('GET');
    req.flush(null);
    expect(next).toHaveBeenCalledWith(null);
  });

  it('encodes queue name and job ID when deleting a process', () => {
    service.deleteProcess(7, 'queue/name', 'job/1').subscribe();

    const req = httpMock.expectOne('http://localhost/api/admin/workspace/7/processes/queue%2Fname/job%2F1');
    expect(req.request.method).toBe('DELETE');
    req.flush(true);
  });
});
