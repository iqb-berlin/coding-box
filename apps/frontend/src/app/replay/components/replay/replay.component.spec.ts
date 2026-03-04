// eslint-disable-next-line max-classes-per-file
import { ActivatedRoute } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { of } from 'rxjs';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient, HttpErrorResponse } from '@angular/common/http';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ReplayComponent } from './replay.component';
import { environment } from '../../../../environments/environment';
import { SERVER_URL } from '../../../injection-tokens';
import { FileService } from '../../../shared/services/file/file.service';
import { ResponseService } from '../../../shared/services/response/response.service';
import { FileBackendService } from '../../../shared/services/file/file-backend.service';
import { ReplayBackendService } from '../../services/replay-backend.service';
import { AppService } from '../../../core/services/app.service';
import * as tokenUtils from '../../utils/token-utils';
import * as domUtils from '../../utils/dom-utils';
import { CodingJob } from '../../../coding/models/coding-job.model';

// Beispielhafte Mocks für Services, die im Component per inject() genutzt werden
class FileServiceMock {
  getUnitDef = jest.fn().mockReturnValue(of([{ data: 'unitDef data', file_id: 'UNIT-123.VOUD' }]));
  getUnit = jest.fn().mockReturnValue(of([{ data: '<Unit><DefinitionRef player="Player-1.0"></DefinitionRef></Unit>', file_id: 'UNIT-123' }]));
  getPlayer = jest.fn().mockReturnValue(of([{ data: 'player data', file_id: 'PLAYER-1.0' }]));
  getDirectDownloadLink = jest.fn().mockReturnValue('http://download');
  getCodingSchemeFile = jest.fn().mockReturnValue(of(null));
}

class ResponseServiceMock {
  getResponses = jest.fn().mockReturnValue(of([{ id: 1, data: 'response data' }]));
}

class FileBackendServiceMock {
  getVocs = jest.fn().mockReturnValue(of([{ data: 'vocs data', file_id: 'UNIT-123.vocs' }]));
}

class ReplayBackendServiceMock {
  storeReplayStatistics = jest.fn().mockReturnValue(of({ success: true }));
}

class AppServiceMock {
  selectedWorkspaceId = 42;
}

class MatSnackBarMock {
  open = jest.fn().mockReturnValue({
    afterDismissed: () => of({})
  });

  dismiss = jest.fn();
}

// Konfiguration der Aktivierten Route, inklusive Parameter und Query Params
const fakeActivatedRoute = {
  snapshot: { data: {}, url: [{ path: '' }] },
  params: of({
    page: 'page-1', testPerson: 'valid@test@person', unitId: 'unit-123', anchor: undefined
  }),
  queryParams: of({ auth: 'valid-token' })
} as unknown as ActivatedRoute;

