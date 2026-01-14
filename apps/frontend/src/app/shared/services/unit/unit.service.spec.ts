import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { UnitService } from './unit.service';
import { SERVER_URL } from '../../../injection-tokens';

describe('UnitService', () => {
  let service: UnitService;
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
        UnitService,
        provideHttpClient(withInterceptorsFromDi()),
        provideHttpClientTesting(),
        { provide: SERVER_URL, useValue: mockServerUrl }
      ]
    });

    service = TestBed.inject(UnitService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('deleteUnit', () => {
    it('should delete unit', () => {
      const mockReport = { success: true, report: { deletedUnit: 1, warnings: [] } };

      service.deleteUnit(mockWorkspaceId, 1).subscribe(res => {
        expect(res).toEqual(mockReport);
      });

      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/${mockWorkspaceId}/units/1`);
      expect(req.request.method).toBe('DELETE');
      req.flush(mockReport);
    });
  });

  describe('deleteMultipleUnits', () => {
    it('should aggregate results from multiple delete calls', () => {
      const unitIds = [1, 2];
      const mockResult1 = { success: true, report: { deletedUnit: 1, warnings: [] } };
      const mockResult2 = { success: false, report: { deletedUnit: null, warnings: ['Error'] } };

      service.deleteMultipleUnits(mockWorkspaceId, unitIds).subscribe(finalRes => {
        expect(finalRes.success).toBe(true); // at least one succeeded
        expect(finalRes.report.deletedUnits).toContain(1);
        expect(finalRes.report.warnings).toContain('Error');
      });

      const req1 = httpMock.expectOne(`${mockServerUrl}admin/workspace/${mockWorkspaceId}/units/1`);
      const req2 = httpMock.expectOne(`${mockServerUrl}admin/workspace/${mockWorkspaceId}/units/2`);

      req1.flush(mockResult1);
      req2.flush(mockResult2);
    });
  });
});
