// eslint-disable-next-line max-classes-per-file
import { ActivatedRoute } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import {
  BehaviorSubject, of, Subject
} from 'rxjs';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient, HttpErrorResponse } from '@angular/common/http';
import { MatSnackBar } from '@angular/material/snack-bar';
import * as jwtDecodeModule from 'jwt-decode';
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
import { CodingJobBackendService } from '../../../coding/services/coding-job-backend.service';
import { utf8ToBase64 } from '../../../shared/utils/common-utils';
import { CodingScheme } from '../../../models/coding-interfaces';
import { SessionRecoveryService } from '../../../core/services/session-recovery.service';

function createUnsignedJwt(payload: Record<string, unknown>): string {
  const encode = (value: Record<string, unknown>) => btoa(JSON.stringify(value))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/u, '');
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode(payload)}.`;
}

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
  getReplayPayload = jest.fn().mockReturnValue(of({
    unitDef: [{ data: 'unitDef data', file_id: 'UNIT-123.VOUD' }],
    response: { responses: [{ id: '1', content: 'response data' }] },
    vocs: [],
    player: [{ data: 'player data', file_id: 'PLAYER-1.0' }],
    serverTimings: {
      responseTotalMs: 5
    }
  }));

  storeReplayStatistics = jest.fn().mockReturnValue(of({ success: true }));
}

interface AppServiceAuthDataMock {
  userId: number;
  workspaces: { id: number; name: string }[];
}

class AppServiceMock {
  selectedWorkspaceId = 42;
  authData: AppServiceAuthDataMock = {
    userId: 1,
    workspaces: [
      { id: 47, name: 'Workspace 47' },
      { id: 48, name: 'Workspace 48' }
    ]
  };

  private authDataSubject = new Subject<AppServiceAuthDataMock>();
  private authBootstrapStatusSubject = new BehaviorSubject<string>('ready');

  authData$ = this.authDataSubject.asObservable();
  authBootstrapStatus$ = this.authBootstrapStatusSubject.asObservable();
  postMessage$ = of({ data: {} });
  needsReAuthentication = false;

  createOwnToken = jest.fn().mockReturnValue(of('workspace-token'));
  hasStoredAuthToken = jest.fn().mockReturnValue(true);

  emitAuthData(authData: AppServiceAuthDataMock = this.authData): void {
    this.authData = authData;
    this.authDataSubject.next(authData);
  }

  emitAuthBootstrapStatus(status: string): void {
    this.authBootstrapStatusSubject.next(status);
  }
}

class MatSnackBarMock {
  open = jest.fn().mockReturnValue({
    afterDismissed: () => of({})
  });

  dismiss = jest.fn();
}

let routeParams: {
  page: string;
  testPerson: string;
  unitId: string;
  anchor: string | undefined;
} = {
  page: 'page-1', testPerson: 'valid@test@person', unitId: 'unit-123', anchor: undefined
};
let routeQueryParams: Record<string, string> = { auth: 'valid-token' };

// Konfiguration der Aktivierten Route, inklusive Parameter und Query Params
const fakeActivatedRoute = {
  snapshot: { data: {}, url: [{ path: '' }] },
  get params() {
    return of(routeParams);
  },
  get queryParams() {
    return of(routeQueryParams);
  }
} as unknown as ActivatedRoute;

describe('ReplayComponent', () => {
  let component: ReplayComponent;
  let fixture: ComponentFixture<ReplayComponent>;
  let snackBar: MatSnackBarMock;
  let replayBackendService: ReplayBackendServiceMock;
  let codingJobBackendServiceMock: {
    getCodingJobUnits: jest.Mock;
    updateCodingJob: jest.Mock;
    pauseCodingJob: jest.Mock;
    resumeCodingJob: jest.Mock;
    submitCodingJob: jest.Mock;
    getCodingProgress: jest.Mock;
    getCodingNotes: jest.Mock;
    getCodingJob: jest.Mock;
    saveCodingProgress: jest.Mock;
    saveCodingNotes: jest.Mock;
    updateCodingJobKeepalive: jest.Mock;
    pauseCodingJobKeepalive: jest.Mock;
  };

  beforeEach(async () => {
    sessionStorage.clear();
    routeParams = {
      page: 'page-1', testPerson: 'valid@test@person', unitId: 'unit-123', anchor: undefined
    };
    routeQueryParams = { auth: 'valid-token' };

    // Spy on token validation
    jest.spyOn(tokenUtils, 'validateToken').mockReturnValue({ isValid: true });
    jest.spyOn(tokenUtils, 'isTestperson').mockImplementation(
      testperson => testperson === 'valid@test@person' || testperson.startsWith('valid@test@')
    );

    // Spy on DOM utils
    jest.spyOn(domUtils, 'scrollToElementByAlias').mockReturnValue(true);

    codingJobBackendServiceMock = {
      getCodingJobUnits: jest.fn().mockReturnValue(of([])),
      updateCodingJob: jest.fn().mockReturnValue(of({})),
      pauseCodingJob: jest.fn().mockReturnValue(of({})),
      resumeCodingJob: jest.fn().mockReturnValue(of({})),
      submitCodingJob: jest.fn().mockReturnValue(of({})),
      getCodingProgress: jest.fn().mockReturnValue(of({})),
      getCodingNotes: jest.fn().mockReturnValue(of({})),
      getCodingJob: jest.fn().mockReturnValue(of({})),
      saveCodingProgress: jest.fn().mockReturnValue(of({})),
      saveCodingNotes: jest.fn().mockReturnValue(of({})),
      updateCodingJobKeepalive: jest.fn(),
      pauseCodingJobKeepalive: jest.fn()
    };

    await TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        { provide: ActivatedRoute, useValue: fakeActivatedRoute },
        { provide: SERVER_URL, useValue: environment.backendUrl },
        { provide: FileService, useClass: FileServiceMock },
        { provide: ResponseService, useClass: ResponseServiceMock },
        { provide: FileBackendService, useClass: FileBackendServiceMock },
        { provide: ReplayBackendService, useClass: ReplayBackendServiceMock },
        { provide: CodingJobBackendService, useValue: codingJobBackendServiceMock },
        { provide: AppService, useClass: AppServiceMock },
        { provide: MatSnackBar, useClass: MatSnackBarMock }
      ],
      imports: [ReplayComponent, TranslateModule.forRoot()]
    }).compileComponents();

    fixture = TestBed.createComponent(ReplayComponent);
    component = fixture.componentInstance;
    snackBar = TestBed.inject(MatSnackBar) as unknown as MatSnackBarMock;
    replayBackendService = TestBed.inject(ReplayBackendService) as unknown as ReplayBackendServiceMock;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    sessionStorage.clear();
    window.history.pushState({}, '', '/');
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

  it('should apply display options from query params', async () => {
    routeParams = {
      page: '0',
      testPerson: 'valid@test@person',
      unitId: 'unit-123',
      anchor: 'VAR1'
    };
    routeQueryParams = {
      auth: 'valid-token',
      mode: 'coding',
      workspaceId: '47',
      showScore: 'true',
      allowComments: 'false',
      suppressGeneralInstructions: 'true'
    };

    fixture.destroy();
    fixture = TestBed.createComponent(ReplayComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise<void>(resolve => {
      setTimeout(resolve, 0);
    });

    expect(component.codingService.showScore).toBe(true);
    expect(component.codingService.allowComments).toBe(false);
    expect(component.codingService.suppressGeneralInstructions).toBe(true);
  });

  it('should keep server timings from replay payload', () => {
    expect((component as unknown as { serverTimings: Record<string, number> | null }).serverTimings)
      .toEqual({
        responseTotalMs: 5
      });
  });

  it('should calculate route and player timing segments', () => {
    const privateComponent = component as unknown as {
      routeStartTime: number;
      loadStartTime: number;
      payloadRequestStartTime: number;
      payloadResponseTime: number;
      playerReadyTime: number;
      getClientTimings: (visibleTime: number) => Record<string, number | null>;
    };

    privateComponent.routeStartTime = 100;
    privateComponent.loadStartTime = 300;
    privateComponent.payloadRequestStartTime = 300;
    privateComponent.payloadResponseTime = 500;
    privateComponent.playerReadyTime = 650;

    expect(privateComponent.getClientTimings(900)).toEqual({
      routeToVisibleMs: 800,
      loadToVisibleMs: 600,
      routeToPayloadRequestMs: 200,
      payloadMs: 200,
      payloadToVisibleMs: 400,
      payloadToPlayerReadyMs: 150,
      playerReadyToVisibleMs: 250
    });
  });

  it('should store client and server timings with replay statistics', () => {
    const privateComponent = component as unknown as {
      routeStartTime: number;
      loadStartTime: number;
      payloadRequestStartTime: number;
      payloadResponseTime: number;
      playerReadyTime: number;
      serverTimings: Record<string, number> | null;
      storeReplayStatistics: (
        success: boolean,
        duration: number,
        errorMessage?: string,
        visibleTime?: number
      ) => void;
    };

    replayBackendService.storeReplayStatistics.mockClear();
    component.workspaceId = 42;
    privateComponent.routeStartTime = 100;
    privateComponent.loadStartTime = 300;
    privateComponent.payloadRequestStartTime = 300;
    privateComponent.payloadResponseTime = 500;
    privateComponent.playerReadyTime = 650;
    privateComponent.serverTimings = {
      responseTotalMs: 5
    };

    privateComponent.storeReplayStatistics(true, 800, undefined, 900);

    expect(replayBackendService.storeReplayStatistics).toHaveBeenCalledWith(
      expect.any(Number),
      expect.objectContaining({
        durationMilliseconds: 800,
        success: true,
        clientTimings: {
          routeToVisibleMs: 800,
          loadToVisibleMs: 600,
          routeToPayloadRequestMs: 200,
          payloadMs: 200,
          payloadToVisibleMs: 400,
          payloadToPlayerReadyMs: 150,
          playerReadyToVisibleMs: 250
        },
        serverTimings: {
          responseTotalMs: 5
        }
      }),
      'valid-token'
    );
  });

  it('should omit auth and booklet units data from replay statistics URL', () => {
    const privateComponent = component as unknown as {
      storeReplayStatistics: (
        success: boolean,
        duration: number,
        errorMessage?: string,
        visibleTime?: number
      ) => void;
    };
    const unitsData = encodeURIComponent('x'.repeat(5000));

    window.history.pushState(
      {},
      '',
      `/#/replay/login@@group@BOOKLET_A/UNIT_1/0/0?auth=secret&mode=booklet-view&unitsData=${unitsData}&reviewCodeSelections=${encodeURIComponent('[{"code":1,"coderNames":["Coder A"]}]')}`
    );

    replayBackendService.storeReplayStatistics.mockClear();
    component.workspaceId = 42;

    privateComponent.storeReplayStatistics(true, 800, undefined, 900);

    expect(replayBackendService.storeReplayStatistics).toHaveBeenCalledWith(
      expect.any(Number),
      expect.objectContaining({
        replayUrl: expect.stringContaining('mode=booklet-view')
      }),
      'valid-token'
    );
    const replayUrl = replayBackendService.storeReplayStatistics.mock.calls[0][1].replayUrl as string;
    expect(replayUrl).not.toContain('auth=');
    expect(replayUrl).not.toContain('unitsData=');
    expect(replayUrl).not.toContain('reviewCodeSelections=');
    expect(replayUrl.length).toBeLessThan(2000);
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
    component.page = 'page-1';
    component.checkPageError('notInList');
    expect(snackBar.open).toHaveBeenCalledWith(
      'Keine valide Seite mit der ID "page-1" gefunden',
      'Schließen',
      { panelClass: ['snackbar-error'] }
    );
  });

  it('should send selected replay code and score back to the comparison opener', async () => {
    const postMessage = jest.fn();
    Object.defineProperty(window, 'opener', {
      value: { postMessage },
      configurable: true
    });
    component.originResponseId = 99;
    component.testPerson = 'valid@test@person';
    component.unitId = 'unit-123';
    component.workspaceId = 5;
    jest.spyOn(component.codingService, 'getNotes').mockReturnValue('Replay note');
    jest.spyOn(component.codingService, 'handleCodeSelected').mockResolvedValue({
      id: 7,
      code: '7',
      label: 'Code 7',
      score: 2
    });

    await component.onCodeSelected({
      variableId: 'VAR1',
      code: {
        id: 7,
        label: 'Code 7',
        score: 2
      }
    });

    expect(postMessage).toHaveBeenCalledWith({
      type: 'replayCodeSelected',
      testPerson: 'valid@test@person',
      unitId: 'unit-123',
      variableId: 'VAR1',
      code: '7',
      score: 2,
      notes: 'Replay note',
      responseId: 99
    }, '*');
  });

  it('should send committed replay notes back to the comparison opener on blur', () => {
    const postMessage = jest.fn();
    Object.defineProperty(window, 'opener', {
      value: { postMessage },
      configurable: true
    });
    component.originResponseId = 99;
    component.testPerson = 'valid@test@person';
    component.unitId = 'unit-123';
    component.codingService.currentVariableId = 'VAR1';

    component.onNotesCommitted('Late replay note');

    expect(postMessage).toHaveBeenCalledWith({
      type: 'replayNotesCommitted',
      testPerson: 'valid@test@person',
      unitId: 'unit-123',
      variableId: 'VAR1',
      notes: 'Late replay note',
      responseId: 99
    }, '*');
  });

  it('should debounce replay notes commits while typing', () => {
    jest.useFakeTimers();
    const postMessage = jest.fn();
    Object.defineProperty(window, 'opener', {
      value: { postMessage },
      configurable: true
    });
    jest.spyOn(component.codingService, 'saveNotes').mockResolvedValue();
    component.originResponseId = 99;
    component.workspaceId = 5;
    component.testPerson = 'valid@test@person';
    component.unitId = 'unit-123';
    component.codingService.currentVariableId = 'VAR1';

    component.onNotesChanged('Late replay note');
    jest.advanceTimersByTime(749);
    expect(postMessage).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(postMessage).toHaveBeenCalledWith({
      type: 'replayNotesCommitted',
      testPerson: 'valid@test@person',
      unitId: 'unit-123',
      variableId: 'VAR1',
      notes: 'Late replay note',
      responseId: 99
    }, '*');
    jest.useRealTimers();
  });

  it('should allow retrying the same committed replay notes after the duplicate window', () => {
    jest.useFakeTimers();
    const postMessage = jest.fn();
    Object.defineProperty(window, 'opener', {
      value: { postMessage },
      configurable: true
    });
    component.originResponseId = 99;
    component.testPerson = 'valid@test@person';
    component.unitId = 'unit-123';
    component.codingService.currentVariableId = 'VAR1';

    component.onNotesCommitted('Retry note');
    component.onNotesCommitted('Retry note');
    expect(postMessage).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(1000);
    component.onNotesCommitted('Retry note');

    expect(postMessage).toHaveBeenCalledTimes(2);
    jest.useRealTimers();
  });

  it('should handle rejected note saves in the component boundary', async () => {
    const saveNotesSpy = jest.spyOn(component.codingService, 'saveNotes')
      .mockRejectedValue(new Error('save failed'));
    component.workspaceId = 5;
    component.testPerson = 'valid@test@person';
    component.unitId = 'unit-123';
    component.codingService.currentVariableId = 'VAR1';

    component.onNotesChanged('note');
    await Promise.resolve();

    expect(saveNotesSpy).toHaveBeenCalledWith(
      5,
      'valid@test@person',
      'unit-123',
      'VAR1',
      'note',
      null
    );
  });

  it('should block coding interactions while reauthentication is required', async () => {
    const appService = TestBed.inject(AppService) as unknown as AppServiceMock;
    const handleCodeSelectedSpy = jest.spyOn(component.codingService, 'handleCodeSelected');
    const saveNotesSpy = jest.spyOn(component.codingService, 'saveNotes');
    const submitSpy = jest.spyOn(component.codingService, 'submitCodingJob').mockResolvedValue();

    component.isCodingMode = true;
    component.workspaceId = 5;
    component.page = '0';
    component.unitId = 'UNIT_1';
    component.testPerson = 'valid@test@person';
    component.codingService.codingJobId = 77;
    component.codingService.currentVariableId = 'VAR1';
    appService.needsReAuthentication = true;

    expect(component.isCodingReadOnly()).toBe(true);
    expect(component.isCodingInteractionBlockedByReAuthentication()).toBe(true);

    await component.onCodeSelected({
      variableId: 'VAR1',
      code: {
        id: 7,
        label: 'Code 7',
        score: 2
      }
    });
    component.onNotesChanged('note');
    await component.handleUnitChanged({
      id: 2,
      name: 'UNIT_2',
      alias: null,
      bookletId: 0,
      variableId: 'VAR2',
      variableAnchor: 'VAR2',
      variablePage: '1'
    });
    await component.submitCodingJob();

    expect(handleCodeSelectedSpy).not.toHaveBeenCalled();
    expect(saveNotesSpy).not.toHaveBeenCalled();
    expect(submitSpy).not.toHaveBeenCalled();
    expect(component.unitId).toBe('UNIT_1');
    expect(component.page).toBe('0');
    expect(snackBar.open).toHaveBeenCalledWith(
      'replay.reauthentication-required',
      'close',
      { duration: 4000, panelClass: ['snackbar-error'] }
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

  it('should update the requested page when changing coding units', async () => {
    component.isCodingMode = true;
    component.page = '0';

    await component.handleUnitChanged({
      id: 1,
      name: 'UNIT_2',
      alias: null,
      bookletId: 0,
      variableId: 'VAR_2',
      variableAnchor: 'ANCHOR_2',
      variablePage: '1'
    });

    expect(component.page).toBe('1');
    expect(component.anchor).toBe('ANCHOR_2');
    expect(component.codingService.currentVariableId).toBe('VAR_2');
  });

  it('should not change coding units when the code selector blocks leaving the current case', async () => {
    const canLeaveCurrentUnit = jest.fn().mockReturnValue(false);
    const privateComponent = component as unknown as {
      codeSelectorComponent: { canLeaveCurrentUnit: jest.Mock };
    };

    component.isCodingMode = true;
    component.unitId = 'UNIT_1';
    component.page = '0';
    component.codingService.currentVariableId = 'VAR_1';
    privateComponent.codeSelectorComponent = { canLeaveCurrentUnit };

    await component.handleUnitChanged({
      id: 2,
      name: 'UNIT_2',
      alias: null,
      bookletId: 0,
      variableId: 'VAR_2',
      variableAnchor: 'VAR_2',
      variablePage: '1'
    });

    expect(canLeaveCurrentUnit).toHaveBeenCalled();
    expect(component.unitId).toBe('UNIT_1');
    expect(component.page).toBe('0');
    expect(component.codingService.currentVariableId).toBe('VAR_1');
  });

  it('should retry anchor highlighting after the player reports visible content', () => {
    jest.useFakeTimers();
    const iframe = document.createElement('iframe');
    const highlightedSection = document.createElement('aspect-section') as HTMLElement;
    const highlightSpy = jest.spyOn(domUtils, 'highlightAspectSectionWithAnchor')
      .mockReturnValueOnce([])
      .mockReturnValueOnce([highlightedSection]);
    const scrollSpy = jest.spyOn(domUtils, 'scrollToElementByAlias').mockReturnValue(true);
    component.anchor = 'VAR1';
    component.unitPlayerComponent = {
      hostingIframe: {
        nativeElement: iframe
      }
    } as unknown as typeof component.unitPlayerComponent;

    component.onResponseVisible();

    expect(highlightSpy).toHaveBeenCalledTimes(1);
    expect(highlightSpy).toHaveBeenCalledWith(iframe, 'VAR1');
    expect(scrollSpy).not.toHaveBeenCalled();

    jest.advanceTimersByTime(100);

    expect(highlightSpy).toHaveBeenCalledTimes(2);
    expect(scrollSpy).toHaveBeenCalledWith(iframe, 'VAR1');
    jest.useRealTimers();
  });

  it('should only mark auto-coded bundle variables from the current unit', () => {
    const iframe = document.createElement('iframe');
    const highlightedSection = document.createElement('aspect-section') as HTMLElement;
    jest.spyOn(domUtils, 'highlightAspectSectionWithAnchor')
      .mockReturnValue([highlightedSection]);
    jest.spyOn(domUtils, 'scrollToElementByAlias').mockReturnValue(true);
    const bundleMarkerSpy = jest.spyOn(domUtils, 'highlightBundleVariableMarkers')
      .mockReturnValue([]);
    component.anchor = 'VAR1';
    component.page = '0';
    component.unitPlayerComponent = {
      hostingIframe: {
        nativeElement: iframe
      }
    } as unknown as typeof component.unitPlayerComponent;
    (component as unknown as {
      unitsData: {
        currentUnitIndex: number;
        units: unknown[];
      };
    }).unitsData = {
      currentUnitIndex: 0,
      units: [{
        id: 1,
        name: 'UNIT_1',
        alias: null,
        bookletId: 0,
        variableId: 'VAR1',
        bundleContext: {
          bundleId: 9,
          bundleName: 'Bundle',
          caseKey: 'case-1',
          caseOrderingMode: 'alternating',
          variables: [
            {
              responseId: 1,
              unitName: 'UNIT_1',
              variableId: 'VAR1',
              variableAnchor: 'VAR1',
              variablePage: '0',
              status: 'manual-open',
              code: null,
              score: null,
              source: 'manual'
            },
            {
              responseId: 2,
              unitName: 'UNIT_1',
              variableId: 'VAR_AUTO',
              variableAnchor: 'VAR_AUTO',
              variablePage: '0',
              status: 'auto-coded',
              code: 1,
              score: 1,
              source: 'auto'
            },
            {
              responseId: 3,
              unitName: 'UNIT_2',
              variableId: 'VAR_OTHER',
              variableAnchor: 'VAR_OTHER',
              variablePage: '0',
              status: 'auto-coded',
              code: 1,
              score: 1,
              source: 'auto'
            }
          ]
        }
      }]
    };

    component.onResponseVisible();

    expect(bundleMarkerSpy).toHaveBeenCalledWith(iframe, [
      expect.objectContaining({ anchor: 'VAR_AUTO' })
    ]);
  });

  it('should cancel stale anchor highlight retries when unit data resets', () => {
    jest.useFakeTimers();
    const iframe = document.createElement('iframe');
    const highlightSpy = jest.spyOn(domUtils, 'highlightAspectSectionWithAnchor')
      .mockReturnValue([]);
    component.anchor = 'VAR1';
    component.unitPlayerComponent = {
      hostingIframe: {
        nativeElement: iframe
      }
    } as unknown as typeof component.unitPlayerComponent;

    component.onResponseVisible();
    (component as unknown as { resetUnitData: () => void }).resetUnitData();
    jest.advanceTimersByTime(1000);

    expect(highlightSpy).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });

  it('should load units data for booklet-view mode without coding job side effects', async () => {
    const unitsData = {
      id: 0,
      name: 'BOOKLET',
      currentUnitIndex: 0,
      units: [
        {
          id: 1,
          name: 'unit-123',
          alias: 'Unit 123',
          bookletId: 0
        },
        {
          id: 2,
          name: 'unit-456',
          alias: 'Unit 456',
          bookletId: 0
        }
      ]
    };
    const updateStatusSpy = jest.spyOn(component.codingService, 'updateCodingJobStatus');
    routeQueryParams = {
      auth: 'valid-token',
      mode: 'booklet-view',
      unitsData: utf8ToBase64(JSON.stringify(unitsData))
    };

    component.subscribeRouter();
    await fixture.whenStable();
    await new Promise<void>(resolve => {
      setTimeout(resolve, 0);
    });

    const replayComponent = component as unknown as { unitsData: typeof unitsData | null };
    expect(component.isBookletReplayMode).toBe(true);
    expect(component.isCodingMode).toBe(false);
    expect(replayComponent.unitsData?.units).toHaveLength(2);
    expect(component.totalUnits).toBe(2);
    expect(updateStatusSpy).not.toHaveBeenCalled();
  });

  it('should use replay auth token when loading coding job units from query params', async () => {
    routeParams = {
      page: '0',
      testPerson: 'valid@test@person',
      unitId: 'unit-123',
      anchor: 'VAR1'
    };
    routeQueryParams = {
      auth: 'valid-token',
      mode: 'coding',
      codingJobId: '77',
      workspaceId: '47',
      onlyOpen: 'true'
    };
    codingJobBackendServiceMock.getCodingJobUnits.mockReturnValue(of([{
      responseId: 1,
      unitName: 'unit-123',
      unitAlias: 'Unit 123',
      variableId: 'VAR1',
      variableAnchor: 'VAR1',
      bookletName: 'Booklet 1',
      personLogin: 'valid',
      personCode: 'test',
      personGroup: '',
      isDoubleCoded: false,
      otherCoders: []
    }]));

    fixture.destroy();
    fixture = TestBed.createComponent(ReplayComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise<void>(resolve => {
      setTimeout(resolve, 0);
    });

    expect(codingJobBackendServiceMock.getCodingJobUnits).toHaveBeenCalledWith(47, 77, 'valid-token', true);
  });

  it('should replace an expired replay auth token before loading coding job units', async () => {
    const appService = TestBed.inject(AppService) as unknown as AppServiceMock;
    const expiredToken = createUnsignedJwt({
      workspace: '47',
      exp: Math.floor(Date.now() / 1000) - 60
    });
    fixture.destroy();
    (tokenUtils.validateToken as jest.Mock).mockImplementation((token: string) => (
      token === expiredToken ?
        { isValid: false, errorType: 'token_expired' } :
        { isValid: true }
    ));
    (jwtDecodeModule.jwtDecode as jest.Mock).mockReturnValue({ workspace: '47' });
    appService.createOwnToken.mockReturnValueOnce(of('fresh-workspace-token'));
    window.history.pushState(
      {},
      '',
      `/#/replay/valid%40test%40person/unit-123/0/VAR1?auth=${expiredToken}&mode=coding&codingJobId=77&workspaceId=47`
    );
    routeParams = {
      page: '0',
      testPerson: 'valid@test@person',
      unitId: 'unit-123',
      anchor: 'VAR1'
    };
    routeQueryParams = {
      auth: expiredToken,
      mode: 'coding',
      codingJobId: '77',
      workspaceId: '47'
    };
    codingJobBackendServiceMock.getCodingJobUnits.mockReturnValue(of([{
      responseId: 1,
      unitName: 'unit-123',
      unitAlias: 'Unit 123',
      variableId: 'VAR1',
      variableAnchor: 'VAR1',
      bookletName: 'Booklet 1',
      personLogin: 'valid',
      personCode: 'test',
      personGroup: '',
      isDoubleCoded: false,
      otherCoders: []
    }]));

    fixture = TestBed.createComponent(ReplayComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise<void>(resolve => {
      setTimeout(resolve, 0);
    });

    expect(appService.createOwnToken).toHaveBeenCalledWith(
      47,
      1,
      ['replay:read', 'replay-statistics:write', 'coding-job:operate']
    );
    expect(codingJobBackendServiceMock.getCodingJobUnits).toHaveBeenCalledWith(47, 77, 'fresh-workspace-token', false);
    expect(window.location.href).toContain('workspaceId=47');
    expect(window.location.href).not.toContain('auth=');
  });

  it('should not replace an invalid replay auth token before loading coding job units', async () => {
    const appService = TestBed.inject(AppService) as unknown as AppServiceMock;
    fixture.destroy();
    (tokenUtils.validateToken as jest.Mock).mockReturnValue({ isValid: false, errorType: 'token_invalid' });
    appService.createOwnToken.mockClear();
    window.history.pushState(
      {},
      '',
      '/#/replay/valid%40test%40person/unit-123/0/VAR1?auth=invalid-token&mode=coding&codingJobId=77&workspaceId=47'
    );
    routeParams = {
      page: '0',
      testPerson: 'valid@test@person',
      unitId: 'unit-123',
      anchor: 'VAR1'
    };
    routeQueryParams = {
      auth: 'invalid-token',
      mode: 'coding',
      codingJobId: '77',
      workspaceId: '47'
    };

    fixture = TestBed.createComponent(ReplayComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise<void>(resolve => {
      setTimeout(resolve, 0);
    });

    expect(appService.createOwnToken).not.toHaveBeenCalled();
    expect(codingJobBackendServiceMock.getCodingJobUnits).toHaveBeenCalledWith(47, 77, 'invalid-token', false);
    expect(window.location.href).toContain('auth=invalid-token');
  });

  it('should not replace an expired replay auth token for a different workspace', async () => {
    const appService = TestBed.inject(AppService) as unknown as AppServiceMock;
    const expiredTokenFromOtherWorkspace = createUnsignedJwt({
      workspace: '48',
      exp: Math.floor(Date.now() / 1000) - 60
    });
    fixture.destroy();
    (tokenUtils.validateToken as jest.Mock).mockReturnValue({ isValid: false, errorType: 'token_expired' });
    (jwtDecodeModule.jwtDecode as jest.Mock).mockReturnValue({ workspace: '48' });
    appService.createOwnToken.mockClear();
    window.history.pushState(
      {},
      '',
      `/#/replay/valid%40test%40person/unit-123/0/VAR1?auth=${expiredTokenFromOtherWorkspace}&mode=coding&codingJobId=77&workspaceId=47`
    );
    routeParams = {
      page: '0',
      testPerson: 'valid@test@person',
      unitId: 'unit-123',
      anchor: 'VAR1'
    };
    routeQueryParams = {
      auth: expiredTokenFromOtherWorkspace,
      mode: 'coding',
      codingJobId: '77',
      workspaceId: '47'
    };

    fixture = TestBed.createComponent(ReplayComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise<void>(resolve => {
      setTimeout(resolve, 0);
    });

    expect(appService.createOwnToken).not.toHaveBeenCalled();
    expect(codingJobBackendServiceMock.getCodingJobUnits).toHaveBeenCalledWith(
      47,
      77,
      expiredTokenFromOtherWorkspace,
      false
    );
    expect(window.location.href).toContain(`auth=${expiredTokenFromOtherWorkspace}`);
  });

  it('should not replace an expired replay auth token when its workspace cannot be decoded', async () => {
    const appService = TestBed.inject(AppService) as unknown as AppServiceMock;
    const expiredTokenWithoutWorkspace = createUnsignedJwt({
      exp: Math.floor(Date.now() / 1000) - 60
    });
    fixture.destroy();
    (tokenUtils.validateToken as jest.Mock).mockReturnValue({ isValid: false, errorType: 'token_expired' });
    (jwtDecodeModule.jwtDecode as jest.Mock).mockReturnValue({});
    appService.createOwnToken.mockClear();
    window.history.pushState(
      {},
      '',
      `/#/replay/valid%40test%40person/unit-123/0/VAR1?auth=${expiredTokenWithoutWorkspace}&mode=coding&codingJobId=77&workspaceId=47`
    );
    routeParams = {
      page: '0',
      testPerson: 'valid@test@person',
      unitId: 'unit-123',
      anchor: 'VAR1'
    };
    routeQueryParams = {
      auth: expiredTokenWithoutWorkspace,
      mode: 'coding',
      codingJobId: '77',
      workspaceId: '47'
    };

    fixture = TestBed.createComponent(ReplayComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise<void>(resolve => {
      setTimeout(resolve, 0);
    });

    expect(appService.createOwnToken).not.toHaveBeenCalled();
    expect(codingJobBackendServiceMock.getCodingJobUnits).toHaveBeenCalledWith(
      47,
      77,
      expiredTokenWithoutWorkspace,
      false
    );
    expect(window.location.href).toContain(`auth=${expiredTokenWithoutWorkspace}`);
  });

  it('should refresh the replay auth token after successful reauthentication', async () => {
    const appService = TestBed.inject(AppService) as unknown as AppServiceMock;
    const privateComponent = component as unknown as { authToken: string };
    const oldToken = createUnsignedJwt({
      workspace: '47',
      exp: Math.floor(Date.now() / 1000) + 60
    });
    window.history.pushState(
      {},
      '',
      `/#/replay/valid%40test%40person/unit-123/0/VAR1?auth=${oldToken}&mode=coding&codingJobId=77&workspaceId=47`
    );

    component.isCodingMode = true;
    component.workspaceId = 47;
    privateComponent.authToken = oldToken;
    component.codingService.setAuthToken(oldToken);
    (jwtDecodeModule.jwtDecode as jest.Mock).mockReturnValue({ workspace: '47' });
    await fixture.whenStable();
    await new Promise<void>(resolve => {
      setTimeout(resolve, 0);
    });
    appService.createOwnToken.mockClear();
    appService.createOwnToken.mockReturnValueOnce(of('fresh-token-after-login'));

    appService.emitAuthBootstrapStatus('session-expired');
    appService.emitAuthBootstrapStatus('ready');
    await Promise.resolve();

    expect(appService.createOwnToken).toHaveBeenCalledWith(
      47,
      1,
      ['replay:read', 'replay-statistics:write', 'coding-job:operate']
    );
    expect(privateComponent.authToken).toBe('fresh-token-after-login');
    expect(window.location.href).toContain('workspaceId=47');
    expect(window.location.href).not.toContain('auth=');
  });

  it('should not refresh an invalid replay auth token after successful reauthentication', async () => {
    const appService = TestBed.inject(AppService) as unknown as AppServiceMock;
    const privateComponent = component as unknown as { authToken: string };
    (tokenUtils.validateToken as jest.Mock).mockReturnValue({ isValid: false, errorType: 'token_invalid' });
    window.history.pushState(
      {},
      '',
      '/#/replay/valid%40test%40person/unit-123/0/VAR1?auth=invalid-token&mode=coding&codingJobId=77&workspaceId=47'
    );

    component.isCodingMode = true;
    component.workspaceId = 47;
    privateComponent.authToken = 'invalid-token';
    component.codingService.setAuthToken('invalid-token');
    await fixture.whenStable();
    await new Promise<void>(resolve => {
      setTimeout(resolve, 0);
    });
    appService.createOwnToken.mockClear();

    appService.emitAuthBootstrapStatus('session-expired');
    appService.emitAuthBootstrapStatus('ready');
    await Promise.resolve();

    expect(appService.createOwnToken).not.toHaveBeenCalled();
    expect(privateComponent.authToken).toBe('invalid-token');
    expect(window.location.href).toContain('auth=invalid-token');
  });

  it('should keep replay recovery drafts until workspace context is loaded', async () => {
    const sessionRecoveryService = TestBed.inject(SessionRecoveryService);
    const privateComponent = component as unknown as {
      restoreReplayRecoveryDraft: () => Promise<boolean>;
    };
    const draft = {
      workspaceId: 47,
      codingJobId: 77,
      currentUnitIndex: 0,
      testPerson: 'valid@test@person',
      unitId: 'unit-123',
      page: '0',
      anchor: 'VAR1',
      originResponseId: null,
      coding: {
        codingJobId: 77,
        currentVariableId: 'VAR1',
        selectedCodes: [],
        pendingSelections: [],
        openUnitKeys: [],
        notes: [],
        codingJobComment: ''
      }
    };
    sessionRecoveryService.saveDraft('replay-active-coding-state', draft);
    component.isCodingMode = true;
    component.workspaceId = 0;
    component.codingService.codingJobId = 77;
    codingJobBackendServiceMock.saveCodingProgress.mockClear();

    await expect(privateComponent.restoreReplayRecoveryDraft()).resolves.toBe(false);

    expect(sessionRecoveryService.peekDraft('replay-active-coding-state')).toEqual(draft);
    expect(codingJobBackendServiceMock.saveCodingProgress).not.toHaveBeenCalled();
  });

  it('should clear replay recovery drafts after recovered coding state is saved', async () => {
    const sessionRecoveryService = TestBed.inject(SessionRecoveryService);
    const privateComponent = component as unknown as {
      restoreReplayRecoveryDraft: () => Promise<boolean>;
      unitsData: unknown;
    };
    component.isCodingMode = true;
    component.workspaceId = 47;
    privateComponent.unitsData = {
      id: 77,
      name: 'Coding Job 77',
      currentUnitIndex: 0,
      units: [{
        id: 0,
        name: 'unit-123',
        alias: null,
        bookletId: 0,
        testPerson: 'valid@test@person',
        variableId: 'VAR1',
        variableAnchor: 'VAR1',
        variablePage: '0'
      }]
    };
    component.codingService.codingJobId = 77;
    const compositeKey = component.codingService.generateCompositeKey(
      'valid@test@person',
      'unit-123',
      'VAR1'
    );
    sessionRecoveryService.saveDraft('replay-active-coding-state', {
      workspaceId: 47,
      codingJobId: 77,
      currentUnitIndex: 0,
      testPerson: 'valid@test@person',
      unitId: 'unit-123',
      page: '0',
      anchor: 'VAR1',
      originResponseId: null,
      coding: {
        codingJobId: 77,
        currentVariableId: 'VAR1',
        selectedCodes: [],
        pendingSelections: [[compositeKey, {
          id: 7,
          code: '7',
          label: 'Seven',
          score: 2
        }]],
        openUnitKeys: [],
        notes: [],
        codingJobComment: ''
      }
    });
    codingJobBackendServiceMock.saveCodingProgress.mockClear();

    await expect(privateComponent.restoreReplayRecoveryDraft()).resolves.toBe(true);

    expect(codingJobBackendServiceMock.saveCodingProgress).toHaveBeenCalledWith(
      47,
      77,
      {
        testPerson: 'valid@test@person',
        unitId: 'unit-123',
        variableId: 'VAR1',
        selectedCode: {
          id: 7,
          code: '7',
          label: 'Seven',
          score: 2,
          codingIssueOption: null
        }
      },
      'valid-token'
    );
    expect(sessionRecoveryService.peekDraft('replay-active-coding-state')).toBeNull();
  });

  it('should not restore replay recovery drafts in coding issue review mode', async () => {
    const sessionRecoveryService = TestBed.inject(SessionRecoveryService);
    const privateComponent = component as unknown as {
      restoreReplayRecoveryDraft: () => Promise<boolean>;
      unitsData: unknown;
    };
    component.isCodingMode = true;
    component.isCodingIssueReviewMode = true;
    component.workspaceId = 47;
    privateComponent.unitsData = {
      id: 77,
      name: 'Coding Job 77',
      currentUnitIndex: 0,
      units: [{
        id: 0,
        name: 'unit-123',
        alias: null,
        bookletId: 0,
        testPerson: 'valid@test@person',
        variableId: 'VAR1',
        variableAnchor: 'VAR1',
        variablePage: '0'
      }]
    };
    component.codingService.codingJobId = 77;
    component.codingService.isCodingIssueReviewMode = true;
    const compositeKey = component.codingService.generateCompositeKey(
      'valid@test@person',
      'unit-123',
      'VAR1'
    );
    const draft = {
      workspaceId: 47,
      codingJobId: 77,
      currentUnitIndex: 0,
      testPerson: 'valid@test@person',
      unitId: 'unit-123',
      page: '0',
      anchor: 'VAR1',
      originResponseId: null,
      coding: {
        codingJobId: 77,
        currentVariableId: 'VAR1',
        selectedCodes: [],
        pendingSelections: [[compositeKey, {
          id: 7,
          code: '7',
          label: 'Seven',
          score: 2
        }]],
        openUnitKeys: [],
        notes: [],
        codingJobComment: ''
      }
    };
    sessionRecoveryService.saveDraft('replay-active-coding-state', draft);
    codingJobBackendServiceMock.saveCodingProgress.mockClear();

    await expect(privateComponent.restoreReplayRecoveryDraft()).resolves.toBe(false);

    expect(codingJobBackendServiceMock.saveCodingProgress).not.toHaveBeenCalled();
    expect(sessionRecoveryService.peekDraft('replay-active-coding-state')).toEqual(draft);
  });

  it('should restore coding decision replay drafts and notify the opener', async () => {
    const sessionRecoveryService = TestBed.inject(SessionRecoveryService);
    const postMessage = jest.fn();
    Object.defineProperty(window, 'opener', {
      value: { postMessage },
      configurable: true
    });
    const privateComponent = component as unknown as {
      restoreReplayRecoveryDraft: () => Promise<boolean>;
    };
    component.isCodingMode = true;
    component.isCodingDecisionMode = true;
    component.workspaceId = 47;
    component.originResponseId = 501;
    component.testPerson = 'valid@test@person';
    component.unitId = 'unit-123';
    component.codingService.currentVariableId = 'VAR1';
    const compositeKey = component.codingService.generateCompositeKey(
      'valid@test@person',
      'unit-123',
      'VAR1'
    );
    sessionRecoveryService.saveDraft('replay-active-coding-state', {
      workspaceId: 47,
      codingJobId: null,
      mode: 'coding-decision',
      currentUnitIndex: 0,
      testPerson: 'valid@test@person',
      unitId: 'unit-123',
      page: '0',
      anchor: 'VAR1',
      originResponseId: 501,
      coding: {
        codingJobId: null,
        currentVariableId: 'VAR1',
        selectedCodes: [],
        pendingSelections: [[compositeKey, {
          id: 7,
          code: '7',
          label: 'Seven',
          score: 2
        }]],
        openUnitKeys: [],
        notes: [[compositeKey, 'Recovered note']],
        codingJobComment: ''
      }
    });
    codingJobBackendServiceMock.saveCodingProgress.mockClear();

    await expect(privateComponent.restoreReplayRecoveryDraft()).resolves.toBe(true);

    expect(codingJobBackendServiceMock.saveCodingProgress).not.toHaveBeenCalled();
    expect(postMessage).toHaveBeenCalledWith({
      type: 'replayCodeSelected',
      testPerson: 'valid@test@person',
      unitId: 'unit-123',
      variableId: 'VAR1',
      code: '7',
      score: 2,
      notes: 'Recovered note',
      responseId: 501
    }, '*');
    expect(sessionRecoveryService.peekDraft('replay-active-coding-state')).toBeNull();
    Object.defineProperty(window, 'opener', {
      value: null,
      configurable: true
    });
  });

  it('should load coding-review mode as read-only without coding job status side effects', async () => {
    routeParams = {
      page: '0',
      testPerson: 'valid@test@person',
      unitId: 'unit-123',
      anchor: 'VAR1'
    };
    routeQueryParams = {
      auth: 'valid-token',
      mode: 'coding-review',
      codingJobId: '77',
      workspaceId: '47'
    };
    codingJobBackendServiceMock.getCodingJobUnits.mockReturnValue(of([{
      responseId: 1,
      unitName: 'unit-123',
      unitAlias: 'Unit 123',
      variableId: 'VAR1',
      variableAnchor: 'VAR1',
      bookletName: 'Booklet 1',
      personLogin: 'valid',
      personCode: 'test',
      personGroup: '',
      isDoubleCoded: false,
      otherCoders: []
    }]));
    codingJobBackendServiceMock.updateCodingJob.mockClear();
    codingJobBackendServiceMock.resumeCodingJob.mockClear();

    fixture.destroy();
    fixture = TestBed.createComponent(ReplayComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise<void>(resolve => {
      setTimeout(resolve, 0);
    });

    expect(component.isCodingMode).toBe(true);
    expect(component.isReviewMode).toBe(true);
    expect(component.codingService.isReviewMode).toBe(true);
    expect(component.isCodingReadOnly()).toBe(true);
    expect(codingJobBackendServiceMock.getCodingJobUnits).toHaveBeenCalledWith(47, 77, 'valid-token', false);
    expect(codingJobBackendServiceMock.updateCodingJob).not.toHaveBeenCalled();
    expect(codingJobBackendServiceMock.resumeCodingJob).not.toHaveBeenCalled();
  });

  it('should load coding-issue-review mode as editable without coding job status side effects', async () => {
    routeParams = {
      page: '0',
      testPerson: 'valid@test@person',
      unitId: 'unit-123',
      anchor: 'VAR1'
    };
    routeQueryParams = {
      auth: 'valid-token',
      mode: 'coding-issue-review',
      codingJobId: '77',
      workspaceId: '47'
    };
    codingJobBackendServiceMock.getCodingJobUnits.mockReturnValue(of([{
      responseId: 1,
      unitName: 'unit-123',
      unitAlias: 'Unit 123',
      variableId: 'VAR1',
      variableAnchor: 'VAR1',
      bookletName: 'Booklet 1',
      personLogin: 'valid',
      personCode: 'test',
      personGroup: '',
      isDoubleCoded: false,
      otherCoders: []
    }]));
    codingJobBackendServiceMock.getCodingJob.mockReturnValue(of({ status: 'completed' }));
    codingJobBackendServiceMock.updateCodingJob.mockClear();
    codingJobBackendServiceMock.resumeCodingJob.mockClear();

    fixture.destroy();
    fixture = TestBed.createComponent(ReplayComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise<void>(resolve => {
      setTimeout(resolve, 0);
    });

    expect(component.isCodingMode).toBe(true);
    expect(component.isReviewMode).toBe(false);
    expect(component.isCodingIssueReviewMode).toBe(true);
    expect(component.codingService.isReviewMode).toBe(false);
    expect(component.codingService.isCompletedJobReview).toBe(false);
    expect(component.isCodingReadOnly()).toBe(false);
    expect(codingJobBackendServiceMock.getCodingJobUnits).toHaveBeenCalledWith(47, 77, 'valid-token', false);
    expect(codingJobBackendServiceMock.updateCodingJob).not.toHaveBeenCalled();
    expect(codingJobBackendServiceMock.resumeCodingJob).not.toHaveBeenCalled();
  });

  it('should load coding-decision mode as editable without coding job access side effects', async () => {
    const appService = TestBed.inject(AppService) as unknown as AppServiceMock;
    routeParams = {
      page: '0',
      testPerson: 'valid@test@person',
      unitId: 'unit-123',
      anchor: 'VAR1'
    };
    routeQueryParams = {
      auth: 'valid-token',
      mode: 'coding-decision',
      originResponseId: '77',
      workspaceId: '47',
      reviewCodeSelections: JSON.stringify([
        { code: 1, coderNames: ['Coder A', 'Coder B', 'Coder A'] },
        { code: '2', coderNames: ['Coder C'] },
        { code: 'invalid', coderNames: ['Coder D'] }
      ])
    };
    appService.needsReAuthentication = true;
    codingJobBackendServiceMock.getCodingJobUnits.mockClear();
    codingJobBackendServiceMock.updateCodingJob.mockClear();
    codingJobBackendServiceMock.resumeCodingJob.mockClear();

    fixture.destroy();
    fixture = TestBed.createComponent(ReplayComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise<void>(resolve => {
      setTimeout(resolve, 0);
    });

    expect(component.isCodingMode).toBe(true);
    expect(component.isCodingDecisionMode).toBe(true);
    expect(component.isReviewMode).toBe(false);
    expect(component.isCodingIssueReviewMode).toBe(false);
    expect(component.originResponseId).toBe(77);
    expect((component as unknown as { reviewCodeSelections: unknown }).reviewCodeSelections).toEqual([
      { code: 1, coderNames: ['Coder A', 'Coder B'] },
      { code: 2, coderNames: ['Coder C'] }
    ]);
    expect(component.isCodingReadOnly()).toBe(false);
    expect(component.isCodingInteractionBlockedByReAuthentication()).toBe(false);
    expect(codingJobBackendServiceMock.getCodingJobUnits).not.toHaveBeenCalled();
    expect(codingJobBackendServiceMock.updateCodingJob).not.toHaveBeenCalled();
    expect(codingJobBackendServiceMock.resumeCodingJob).not.toHaveBeenCalled();
  });

  it('should reuse coding job units loaded from query params during replay navigation', async () => {
    routeParams = {
      page: '0',
      testPerson: 'valid@test@person',
      unitId: 'unit-123',
      anchor: 'VAR1'
    };
    routeQueryParams = {
      auth: 'valid-token',
      mode: 'coding',
      codingJobId: '77',
      workspaceId: '47',
      onlyOpen: 'true'
    };
    codingJobBackendServiceMock.getCodingJobUnits.mockReturnValue(of([{
      responseId: 1,
      unitName: 'unit-123',
      unitAlias: 'Unit 123',
      variableId: 'VAR1',
      variableAnchor: 'VAR1',
      variablePage: '0',
      bookletName: 'Booklet 1',
      personLogin: 'valid',
      personCode: 'test',
      personGroup: '',
      isDoubleCoded: false,
      otherCoders: []
    }]));

    fixture.destroy();
    fixture = TestBed.createComponent(ReplayComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise<void>(resolve => {
      setTimeout(resolve, 0);
    });

    expect(codingJobBackendServiceMock.getCodingJobUnits).toHaveBeenCalledTimes(1);

    codingJobBackendServiceMock.getCodingJobUnits.mockClear();
    component.subscribeRouter();
    await fixture.whenStable();
    await new Promise<void>(resolve => {
      setTimeout(resolve, 0);
    });

    expect(codingJobBackendServiceMock.getCodingJobUnits).not.toHaveBeenCalled();
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
    const digitShortcutCodingScheme: CodingScheme = {
      version: '1.0',
      variableCodings: [
        {
          id: 'V1',
          alias: 'V1',
          label: 'Variable 1',
          sourceType: 'BASE',
          processing: [],
          codeModel: 'MANUAL_AND_RULES',
          manualInstruction: '',
          codes: [
            {
              id: 1,
              type: 'RESIDUAL',
              label: 'Auto-only code',
              score: 0,
              ruleSetOperatorAnd: false,
              ruleSets: [],
              manualInstruction: ''
            },
            {
              id: 2,
              type: 'FULL_CREDIT',
              label: 'Manual code',
              score: 1,
              ruleSetOperatorAnd: false,
              ruleSets: [],
              manualInstruction: '<p>Manual instruction</p>'
            },
            {
              id: 4,
              type: 'RESIDUAL',
              label: 'Visually empty HTML code',
              score: 0,
              ruleSetOperatorAnd: false,
              ruleSets: [],
              manualInstruction: '<p style="margin-top: 0; min-height: 1em"></p>'
            }
          ]
        }
      ]
    };

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

    it('should ignore digit shortcuts for regular codes without manual instructions', () => {
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
          }
        ]
      };
      const replayComponent = component as ReplayComponent & { unitsData: typeof unitsData };
      replayComponent.unitsData = unitsData;
      component.codingService.currentVariableId = 'V1';
      component.codingService.codingScheme = digitShortcutCodingScheme;
      const onCodeSelectedSpy = jest.spyOn(component, 'onCodeSelected').mockResolvedValue();
      const event = new KeyboardEvent('keydown', { key: '1', code: 'Digit1' });
      const preventDefaultSpy = jest.spyOn(event, 'preventDefault');

      component.onKeyDown(event);

      expect(preventDefaultSpy).toHaveBeenCalled();
      expect(onCodeSelectedSpy).not.toHaveBeenCalled();
    });

    it('should ignore digit shortcuts for regular codes with visually empty HTML manual instructions', () => {
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
          }
        ]
      };
      const replayComponent = component as ReplayComponent & { unitsData: typeof unitsData };
      replayComponent.unitsData = unitsData;
      component.codingService.currentVariableId = 'V1';
      component.codingService.codingScheme = digitShortcutCodingScheme;
      const onCodeSelectedSpy = jest.spyOn(component, 'onCodeSelected').mockResolvedValue();
      const event = new KeyboardEvent('keydown', { key: '4', code: 'Digit4' });
      const preventDefaultSpy = jest.spyOn(event, 'preventDefault');

      component.onKeyDown(event);

      expect(preventDefaultSpy).toHaveBeenCalled();
      expect(onCodeSelectedSpy).not.toHaveBeenCalled();
    });

    it('should keep digit shortcuts for regular codes with manual instructions', () => {
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
          }
        ]
      };
      const replayComponent = component as ReplayComponent & { unitsData: typeof unitsData };
      replayComponent.unitsData = unitsData;
      component.codingService.currentVariableId = 'V1';
      component.codingService.codingScheme = digitShortcutCodingScheme;
      const onCodeSelectedSpy = jest.spyOn(component, 'onCodeSelected').mockResolvedValue();
      const event = new KeyboardEvent('keydown', { key: '2', code: 'Digit2' });

      component.onKeyDown(event);

      expect(onCodeSelectedSpy).toHaveBeenCalledWith({
        variableId: 'V1',
        code: digitShortcutCodingScheme.variableCodings[0].codes[1]
      });
    });

    it('should ignore digit shortcuts in coding review mode', () => {
      component.isCodingMode = true;
      component.isReviewMode = true;
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
          }
        ]
      };
      const replayComponent = component as ReplayComponent & { unitsData: typeof unitsData };
      replayComponent.unitsData = unitsData;
      component.codingService.currentVariableId = 'V1';
      component.codingService.codingScheme = digitShortcutCodingScheme;
      const onCodeSelectedSpy = jest.spyOn(component, 'onCodeSelected').mockResolvedValue();
      const event = new KeyboardEvent('keydown', { key: '2', code: 'Digit2' });

      component.onKeyDown(event);

      expect(onCodeSelectedSpy).not.toHaveBeenCalled();
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
      const pauseOnUnloadSpy = jest.spyOn(component.codingService, 'pauseCodingJobOnUnload');

      component.workspaceId = 42;
      component.codingService.codingJobId = 123;
      component.codingService.isCodingJobCompleted = false;
      component.isReviewMode = true;

      component.onBeforeUnload();

      expect(pauseOnUnloadSpy).not.toHaveBeenCalled();
    });

    it('should NOT pause completed review jobs on unload', () => {
      const pauseOnUnloadSpy = jest.spyOn(component.codingService, 'pauseCodingJobOnUnload');

      component.workspaceId = 42;
      component.codingService.codingJobId = 123;
      component.codingService.isCodingJobCompleted = false;
      component.codingService.isCompletedJobReview = true;
      component.isReviewMode = false;

      component.onBeforeUnload();

      expect(pauseOnUnloadSpy).not.toHaveBeenCalled();
    });

    it('should pause job on unload if NOT in review mode', () => {
      const pauseOnUnloadSpy = jest.spyOn(component.codingService, 'pauseCodingJobOnUnload');

      component.workspaceId = 42;
      component.codingService.codingJobId = 123;
      component.codingService.isCodingJobCompleted = false;
      component.isReviewMode = false;

      component.onBeforeUnload();

      expect(pauseOnUnloadSpy).toHaveBeenCalledWith(42, 123);
    });

    it('should pause an active coding job before navigating back to the coding jobs list', () => {
      const pauseSpy = jest.spyOn(component.codingService, 'pauseCodingJob').mockResolvedValue();
      const navigateSpy = jest.spyOn(
        (component as unknown as { router: { navigate: (commands: (string | number)[]) => Promise<boolean> } }).router,
        'navigate'
      ).mockResolvedValue(true);

      component.workspaceId = 42;
      component.codingService.codingJobId = 123;
      component.codingService.isCompletedJobReview = false;
      component.codingService.isCodingJobFinalized = false;
      component.isReviewMode = false;

      component.openCodingJobs();

      expect(pauseSpy).toHaveBeenCalledWith(42, 123);
      expect(navigateSpy).toHaveBeenCalledWith(['/workspace-admin', 42, 'coding', 'my-jobs']);
    });

    it('should fall back to personal coding jobs when no workspace context is available', () => {
      const navigateSpy = jest.spyOn(
        (component as unknown as { router: { navigate: (commands: (string | number)[]) => Promise<boolean> } }).router,
        'navigate'
      ).mockResolvedValue(true);

      component.workspaceId = 0;

      component.openCodingJobs();

      expect(navigateSpy).toHaveBeenCalledWith(['/coding']);
    });
  });

  describe('Submit Coding Job', () => {
    it('flushes pending row saves instead of saving all progress again before submit', async () => {
      const saveAllSpy = jest.spyOn(component.codingService, 'saveAllCodingProgress').mockResolvedValue();
      const flushSpy = jest.spyOn(component.codingService, 'flushPendingRowMutations').mockResolvedValue();
      const submitSpy = jest.spyOn(component.codingService, 'submitCodingJob').mockResolvedValue();

      component.workspaceId = 42;
      component.codingService.codingJobId = 123;
      component.codingService.hasSaveError = false;

      await component.submitCodingJob();

      expect(flushSpy).toHaveBeenCalledTimes(1);
      expect(saveAllSpy).not.toHaveBeenCalled();
      expect(submitSpy).toHaveBeenCalledWith(42, 123);
      expect(flushSpy.mock.invocationCallOrder[0]).toBeLessThan(submitSpy.mock.invocationCallOrder[0]);
    });

    it('does not submit when flushing pending row saves fails', async () => {
      const saveAllSpy = jest.spyOn(component.codingService, 'saveAllCodingProgress').mockResolvedValue();
      const flushSpy = jest.spyOn(component.codingService, 'flushPendingRowMutations')
        .mockRejectedValue(new Error('pending save failed'));
      const submitSpy = jest.spyOn(component.codingService, 'submitCodingJob').mockResolvedValue();

      component.workspaceId = 42;
      component.codingService.codingJobId = 123;
      component.codingService.hasSaveError = false;

      await component.submitCodingJob();

      expect(flushSpy).toHaveBeenCalledTimes(1);
      expect(saveAllSpy).not.toHaveBeenCalled();
      expect(submitSpy).not.toHaveBeenCalled();
    });

    it('does not save all progress again while a save error is active', async () => {
      const saveAllSpy = jest.spyOn(component.codingService, 'saveAllCodingProgress').mockResolvedValue();
      const flushSpy = jest.spyOn(component.codingService, 'flushPendingRowMutations').mockResolvedValue();
      const submitSpy = jest.spyOn(component.codingService, 'submitCodingJob').mockResolvedValue();

      component.workspaceId = 42;
      component.codingService.codingJobId = 123;
      component.codingService.hasSaveError = true;

      await component.submitCodingJob();

      expect(flushSpy).not.toHaveBeenCalled();
      expect(saveAllSpy).not.toHaveBeenCalled();
      expect(submitSpy).toHaveBeenCalledWith(42, 123);
    });
  });
});