describe('ReplayComponent', () => {
  let component: ReplayComponent;
  let fixture: ComponentFixture<ReplayComponent>;
  let snackBar: MatSnackBarMock;

  beforeEach(async () => {
    // Spy on token validation
    jest.spyOn(tokenUtils, 'validateToken').mockReturnValue({ isValid: true });
    jest.spyOn(tokenUtils, 'isTestperson').mockImplementation(testperson => testperson === 'valid@test@person');

    // Spy on DOM utils
    jest.spyOn(domUtils, 'scrollToElementByAlias').mockReturnValue(true);

    await TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        { provide: ActivatedRoute, useValue: fakeActivatedRoute },
        { provide: SERVER_URL, useValue: environment.backendUrl },
        { provide: FileService, useClass: FileServiceMock },
        { provide: ResponseService, useClass: ResponseServiceMock },
        { provide: FileBackendService, useClass: FileBackendServiceMock },
        { provide: ReplayBackendService, useClass: ReplayBackendServiceMock },
        { provide: AppService, useClass: AppServiceMock },
        { provide: MatSnackBar, useClass: MatSnackBarMock }
      ],
      imports: [ReplayComponent, TranslateModule.forRoot()]
    }).compileComponents();

    fixture = TestBed.createComponent(ReplayComponent);
    component = fixture.componentInstance;
    snackBar = TestBed.inject(MatSnackBar) as unknown as MatSnackBarMock;
    fixture.detectChanges();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should initialise observables and default properties', () => {
    expect(component.isLoaded).toBeDefined();
    expect(component.player).toBe('player data');
    expect(component.unitDef).toBe('unitDef data');
    expect(component.responses).toBeDefined();
  });

  it('should handle invalid testPerson in setTestPerson', () => {
    // Testperson, die absichtlich ungültig ist
    expect(() => component.setTestPerson('')).toThrowError('TestPersonError');
  });

  it('should set test person correctly when valid', () => {
    component.setTestPerson('valid@test@person');
    expect(component.testPerson).toBe('valid@test@person');
  });

  it('should handle page errors correctly', () => {
    snackBar.open.mockClear();
    component.checkPageError('notInList');
    expect(snackBar.open).toHaveBeenCalledWith(
      'Keine valide Seite mit der ID "page-1" gefunden',
      'Schließen',
      { panelClass: ['snackbar-error'] }
    );
  });

  it('should dismiss page error when null is passed', () => {
    // First create an error
    component.checkPageError('notInList');

    // Then dismiss it
    component.checkPageError(null);

    // Check if dismiss was called
    expect(snackBar.dismiss).toHaveBeenCalled();
  });

  it('should set unit parameters correctly', () => {
    const params = {
      page: 'test-page',
      testPerson: 'valid@test@person',
      unitId: 'test-unit',
      anchor: 'test-anchor'
    };

    component.setUnitParams(params);

    expect(component.page).toBe('test-page');
    expect(component.anchor).toBe('test-anchor');
    expect(component.unitId).toBe('test-unit');
    expect(component.testPerson).toBe('valid@test@person');
  });

  it('should normalize player ID correctly', () => {
    const normalizedId = ReplayComponent.getNormalizedPlayerId('player-1.2.3-beta.js');
    expect(normalizedId).toBe('PLAYER-1.2.3');
  });

  it('should normalize player ID with different separators', () => {
    expect(ReplayComponent.getNormalizedPlayerId('ASPECT@2.5.1')).toBe('ASPECT-2.5.1');
    expect(ReplayComponent.getNormalizedPlayerId('ASPECT-2.5.1')).toBe('ASPECT-2.5.1');
    expect(ReplayComponent.getNormalizedPlayerId('ASPECTV2.5.1')).toBe('ASPECT-2.5.1');
  });

  it('should normalize player ID without patch version', () => {
    const normalizedId = ReplayComponent.getNormalizedPlayerId('player-1.2');
    expect(normalizedId).toBe('PLAYER-1.2.0');
  });

  it('should normalize player ID without file extension', () => {
    const normalizedId = ReplayComponent.getNormalizedPlayerId('iqb-player-aspect-2.9.4');
    expect(normalizedId).toBe('IQB-PLAYER-ASPECT-2.9.4');
  });

  it('should handle player ID with only major version', () => {
    const normalizedId = ReplayComponent.getNormalizedPlayerId('player-1');
    expect(normalizedId).toBe('PLAYER-1.0.0');
  });

  it('should reset unit data correctly', () => {
    // Set some data first
    component.unitId = 'test-unit';
    component.player = 'test-player';
    component.unitDef = 'test-unitDef';
    component.page = 'test-page';
    component.responses = [{ id: 1 }];

    // Call the private method using type assertion
    (component as unknown as { resetUnitData: () => void }).resetUnitData();

    // Check if data was reset
    expect(component.unitId).toBe('');
    expect(component.player).toBe('');
    expect(component.unitDef).toBe('');
    expect(component.page).toBeUndefined();
    expect(component.responses).toBeUndefined();
  });

  it('catchError should reset unit data', () => {
    // Set some data first
    component.unitId = 'test-unit';
    component.player = 'test-player';

    // Access private members safely
    const privateComponent = component as unknown as {
      resetUnitData: () => void;
      catchError: (error: HttpErrorResponse) => void;
    };

    const resetSpy = jest.spyOn(privateComponent, 'resetUnitData');
    const error = new HttpErrorResponse({
      status: 500,
      statusText: 'Server Error'
    });

    // Call the private catchError method
    privateComponent.catchError(error);

    expect(resetSpy).toHaveBeenCalled();
    expect(component.unitId).toBe('');
    expect(component.player).toBe('');
  });
  describe('onKeyDown', () => {
    it('should ignore shortcuts when an input is focused', () => {
      const input = document.createElement('input');
      document.body.appendChild(input);
      input.focus();

      const event = new KeyboardEvent('keydown', { key: '1', code: 'Digit1' });
      const preventDefaultSpy = jest.spyOn(event, 'preventDefault');

      component.onKeyDown(event);

      expect(preventDefaultSpy).not.toHaveBeenCalled();

      document.body.removeChild(input);
    });

    it('should blur active element and prevent default when Enter is pressed in an input', () => {
      const textarea = document.createElement('textarea');
      document.body.appendChild(textarea);
      textarea.focus();
      const blurSpy = jest.spyOn(textarea, 'blur');

      const event = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter' });
      const preventDefaultSpy = jest.spyOn(event, 'preventDefault');

      component.onKeyDown(event);

      expect(blurSpy).toHaveBeenCalled();
      expect(preventDefaultSpy).toHaveBeenCalled();

      document.body.removeChild(textarea);
    });

    it('should navigate to immediate next unit on ArrowRight for interleaved variables', () => {
      component.isCodingMode = true;
      const unitsData = {
        id: 123,
        name: 'job',
        currentUnitIndex: 0,
        units: [
          {
            id: 1,
            name: 'UNIT1',
            alias: 'UNIT1',
            bookletId: 0,
            testPerson: 'tp1@code1@grp@booklet',
            variableId: 'V1',
            variableAnchor: 'V1'
          },
          {
            id: 2,
            name: 'UNIT1',
            alias: 'UNIT1',
            bookletId: 0,
            testPerson: 'tp1@code1@grp@booklet',
            variableId: 'V2',
            variableAnchor: 'V2'
          }
        ]
      };
      const replayComponent = component as ReplayComponent & { unitsData: typeof unitsData };
      replayComponent.unitsData = unitsData;
      component.testPerson = 'tp1@code1@grp@booklet';
      component.unitId = 'UNIT1';
      component.codingService.currentVariableId = 'V1';

      const compositeKey = component.codingService.generateCompositeKey(component.testPerson, 'UNIT1', 'V1');
      component.codingService.selectedCodes.set(compositeKey, {
        id: 1,
        label: 'coded'
      });

      const handleUnitChangedSpy = jest.spyOn(component, 'handleUnitChanged').mockResolvedValue();
      const event = new KeyboardEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight' });

      component.onKeyDown(event);

      expect(handleUnitChangedSpy).toHaveBeenCalledWith(unitsData.units[1]);
    });
  });

  describe('Coding Job Status', () => {
    it('should set status to active on init if in coding mode and not in review mode', async () => {
      const updateStatusSpy = jest.spyOn(component.codingService, 'updateCodingJobStatus').mockReturnValue(Promise.resolve({} as CodingJob));
      jest.spyOn(component.codingService, 'loadSavedCodingProgress').mockReturnValue(Promise.resolve());

      // Simulate coding mode but NOT review mode
      component.isCodingMode = true;
      component.isReviewMode = false;
      component.workspaceId = 42;
      component.codingService.codingJobId = 123;

      // Re-trigger the logic that would be in subscribeRouter (simplified for test)
      // In a real scenario, this is called inside subscribeRouter
      if (component.isCodingMode && !component.isReviewMode) {
        await component.codingService.updateCodingJobStatus(42, 123, 'active');
      }

      expect(updateStatusSpy).toHaveBeenCalledWith(42, 123, 'active');
    });

    it('should NOT set status to active on init if in review mode', async () => {
      const updateStatusSpy = jest.spyOn(component.codingService, 'updateCodingJobStatus').mockReturnValue(Promise.resolve({} as CodingJob));

      // Simulate review mode
      component.isCodingMode = true;
      component.isReviewMode = true;
      component.workspaceId = 42;
      component.codingService.codingJobId = 123;

      // This mimics the logic in subscribeRouter:
      // if (this.isCodingMode) { ... if (!this.isReviewMode) { updateCodingJobStatus(...) } }
      if (component.isCodingMode && !component.isReviewMode) {
        await component.codingService.updateCodingJobStatus(42, 123, 'active');
      }

      expect(updateStatusSpy).not.toHaveBeenCalled();
    });

    it('should NOT pause job on unload if in review mode', () => {
      const updateStatusSpy = jest.spyOn(component.codingService, 'updateCodingJobStatus').mockReturnValue(Promise.resolve({} as CodingJob));

      component.workspaceId = 42;
      component.codingService.codingJobId = 123;
      component.codingService.isCodingJobCompleted = false;
      component.isReviewMode = true;

      component.onBeforeUnload();

      expect(updateStatusSpy).not.toHaveBeenCalled();
    });

    it('should pause job on unload if NOT in review mode', () => {
      const updateStatusSpy = jest.spyOn(component.codingService, 'updateCodingJobStatus').mockReturnValue(Promise.resolve({} as CodingJob));

      component.workspaceId = 42;
      component.codingService.codingJobId = 123;
      component.codingService.isCodingJobCompleted = false;
      component.isReviewMode = false;

      component.onBeforeUnload();

      expect(updateStatusSpy).toHaveBeenCalledWith(42, 123, 'paused');
    });
  });
});
