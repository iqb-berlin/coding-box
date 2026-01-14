import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { UnitNoteService } from './unit-note.service';
import { SERVER_URL } from '../../../injection-tokens';
import { CreateUnitNoteDto } from '../../../../../../../api-dto/unit-notes/create-unit-note.dto';
import { UpdateUnitNoteDto } from '../../../../../../../api-dto/unit-notes/update-unit-note.dto';
import { UnitNoteDto } from '../../../../../../../api-dto/unit-notes/unit-note.dto';

describe('UnitNoteService', () => {
  let service: UnitNoteService;
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
        UnitNoteService,
        provideHttpClient(withInterceptorsFromDi()),
        provideHttpClientTesting(),
        { provide: SERVER_URL, useValue: mockServerUrl }
      ]
    });

    service = TestBed.inject(UnitNoteService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('createUnitNote', () => {
    it('should create note', () => {
      const mockDto: CreateUnitNoteDto = { note: 'Test', unitId: 10 };
      const mockResult = {
        id: 1, ...mockDto, createdAt: new Date(), updatedAt: new Date()
      } as UnitNoteDto;

      service.createUnitNote(mockWorkspaceId, mockDto).subscribe(res => {
        expect(res).toEqual(mockResult);
      });

      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/${mockWorkspaceId}/unit-notes`);
      expect(req.request.method).toBe('POST');
      req.flush(mockResult);
    });
  });

  describe('getNotesForMultipleUnits', () => {
    it('should fetch notes for multiple units', () => {
      const unitIds = [1, 2];
      const mockResult = { 1: [], 2: [] };

      service.getNotesForMultipleUnits(mockWorkspaceId, unitIds).subscribe(res => {
        expect(res).toEqual(mockResult);
      });

      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/${mockWorkspaceId}/unit-notes/units/notes`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ unitIds });
      req.flush(mockResult);
    });
  });

  describe('updateUnitNote', () => {
    it('should update note', () => {
      const mockDto: UpdateUnitNoteDto = { note: 'Updated' };
      const mockResult = {
        id: 10, unitId: 10, note: 'Updated', createdAt: new Date(), updatedAt: new Date()
      } as UnitNoteDto;

      service.updateUnitNote(mockWorkspaceId, 10, mockDto).subscribe(res => {
        expect(res).toEqual(mockResult);
      });

      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/${mockWorkspaceId}/unit-notes/10`);
      expect(req.request.method).toBe('PATCH');
      req.flush(mockResult);
    });
  });
});
