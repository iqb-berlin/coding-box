import {
  provideHttpClient,
  withInterceptorsFromDi
} from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { SERVER_URL } from '../../injection-tokens';
import { DoubleCodedReviewApiService } from './double-coded-review-api.service';

describe('DoubleCodedReviewApiService', () => {
  let service: DoubleCodedReviewApiService;
  let httpMock: HttpTestingController;
  const serverUrl = 'http://localhost:3000/';
  const workspaceId = 123;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptorsFromDi()),
        provideHttpClientTesting(),
        DoubleCodedReviewApiService,
        { provide: SERVER_URL, useValue: serverUrl }
      ]
    });
    service = TestBed.inject(DoubleCodedReviewApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('requests review data with agreement and scope filters', () => {
    service.getDoubleCodedVariablesForReview(
      workspaceId,
      {
        page: 2,
        limit: 25,
        onlyConflicts: true,
        excludeTrainings: false,
        search: ' VAR_1 ',
        coderId: 9,
        statusFilter: 'done',
        resolvedFilter: 'unresolved',
        agreementFilter: 'differ',
        sortBy: 'personInfo',
        sortDirection: 'desc',
        jobDefinitionIds: [11, 12],
        coderTrainingIds: [21]
      }
    ).subscribe();

    const req = httpMock.expectOne(request => request.url ===
      `${serverUrl}admin/workspace/${workspaceId}/coding/double-coded-review`);
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('page')).toBe('2');
    expect(req.request.params.get('limit')).toBe('25');
    expect(req.request.params.get('onlyConflicts')).toBe('true');
    expect(req.request.params.get('excludeTrainings')).toBe('false');
    expect(req.request.params.get('search')).toBe('VAR_1');
    expect(req.request.params.get('coderId')).toBe('9');
    expect(req.request.params.get('statusFilter')).toBe('done');
    expect(req.request.params.get('resolvedFilter')).toBe('unresolved');
    expect(req.request.params.get('agreementFilter')).toBe('differ');
    expect(req.request.params.get('sortBy')).toBe('personInfo');
    expect(req.request.params.get('sortDirection')).toBe('desc');
    expect(req.request.params.get('jobDefinitionIds')).toBe('11,12');
    expect(req.request.params.get('coderTrainingIds')).toBe('21');
    req.flush({
      data: [], total: 0, page: 2, limit: 25
    });
  });

  it('propagates review query errors', done => {
    service.getDoubleCodedVariablesForReview(workspaceId).subscribe({
      next: () => done.fail('expected request to fail'),
      error: error => {
        expect(error.status).toBe(500);
        done();
      }
    });

    const req = httpMock.expectOne(
      `${serverUrl}admin/workspace/${workspaceId}/coding/double-coded-review?page=1&limit=50&onlyConflicts=false&excludeTrainings=false&sortBy=unitVariable&sortDirection=asc`
    );
    req.flush({}, { status: 500, statusText: 'Server Error' });
  });

  it('saves a draft with its authoritative source unit', () => {
    const draft = {
      sourceUnitId: 77,
      code: 3,
      score: 2,
      comment: 'Check this'
    };
    service.saveDoubleCodedReviewDraft(workspaceId, 10, draft).subscribe();

    const req = httpMock.expectOne(
      `${serverUrl}admin/workspace/${workspaceId}/coding/double-coded-review/10/draft`
    );
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual(draft);
    req.flush({});
  });

  it('deletes the current manager draft', () => {
    service.deleteDoubleCodedReviewDraft(workspaceId, 10).subscribe();

    const req = httpMock.expectOne(
      `${serverUrl}admin/workspace/${workspaceId}/coding/double-coded-review/10/draft`
    );
    expect(req.request.method).toBe('DELETE');
    req.flush({ success: true });
  });

  it('posts review resolution decisions unchanged', () => {
    const body = {
      decisions: [{
        responseId: 10,
        sourceUnitId: 77,
        code: 3,
        score: 2,
        resolutionComment: 'Replay checked'
      }]
    };
    service.applyDoubleCodedResolutions(workspaceId, body).subscribe();

    const req = httpMock.expectOne(
      `${serverUrl}admin/workspace/${workspaceId}/coding/double-coded-review/apply-resolutions`
    );
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(body);
    req.flush({
      success: true,
      appliedCount: 1,
      failedCount: 0,
      skippedCount: 0,
      message: 'ok',
      results: []
    });
  });

  it('propagates resolution transport errors', () => {
    const errorSpy = jest.fn();
    service.applyDoubleCodedResolutions(workspaceId, { decisions: [] })
      .subscribe({ error: errorSpy });

    const req = httpMock.expectOne(
      `${serverUrl}admin/workspace/${workspaceId}/coding/double-coded-review/apply-resolutions`
    );
    req.flush('Unavailable', {
      status: 503,
      statusText: 'Service Unavailable'
    });
    expect(errorSpy).toHaveBeenCalled();
  });
});
