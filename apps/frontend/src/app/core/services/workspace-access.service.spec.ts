import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { SERVER_URL } from '../../injection-tokens';
import { WorkspaceAccessService } from './workspace-access.service';

describe('WorkspaceAccessService', () => {
  let service: WorkspaceAccessService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: SERVER_URL, useValue: '/api/' }
      ]
    });
    service = TestBed.inject(WorkspaceAccessService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it.each([
    [{ total: 1, data: [] }, true],
    [{ total: 0, data: [{ id: 1 }] }, false],
    [{ data: [{ id: 1 }] }, true],
    [{ data: [] }, false],
    [{}, false]
  ])('checks assignments using the filtered list response %j', (response, expected) => {
    let result: boolean | undefined;
    service.hasAssignedCodingJobs(42).subscribe(value => { result = value; });
    const request = http.expectOne(req => req.url === '/api/wsg-admin/workspace/42/coding-job');
    expect(request.request.method).toBe('GET');
    expect(request.request.params.get('assignedTo')).toBe('me');
    expect(request.request.params.get('limit')).toBe('1');
    expect(request.request.params.has('page')).toBe(false);
    request.flush(response);
    expect(result).toBe(expected);
  });

  it('propagates failures so the guard can deny access', () => {
    const error = jest.fn();
    service.hasAssignedCodingJobs(42).subscribe({ error });
    http.expectOne(req => req.url === '/api/wsg-admin/workspace/42/coding-job')
      .flush('Forbidden', { status: 403, statusText: 'Forbidden' });
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ status: 403 }));
  });
});
