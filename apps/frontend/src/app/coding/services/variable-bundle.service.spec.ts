import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { VariableBundleService } from './variable-bundle.service';
import { AppService } from '../../core/services/app.service';
import { SERVER_URL } from '../../injection-tokens';

describe('VariableBundleService', () => {
  let service: VariableBundleService;
  let httpMock: HttpTestingController;
  let appServiceMock: jest.Mocked<AppService>;

  const mockServerUrl = 'http://localhost/api';

  beforeEach(() => {
    appServiceMock = {
      selectedWorkspaceId: 1
    } as unknown as jest.Mocked<AppService>;

    TestBed.configureTestingModule({
      providers: [
        VariableBundleService,
        provideHttpClient(withInterceptorsFromDi()),
        provideHttpClientTesting(),
        { provide: SERVER_URL, useValue: mockServerUrl },
        { provide: AppService, useValue: appServiceMock }
      ]
    });

    service = TestBed.inject(VariableBundleService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('getBundles', () => {
    it('should fetch bundles', () => {
      const mockResponse = {
        data: [{
          id: 1, name: 'B1', created_at: '2023', updated_at: '2023', variables: []
        }],
        total: 1,
        page: 1,
        limit: 10
      };

      service.getBundles().subscribe(res => {
        expect(res.bundles.length).toBe(1);
        expect(res.bundles[0].name).toBe('B1');
      });

      const req = httpMock.expectOne(r => r.url === `${mockServerUrl}/admin/workspace/1/variable-bundle`);
      expect(req.request.method).toBe('GET');
      req.flush(mockResponse);
    });
  });

  describe('createBundle', () => {
    it('should create bundle', () => {
      const bundle: Omit<import('../models/coding-job.model').VariableBundle, 'id'> = {
        name: 'New',
        variables: [],
        createdAt: new Date(),
        updatedAt: new Date()
      };
      const mockResponse = {
        id: 2, name: 'New', created_at: '2023', updated_at: '2023', variables: []
      };

      service.createBundle(bundle).subscribe(res => {
        expect(res.id).toBe(2);
      });

      const req = httpMock.expectOne(`${mockServerUrl}/admin/workspace/1/variable-bundle`);
      expect(req.request.method).toBe('POST');
      req.flush(mockResponse);
    });
  });
});
