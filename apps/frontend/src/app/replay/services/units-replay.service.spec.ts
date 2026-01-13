import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { UnitsReplayService } from './units-replay.service';
import { FileService, BookletUnit } from '../../shared/services/file/file.service';
import { FilesDto } from '../../../../../../api-dto/files/files.dto';

describe('UnitsReplayService', () => {
  let service: UnitsReplayService;
  let fileServiceMock: jest.Mocked<FileService>;

  beforeEach(() => {
    fileServiceMock = {
      getUnit: jest.fn(),
      getBookletUnits: jest.fn()
    } as unknown as jest.Mocked<FileService>;

    TestBed.configureTestingModule({
      providers: [
        UnitsReplayService,
        { provide: FileService, useValue: fileServiceMock }
      ]
    });

    service = TestBed.inject(UnitsReplayService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('getUnitsFromFileUpload', () => {
    it('should map booklet units to replay structure', () => {
      const mockBookletFile = [{ file_id: 'b1' }];
      const mockUnits = [{
        id: 1, name: 'u1', alias: 'a1', bookletId: 10
      }];

      fileServiceMock.getUnit.mockReturnValue(of(mockBookletFile as FilesDto[]));
      fileServiceMock.getBookletUnits.mockReturnValue(of(mockUnits as BookletUnit[]));

      service.getUnitsFromFileUpload(1, 'b1').subscribe(res => {
        expect(res).toBeTruthy();
        expect(res?.name).toBe('b1');
        expect(res?.units.length).toBe(1);
        expect(res?.units[0].name).toBe('u1');
      });
    });

    it('should return null if no booklet found', () => {
      fileServiceMock.getUnit.mockReturnValue(of([]));
      service.getUnitsFromFileUpload(1, 'b1').subscribe(res => {
        expect(res).toBeNull();
      });
    });

    it('should handle errors gracefully', () => {
      fileServiceMock.getUnit.mockReturnValue(throwError(() => 'err'));
      service.getUnitsFromFileUpload(1, 'b1').subscribe(res => {
        expect(res).toBeNull();
      });
    });
  });
});
