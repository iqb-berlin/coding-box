import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { ImportService, ImportOptions } from './import.service';
import { SERVER_URL } from '../../../injection-tokens';

describe('ImportService', () => {
  let service: ImportService;
  let httpMock: HttpTestingController;

  const mockServerUrl = 'http://localhost/api/';
  const mockWorkspaceId = 1;

  beforeEach(() => {
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: jest.fn().mockReturnValue('mock-token')
      },
      writable: true
    });

    TestBed.configureTestingModule({
      providers: [
        ImportService,
        provideHttpClient(withInterceptorsFromDi()),
        provideHttpClientTesting(),
        { provide: SERVER_URL, useValue: mockServerUrl }
      ]
    });

    service = TestBed.inject(ImportService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('importWorkspaceFiles', () => {
    it('should send import request with all options', () => {
      const options: ImportOptions = {
        responses: 'true',
        definitions: 'true',
        units: 'true',
        player: 'true',
        codings: 'true',
        logs: 'true',
        testTakers: 'true',
        booklets: 'true',
        metadata: 'true'
      };

      service.importWorkspaceFiles(mockWorkspaceId, 'ws1', 'srv', 'url', 'tok', options, ['g1'])
        .subscribe(res => {
          expect(res).toBeDefined();
        });

      const req = httpMock.expectOne(request => request.url === `${mockServerUrl}admin/workspace/${mockWorkspaceId}/importWorkspaceFiles` &&
        request.params.get('tc_workspace') === 'ws1' &&
        request.params.get('testGroups') === 'g1' &&
        request.params.get('responses') === 'true'
      );
      expect(req.request.method).toBe('GET');
      req.flush({});
    });
  });
});
