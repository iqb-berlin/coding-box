import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { UnitTagService } from './unit-tag.service';
import { SERVER_URL } from '../../../injection-tokens';
import { CreateUnitTagDto } from '../../../../../../../api-dto/unit-tags/create-unit-tag.dto';
import { UnitTagDto } from '../../../../../../../api-dto/unit-tags/unit-tag.dto';

describe('UnitTagService', () => {
  let service: UnitTagService;
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
        UnitTagService,
        provideHttpClient(withInterceptorsFromDi()),
        provideHttpClientTesting(),
        { provide: SERVER_URL, useValue: mockServerUrl }
      ]
    });

    service = TestBed.inject(UnitTagService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('createUnitTag', () => {
    it('should create unit tag', () => {
      const mockDto: CreateUnitTagDto = { tag: 'Test Tag', unitId: 10 };
      const mockResult = { id: 1, ...mockDto, createdAt: new Date() } as UnitTagDto;

      service.createUnitTag(mockWorkspaceId, mockDto).subscribe(res => {
        expect(res).toEqual(mockResult);
      });

      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/${mockWorkspaceId}/unit-tags`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(mockDto);
      req.flush(mockResult);
    });
  });

  describe('deleteUnitTag', () => {
    it('should delete unit tag', () => {
      service.deleteUnitTag(mockWorkspaceId, 1).subscribe(res => {
        expect(res).toBe(true);
      });

      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/${mockWorkspaceId}/unit-tags/1`);
      expect(req.request.method).toBe('DELETE');
      req.flush(true);
    });
  });
});
