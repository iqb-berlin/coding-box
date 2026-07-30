import { TestBed } from '@angular/core/testing';
import {
  HttpTestingController,
  provideHttpClientTesting
} from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { SERVER_URL } from '../../injection-tokens';
import { RequestMonitoringIncidentService } from './request-monitoring-incident.service';

describe('RequestMonitoringIncidentService', () => {
  let service: RequestMonitoringIncidentService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: SERVER_URL, useValue: '/api/' }
      ]
    });
    service = TestBed.inject(RequestMonitoringIncidentService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('loads open and resolved server incidents on demand', () => {
    service.getAll(true, 50).subscribe();

    const request = httpMock.expectOne(req => (
      req.url === '/api/admin/request-monitoring-incidents' &&
      req.params.get('includeResolved') === 'true' &&
      req.params.get('limit') === '50'
    ));
    expect(request.request.method).toBe('GET');
    request.flush([]);
  });

  it('updates the resolution state', () => {
    service.setResolved(7, true).subscribe();

    const request = httpMock.expectOne(
      '/api/admin/request-monitoring-incidents/7/resolution'
    );
    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toEqual({ resolved: true });
    request.flush({});
  });
});
