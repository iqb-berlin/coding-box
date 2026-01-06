import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { JournalService } from './journal.service';
import { SERVER_URL } from '../injection-tokens';

describe('JournalService', () => {
  let service: JournalService;
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
        JournalService,
        provideHttpClient(withInterceptorsFromDi()),
        provideHttpClientTesting(),
        { provide: SERVER_URL, useValue: mockServerUrl }
      ]
    });

    service = TestBed.inject(JournalService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('createJournalEntry', () => {
    it('should create entry', () => {
      const entryData = {
        workspaceId: mockWorkspaceId,
        actionType: 'create',
        entityType: 'unit',
        entityId: 'u1',
        details: 'test'
      };

      service.createJournalEntry(
        entryData.workspaceId,
        entryData.actionType,
        entryData.entityType,
        entryData.entityId,
        entryData.details
      ).subscribe(res => {
        expect(res).toBeDefined();
      });

      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/${mockWorkspaceId}/journal`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({
        action_type: entryData.actionType,
        entity_type: entryData.entityType,
        entity_id: entryData.entityId,
        details: entryData.details
      });
      req.flush({});
    });
  });
});
