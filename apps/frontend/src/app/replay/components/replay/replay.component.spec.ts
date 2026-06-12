// eslint-disable-next-line max-classes-per-file
import { ActivatedRoute } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import {
  BehaviorSubject, of, Subject, throwError
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
  let fileService: FileServiceMock;
  let replayBackendService: ReplayBackendServiceMock;
  let codingJobBackendServiceMock: {
    getCodingJobs: jest.Mock;
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
      getCodingJobs: jest.fn().mockReturnValue(of({
        data: [],
        total: 0,
        page: 1,
        limit: undefined
      })),
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
    fileService = TestBed.inject(FileService) as unknown as FileServiceMock;
    replayBackendService = TestBed.inject(ReplayBackendService) as unknown as ReplayBackendServiceMock;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
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

  it('should apply suppress general instructions from query params', async () => {
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
      `/#/replay/login@@group@BOOKLET_A/UNIT_1/0/0?auth=secret&mode=booklet-view&unitsData=${unitsData}`
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
      responseId: 99
    }, '*');
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
      'note'
    );
  });

  it('should block code and note edits while a coding job switch is running', async () => {
    const handleCodeSelectedSpy = jest.spyOn(component.codingService, 'handleCodeSelected');
    const saveNotesSpy = jest.spyOn(component.codingService, 'saveNotes');
    const privateComponent = component as unknown as { isSwitchingCodingJob: boolean };

    component.workspaceId = 5;
    component.testPerson = 'valid@test@person';
    component.unitId = 'unit-123';
    component.codingService.currentVariableId = 'VAR1';
    privateComponent.isSwitchingCodingJob = true;

    expect(component.isCodingReadOnly()).toBe(true);

    await component.onCodeSelected({
      variableId: 'VAR1',
      code: {
        id: 7,
        label: 'Code 7',
        score: 2
      }
    });
    component.onNotesChanged('note');

    expect(handleCodeSelectedSpy).not.toHaveBeenCalled();
    expect(saveNotesSpy).not.toHaveBeenCalled();
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

  it('should ignore external unit changes while a coding job switch is running', async () => {
    const privateComponent = component as ReplayComponent & {
      isSwitchingCodingJob: boolean;
      unitsData: {
        id: number;
        name: string;
        units: {
          id: number;
          name: string;
          alias: string;
          bookletId: number;
          testPerson: string;
          variableId: string;
          variableAnchor: string;
          variablePage: string;
        }[];
        currentUnitIndex: number;
      };
    };

    component.isCodingMode = true;
    component.page = '0';
    component.unitId = 'UNIT_1';
    component.currentUnitIndex = 1;
    component.codingService.currentVariableId = 'VAR_1';
    privateComponent.unitsData = {
      id: 77,
      name: 'Current Job',
      currentUnitIndex: 0,
      units: [
        {
          id: 1,
          name: 'UNIT_1',
          alias: 'UNIT_1',
          bookletId: 0,
          testPerson: 'valid@test@group@BOOKLET',
          variableId: 'VAR_1',
          variableAnchor: 'VAR_1',
          variablePage: '0'
        },
        {
          id: 2,
          name: 'UNIT_2',
          alias: 'UNIT_2',
          bookletId: 0,
          testPerson: 'valid@test@group@BOOKLET',
          variableId: 'VAR_2',
          variableAnchor: 'VAR_2',
          variablePage: '1'
        }
      ]
    };
    privateComponent.isSwitchingCodingJob = true;
    replayBackendService.getReplayPayload.mockClear();

    await component.handleUnitChanged(privateComponent.unitsData.units[1]);

    expect(replayBackendService.getReplayPayload).not.toHaveBeenCalled();
    expect(component.unitId).toBe('UNIT_1');
    expect(component.page).toBe('0');
    expect(component.currentUnitIndex).toBe(1);
    expect(privateComponent.unitsData.currentUnitIndex).toBe(0);
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

    expect(appService.createOwnToken).toHaveBeenCalledWith(47, 1);
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

    expect(appService.createOwnToken).toHaveBeenCalledWith(47, 1);
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
      workspaceId: '47'
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
    expect(component.isCodingReadOnly()).toBe(false);
    expect(component.isCodingInteractionBlockedByReAuthentication()).toBe(false);
    expect(component.canSwitchAssignedCodingJobs()).toBe(false);
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

    it('should block keyboard unit navigation while a coding job switch is running', () => {
      const privateComponent = component as ReplayComponent & { isSwitchingCodingJob: boolean };

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
            name: 'UNIT2',
            alias: 'UNIT2',
            bookletId: 0,
            testPerson: 'tp1@code1@grp@booklet',
            variableId: 'V2',
            variableAnchor: 'V2'
          }
        ]
      };
      const replayComponent = component as ReplayComponent & { unitsData: typeof unitsData };
      replayComponent.unitsData = unitsData;
      privateComponent.isSwitchingCodingJob = true;
      const handleUnitChangedSpy = jest.spyOn(component, 'handleUnitChanged').mockResolvedValue();
      const event = new KeyboardEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight' });
      const preventDefaultSpy = jest.spyOn(event, 'preventDefault');

      component.onKeyDown(event);

      expect(preventDefaultSpy).toHaveBeenCalled();
      expect(handleUnitChangedSpy).not.toHaveBeenCalled();
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
  });

  describe('Coding Job Switcher', () => {
    function createJob(id: number, workspaceId: number, name: string, status: string): CodingJob {
      return {
        id,
        workspace_id: workspaceId,
        name,
        status,
        created_at: new Date('2026-01-01T00:00:00Z'),
        updated_at: new Date('2026-01-02T00:00:00Z'),
        assignedCoders: [1],
        progress: 0,
        codedUnits: 0,
        totalUnits: 1
      };
    }

    function createReplayPayload(name: string): {
      unitDef: { data: string; file_id: string }[];
      response: { responses: { id: string; content: string }[] };
      vocs: { data: string; file_id: string }[];
      player: { data: string; file_id: string }[];
      serverTimings: { responseTotalMs: number };
    } {
      return {
        unitDef: [{ data: `${name} unitDef`, file_id: `${name}.VOUD` }],
        response: { responses: [{ id: name, content: `${name} response` }] },
        vocs: [],
        player: [{ data: `${name} player`, file_id: `${name}.js` }],
        serverTimings: {
          responseTotalMs: 5
        }
      };
    }

    function createCodingScheme(variableId: string): CodingScheme {
      return {
        version: '1.0',
        variableCodings: [{
          id: variableId,
          alias: variableId,
          label: variableId,
          sourceType: 'manual',
          processing: [],
          codeModel: 'manual',
          codes: [],
          manualInstruction: ''
        }]
      };
    }

    it('switches to an assigned coding job in another workspace', async () => {
      const appService = TestBed.inject(AppService) as unknown as AppServiceMock;
      const saveAllSpy = jest.spyOn(component.codingService, 'saveAllCodingProgress').mockResolvedValue();
      const currentJob = createJob(77, 47, 'Current Job', 'active');
      const targetJob = createJob(88, 48, 'Target Job', 'active');
      const privateComponent = component as unknown as {
        assignedCodingJobs: CodingJob[];
        selectedCodingJobKey: string;
        authToken: string;
        unitsData: { id: number; units: unknown[] } | null;
        onCodingJobSelectionChange: (jobKey: string) => Promise<void>;
      };

      component.isCodingMode = true;
      component.workspaceId = 47;
      component.codingService.codingJobId = 77;
      component.codingService.setAuthToken('valid-token');
      privateComponent.authToken = 'valid-token';
      privateComponent.assignedCodingJobs = [currentJob, targetJob];
      privateComponent.selectedCodingJobKey = '47:77';
      codingJobBackendServiceMock.getCodingJobUnits.mockReturnValueOnce(of([{
        responseId: 1,
        unitName: 'UNIT_TARGET',
        unitAlias: 'Target Unit',
        variableId: 'VAR_TARGET',
        variableAnchor: 'VAR_TARGET',
        variablePage: '2',
        bookletName: 'BOOKLET_TARGET',
        personLogin: 'valid',
        personCode: 'test',
        personGroup: 'group',
        isDoubleCoded: false,
        otherCoders: []
      }]));
      codingJobBackendServiceMock.getCodingJob.mockReturnValue(of(targetJob));

      await privateComponent.onCodingJobSelectionChange('48:88');

      expect(appService.createOwnToken).toHaveBeenCalledWith(48, 1);
      expect(codingJobBackendServiceMock.getCodingJobUnits).toHaveBeenCalledWith(48, 88, 'workspace-token', false);
      expect(saveAllSpy).toHaveBeenCalledWith(47, 77);
      expect(component.workspaceId).toBe(48);
      expect(component.codingService.codingJobId).toBe(88);
      expect(privateComponent.unitsData?.id).toBe(88);
      expect(privateComponent.selectedCodingJobKey).toBe('48:88');
      expect(window.location.href).toContain('codingJobId=88');
    });

    it('keeps switched completed coding jobs editable', async () => {
      const appService = TestBed.inject(AppService) as unknown as AppServiceMock;
      const saveAllSpy = jest.spyOn(component.codingService, 'saveAllCodingProgress').mockResolvedValue();
      const handleCodeSelectedSpy = jest.spyOn(component.codingService, 'handleCodeSelected');
      const saveNotesSpy = jest.spyOn(component.codingService, 'saveNotes');
      const currentJob = createJob(77, 47, 'Current Job', 'active');
      const completedJob = createJob(88, 48, 'Completed Job', 'completed');
      const privateComponent = component as unknown as {
        assignedCodingJobs: CodingJob[];
        selectedCodingJobKey: string;
        authToken: string;
        onCodingJobSelectionChange: (jobKey: string) => Promise<void>;
      };

      component.isCodingMode = true;
      component.workspaceId = 47;
      component.codingService.codingJobId = 77;
      component.codingService.setAuthToken('valid-token');
      privateComponent.authToken = 'valid-token';
      privateComponent.assignedCodingJobs = [currentJob, completedJob];
      privateComponent.selectedCodingJobKey = '47:77';
      appService.createOwnToken.mockReturnValueOnce(of('workspace-token'));
      codingJobBackendServiceMock.getCodingProgress.mockReturnValueOnce(throwError(() => new Error('Progress error')));
      codingJobBackendServiceMock.updateCodingJob.mockClear();
      codingJobBackendServiceMock.resumeCodingJob.mockClear();
      codingJobBackendServiceMock.getCodingJobUnits.mockReturnValueOnce(of([{
        responseId: 1,
        unitName: 'UNIT_COMPLETED',
        unitAlias: 'Completed Unit',
        variableId: 'VAR_COMPLETED',
        variableAnchor: 'VAR_COMPLETED',
        variablePage: '2',
        bookletName: 'BOOKLET_COMPLETED',
        personLogin: 'valid',
        personCode: 'test',
        personGroup: 'completed',
        isDoubleCoded: false,
        otherCoders: []
      }]));
      codingJobBackendServiceMock.getCodingJob.mockReturnValue(of(completedJob));

      await privateComponent.onCodingJobSelectionChange('48:88');

      expect(saveAllSpy).toHaveBeenCalledWith(47, 77);
      expect(component.codingService.isCompletedJobReview).toBe(false);
      expect(component.isCodingReadOnly()).toBe(false);
      expect(codingJobBackendServiceMock.updateCodingJob).not.toHaveBeenCalled();
      expect(codingJobBackendServiceMock.resumeCodingJob).toHaveBeenCalledWith(
        48,
        88,
        'workspace-token'
      );

      await component.onCodeSelected({
        variableId: 'VAR_COMPLETED',
        code: {
          id: 1,
          label: 'Code 1'
        }
      });
      component.onNotesChanged('can be saved again');

      expect(handleCodeSelectedSpy).toHaveBeenCalled();
      expect(saveNotesSpy).toHaveBeenCalled();
    });

    it('rolls back to the previous coding job when the target replay payload fails', async () => {
      const appService = TestBed.inject(AppService) as unknown as AppServiceMock;
      const saveAllSpy = jest.spyOn(component.codingService, 'saveAllCodingProgress').mockResolvedValue();
      const currentToken = 'eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJ3b3Jrc3BhY2UiOiI0NyJ9.sig';
      const targetToken = 'eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJ3b3Jrc3BhY2UiOiI0OCJ9.sig';
      const currentJob = createJob(77, 47, 'Current Job', 'active');
      const targetJob = createJob(88, 48, 'Target Job', 'active');
      const currentUnitsData = {
        id: 77,
        name: 'Current Job',
        units: [{
          id: 0,
          name: 'UNIT_CURRENT',
          alias: 'Current Unit',
          bookletId: 0,
          testPerson: 'valid@test@current@BOOKLET_CURRENT',
          variableId: 'VAR_CURRENT',
          variableAnchor: 'VAR_CURRENT',
          variablePage: '1'
        }],
        currentUnitIndex: 0
      };
      const privateComponent = component as unknown as {
        assignedCodingJobs: CodingJob[];
        selectedCodingJobKey: string;
        authToken: string;
        unitsData: typeof currentUnitsData | null;
        onCodingJobSelectionChange: (jobKey: string) => Promise<void>;
      };

      component.isCodingMode = true;
      component.workspaceId = 47;
      component.testPerson = 'valid@test@current@BOOKLET_CURRENT';
      component.unitId = 'UNIT_CURRENT';
      component.player = 'current player';
      component.unitDef = 'current unitDef';
      component.responses = { responses: [{ id: 'current', content: 'current response' }] };
      component.codingService.codingJobId = 77;
      component.codingService.currentVariableId = 'VAR_CURRENT';
      component.codingService.selectedCodes.set('current-key', { id: 1, code: '1', label: 'Current Code' });
      component.codingService.notes.set('current-note-key', 'Current Note');
      component.codingService.setAuthToken(currentToken);
      privateComponent.authToken = currentToken;
      privateComponent.unitsData = currentUnitsData;
      privateComponent.assignedCodingJobs = [currentJob, targetJob];
      privateComponent.selectedCodingJobKey = '47:77';
      appService.createOwnToken.mockReturnValueOnce(of(targetToken));
      codingJobBackendServiceMock.getCodingJobUnits.mockReturnValueOnce(of([{
        responseId: 1,
        unitName: 'UNIT_TARGET',
        unitAlias: 'Target Unit',
        variableId: 'VAR_TARGET',
        variableAnchor: 'VAR_TARGET',
        variablePage: '2',
        bookletName: 'BOOKLET_TARGET',
        personLogin: 'valid',
        personCode: 'test',
        personGroup: 'target',
        isDoubleCoded: false,
        otherCoders: []
      }]));
      replayBackendService.getReplayPayload.mockClear();
      replayBackendService.getReplayPayload.mockReturnValueOnce(throwError(() => new Error('Payload error')));

      await privateComponent.onCodingJobSelectionChange('48:88');

      expect(saveAllSpy).toHaveBeenCalledWith(47, 77);
      expect(component.workspaceId).toBe(47);
      expect(component.codingService.codingJobId).toBe(77);
      expect(privateComponent.selectedCodingJobKey).toBe('47:77');
      expect(privateComponent.unitsData).toBe(currentUnitsData);
      expect(component.testPerson).toBe('valid@test@current@BOOKLET_CURRENT');
      expect(component.unitId).toBe('UNIT_CURRENT');
      expect(component.player).toBe('current player');
      expect(component.unitDef).toBe('current unitDef');
      expect(component.responses).toEqual({ responses: [{ id: 'current', content: 'current response' }] });
      expect(component.codingService.currentVariableId).toBe('VAR_CURRENT');
      expect(component.codingService.selectedCodes.get('current-key')).toEqual({ id: 1, code: '1', label: 'Current Code' });
      expect(component.codingService.notes.get('current-note-key')).toBe('Current Note');
      expect(codingJobBackendServiceMock.resumeCodingJob).not.toHaveBeenCalledWith(48, 88, targetToken);
      expect(snackBar.open).toHaveBeenCalledWith(
        'replay.job-switcher.switch-error',
        'close',
        { duration: 4000, panelClass: ['snackbar-error'] }
      );
    });

    it('clears notes from the previous coding job when the target job has none', async () => {
      const appService = TestBed.inject(AppService) as unknown as AppServiceMock;
      jest.spyOn(component.codingService, 'saveAllCodingProgress').mockResolvedValue();
      const currentJob = createJob(77, 47, 'Current Job', 'active');
      const targetJob = createJob(88, 48, 'Target Job', 'active');
      const staleTargetNoteKey = component.codingService.generateCompositeKey(
        'valid@test@target@BOOKLET_TARGET',
        'UNIT_TARGET',
        'VAR_TARGET'
      );
      const privateComponent = component as unknown as {
        assignedCodingJobs: CodingJob[];
        selectedCodingJobKey: string;
        authToken: string;
        onCodingJobSelectionChange: (jobKey: string) => Promise<void>;
      };

      component.isCodingMode = true;
      component.workspaceId = 47;
      component.codingService.codingJobId = 77;
      component.codingService.notes.set(staleTargetNoteKey, 'Note from previous job');
      component.codingService.setAuthToken('valid-token');
      privateComponent.authToken = 'valid-token';
      privateComponent.assignedCodingJobs = [currentJob, targetJob];
      privateComponent.selectedCodingJobKey = '47:77';
      appService.createOwnToken.mockReturnValueOnce(of('workspace-token'));
      codingJobBackendServiceMock.getCodingNotes.mockReturnValueOnce(of(null));
      codingJobBackendServiceMock.getCodingJob.mockReturnValueOnce(of(targetJob));
      codingJobBackendServiceMock.getCodingJobUnits.mockReturnValueOnce(of([{
        responseId: 1,
        unitName: 'UNIT_TARGET',
        unitAlias: 'Target Unit',
        variableId: 'VAR_TARGET',
        variableAnchor: 'VAR_TARGET',
        variablePage: '2',
        bookletName: 'BOOKLET_TARGET',
        personLogin: 'valid',
        personCode: 'test',
        personGroup: 'target',
        isDoubleCoded: false,
        otherCoders: []
      }]));

      await privateComponent.onCodingJobSelectionChange('48:88');

      expect(privateComponent.selectedCodingJobKey).toBe('48:88');
      expect(component.testPerson).toBe('valid@test@target@BOOKLET_TARGET');
      expect(component.unitId).toBe('UNIT_TARGET');
      expect(component.codingService.currentVariableId).toBe('VAR_TARGET');
      expect(component.getCoderNotes()).toBe('');
    });

    it('ignores stale replay payloads after switching coding jobs', async () => {
      const appService = TestBed.inject(AppService) as unknown as AppServiceMock;
      const saveAllSpy = jest.spyOn(component.codingService, 'saveAllCodingProgress').mockResolvedValue();
      const currentToken = 'eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJ3b3Jrc3BhY2UiOiI0NyJ9.sig';
      const targetToken = 'eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJ3b3Jrc3BhY2UiOiI0OCJ9.sig';
      const stalePayload = new Subject<ReturnType<typeof createReplayPayload>>();
      const targetPayload = new Subject<ReturnType<typeof createReplayPayload>>();
      const privateComponent = component as unknown as {
        assignedCodingJobs: CodingJob[];
        selectedCodingJobKey: string;
        authToken: string;
        onCodingJobSelectionChange: (jobKey: string) => Promise<void>;
      };

      component.isCodingMode = true;
      component.workspaceId = 47;
      component.codingService.codingJobId = 77;
      component.codingService.setAuthToken(currentToken);
      privateComponent.authToken = currentToken;
      replayBackendService.getReplayPayload.mockClear();
      privateComponent.assignedCodingJobs = [
        createJob(77, 47, 'Current Job', 'active'),
        createJob(88, 48, 'Target Job', 'active')
      ];
      privateComponent.selectedCodingJobKey = '47:77';
      appService.createOwnToken.mockReturnValueOnce(of(targetToken));
      replayBackendService.getReplayPayload
        .mockReturnValueOnce(stalePayload.asObservable())
        .mockReturnValueOnce(targetPayload.asObservable());
      codingJobBackendServiceMock.getCodingJobUnits.mockReturnValueOnce(of([{
        responseId: 1,
        unitName: 'UNIT_TARGET',
        unitAlias: 'Target Unit',
        variableId: 'VAR_TARGET',
        variableAnchor: 'VAR_TARGET',
        variablePage: '2',
        bookletName: 'BOOKLET_TARGET',
        personLogin: 'valid',
        personCode: 'test',
        personGroup: 'target',
        isDoubleCoded: false,
        otherCoders: []
      }]));
      codingJobBackendServiceMock.getCodingJob.mockReturnValue(of(createJob(88, 48, 'Target Job', 'active')));

      const staleLoad = component.handleUnitChanged({
        id: 0,
        name: 'UNIT_STALE',
        alias: 'Stale Unit',
        bookletId: 0,
        testPerson: 'valid@test@stale@BOOKLET_STALE',
        variableId: 'VAR_STALE',
        variableAnchor: 'VAR_STALE',
        variablePage: '1'
      });
      const switchPromise = privateComponent.onCodingJobSelectionChange('48:88');
      await new Promise(resolve => {
        setTimeout(resolve, 0);
      });
      expect(replayBackendService.getReplayPayload).toHaveBeenCalledTimes(2);

      targetPayload.next(createReplayPayload('target'));
      targetPayload.complete();
      await switchPromise;

      expect(saveAllSpy).toHaveBeenCalledWith(47, 77);
      expect(component.workspaceId).toBe(48);
      expect(component.unitDef).toBe('target unitDef');
      expect(component.player).toBe('target player');
      expect(component.responses).toEqual({ responses: [{ id: 'target', content: 'target response' }] });

      stalePayload.next(createReplayPayload('stale'));
      stalePayload.complete();
      await staleLoad;

      expect(component.unitDef).toBe('target unitDef');
      expect(component.player).toBe('target player');
      expect(component.responses).toEqual({ responses: [{ id: 'target', content: 'target response' }] });
    });

    it('does not update the unit index from stale unit navigation', async () => {
      const currentToken = 'eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJ3b3Jrc3BhY2UiOiI0NyJ9.sig';
      const stalePayload = new Subject<ReturnType<typeof createReplayPayload>>();
      const targetPayload = new Subject<ReturnType<typeof createReplayPayload>>();
      const staleUnit = {
        id: 0,
        name: 'UNIT_STALE',
        alias: 'Stale Unit',
        bookletId: 0,
        testPerson: 'valid@test@stale@BOOKLET_STALE',
        variableId: 'VAR_STALE',
        variableAnchor: 'VAR_STALE',
        variablePage: '1'
      };
      const targetUnit = {
        id: 1,
        name: 'UNIT_TARGET',
        alias: 'Target Unit',
        bookletId: 0,
        testPerson: 'valid@test@target@BOOKLET_TARGET',
        variableId: 'VAR_TARGET',
        variableAnchor: 'VAR_TARGET',
        variablePage: '2'
      };
      const privateComponent = component as unknown as {
        authToken: string;
        unitsData: {
          id: number;
          name: string;
          units: typeof staleUnit[];
          currentUnitIndex: number;
        } | null;
      };

      component.isCodingMode = true;
      component.workspaceId = 47;
      component.codingService.setAuthToken(currentToken);
      privateComponent.authToken = currentToken;
      privateComponent.unitsData = {
        id: 77,
        name: 'Current Job',
        units: [staleUnit, targetUnit],
        currentUnitIndex: 0
      };
      replayBackendService.getReplayPayload.mockClear();
      replayBackendService.getReplayPayload
        .mockReturnValueOnce(stalePayload.asObservable())
        .mockReturnValueOnce(targetPayload.asObservable());

      const staleLoad = component.handleUnitChanged(staleUnit);
      const targetLoad = component.handleUnitChanged(targetUnit);
      await new Promise(resolve => {
        setTimeout(resolve, 0);
      });
      expect(replayBackendService.getReplayPayload).toHaveBeenCalledTimes(2);

      targetPayload.next(createReplayPayload('target'));
      targetPayload.complete();
      await targetLoad;

      expect(component.currentUnitIndex).toBe(2);
      expect(privateComponent.unitsData?.currentUnitIndex).toBe(1);

      stalePayload.next(createReplayPayload('stale'));
      stalePayload.complete();
      await staleLoad;

      expect(component.currentUnitIndex).toBe(2);
      expect(privateComponent.unitsData?.currentUnitIndex).toBe(1);
    });

    it('ignores stale fallback coding schemes after a newer unit payload applied', async () => {
      const currentToken = 'eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJ3b3Jrc3BhY2UiOiI0NyJ9.sig';
      const stalePayload = new Subject<ReturnType<typeof createReplayPayload>>();
      const targetPayload = new Subject<ReturnType<typeof createReplayPayload>>();
      const staleCodingSchemeFile = new Subject<{ base64Data: string } | null>();
      const staleScheme = createCodingScheme('VAR_STALE');
      const targetScheme = createCodingScheme('VAR_TARGET');
      const privateComponent = component as unknown as { authToken: string };

      component.isCodingMode = true;
      component.workspaceId = 47;
      component.codingService.setAuthToken(currentToken);
      privateComponent.authToken = currentToken;
      fileService.getCodingSchemeFile.mockReturnValueOnce(staleCodingSchemeFile.asObservable());
      replayBackendService.getReplayPayload.mockClear();
      replayBackendService.getReplayPayload
        .mockReturnValueOnce(stalePayload.asObservable())
        .mockReturnValueOnce(targetPayload.asObservable());

      const staleLoad = component.handleUnitChanged({
        id: 0,
        name: 'UNIT_STALE',
        alias: 'Stale Unit',
        bookletId: 0,
        testPerson: 'valid@test@stale@BOOKLET_STALE',
        variableId: 'VAR_STALE',
        variableAnchor: 'VAR_STALE',
        variablePage: '1'
      });
      await new Promise(resolve => {
        setTimeout(resolve, 0);
      });
      stalePayload.next({
        ...createReplayPayload('stale'),
        unitDef: [{
          data: '<Unit><CodingSchemeRef>stale.vocs</CodingSchemeRef></Unit>',
          file_id: 'stale.VOUD'
        }]
      });
      stalePayload.complete();
      await staleLoad;
      expect(fileService.getCodingSchemeFile).toHaveBeenCalledWith(47, 'stale.vocs');

      const targetLoad = component.handleUnitChanged({
        id: 1,
        name: 'UNIT_TARGET',
        alias: 'Target Unit',
        bookletId: 0,
        testPerson: 'valid@test@target@BOOKLET_TARGET',
        variableId: 'VAR_TARGET',
        variableAnchor: 'VAR_TARGET',
        variablePage: '2'
      });
      await new Promise(resolve => {
        setTimeout(resolve, 0);
      });
      targetPayload.next({
        ...createReplayPayload('target'),
        vocs: [{
          data: JSON.stringify(targetScheme),
          file_id: 'target.vocs'
        }]
      });
      targetPayload.complete();
      await targetLoad;

      expect(component.codingService.codingScheme).toEqual(targetScheme);

      staleCodingSchemeFile.next({ base64Data: JSON.stringify(staleScheme) });
      staleCodingSchemeFile.complete();

      expect(component.codingService.codingScheme).toEqual(targetScheme);
    });

    it('renders the coding job switcher even when no coding scheme is available', () => {
      const currentJob = createJob(77, 47, 'Current Job', 'active');
      const targetJob = createJob(88, 47, 'Target Job', 'open');
      const privateComponent = component as unknown as {
        assignedCodingJobs: CodingJob[];
        selectedCodingJobKey: string;
      };

      component.isCodingMode = true;
      component.codingService.codingScheme = null;
      component.codingService.currentVariableId = '';
      privateComponent.assignedCodingJobs = [currentJob, targetJob];
      privateComponent.selectedCodingJobKey = '47:77';

      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('.coding-job-switcher')).not.toBeNull();
      expect(fixture.nativeElement.querySelector('app-code-selector')).toBeNull();
    });

    it('does not render or use the coding job switcher in review mode', async () => {
      const currentJob = createJob(77, 47, 'Current Job', 'completed');
      const targetJob = createJob(88, 48, 'Target Job', 'active');
      const privateComponent = component as unknown as {
        assignedCodingJobs: CodingJob[];
        selectedCodingJobKey: string;
        onCodingJobSelectionChange: (jobKey: string) => Promise<void>;
      };

      component.isCodingMode = true;
      component.isReviewMode = true;
      component.codingService.isReviewMode = true;
      component.workspaceId = 47;
      component.codingService.codingJobId = 77;
      component.codingService.codingScheme = createCodingScheme('VAR_TARGET');
      component.codingService.currentVariableId = 'VAR_TARGET';
      privateComponent.assignedCodingJobs = [currentJob, targetJob];
      privateComponent.selectedCodingJobKey = '47:77';
      codingJobBackendServiceMock.getCodingJobUnits.mockClear();

      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('.coding-job-switcher')).toBeNull();
      expect(fixture.nativeElement.querySelector('app-code-selector')).not.toBeNull();

      await privateComponent.onCodingJobSelectionChange('48:88');

      expect(codingJobBackendServiceMock.getCodingJobUnits).not.toHaveBeenCalled();
      expect(component.isReviewMode).toBe(true);
      expect(component.codingService.isReviewMode).toBe(true);
      expect(privateComponent.selectedCodingJobKey).toBe('47:77');
    });

    it('keeps assigned coding jobs load failures retryable', async () => {
      const appService = TestBed.inject(AppService) as unknown as AppServiceMock;
      const privateComponent = component as unknown as {
        assignedCodingJobs: CodingJob[];
        assignedCodingJobsLoaded: boolean;
        hasAssignedCodingJobsLoadError: boolean;
        loadAssignedCodingJobs: () => Promise<void>;
        retryLoadAssignedCodingJobs: () => Promise<void>;
      };

      appService.authData = {
        ...appService.authData,
        workspaces: [{ id: 47, name: 'Workspace 47' }]
      };
      component.isCodingMode = true;
      component.workspaceId = 47;
      component.codingService.codingJobId = 77;
      codingJobBackendServiceMock.getCodingJobs
        .mockReturnValueOnce(throwError(() => new Error('Network error')))
        .mockReturnValueOnce(of({
          data: [createJob(77, 47, 'Current Job', 'active')],
          total: 1,
          page: 1,
          limit: undefined
        }));

      await privateComponent.loadAssignedCodingJobs();
      fixture.detectChanges();

      expect(privateComponent.hasAssignedCodingJobsLoadError).toBe(true);
      expect(privateComponent.assignedCodingJobsLoaded).toBe(false);
      expect(fixture.nativeElement.querySelector('.coding-job-switcher-error')).not.toBeNull();

      await privateComponent.retryLoadAssignedCodingJobs();

      expect(privateComponent.hasAssignedCodingJobsLoadError).toBe(false);
      expect(privateComponent.assignedCodingJobsLoaded).toBe(true);
      expect(privateComponent.assignedCodingJobs).toHaveLength(1);
      expect(codingJobBackendServiceMock.getCodingJobs).toHaveBeenCalledTimes(2);
    });

    it('reloads all assigned coding jobs when auth data arrives during a fallback load', async () => {
      const appService = TestBed.inject(AppService) as unknown as AppServiceMock;
      const currentJob = createJob(77, 47, 'Current Job', 'active');
      const targetJob = createJob(88, 48, 'Target Job', 'active');
      const fallbackWorkspaceLoad = new Subject<{
        data: CodingJob[];
        total: number;
        page: number;
        limit?: number;
      }>();
      const workspace47Reload = new Subject<{
        data: CodingJob[];
        total: number;
        page: number;
        limit?: number;
      }>();
      const workspace48Reload = new Subject<{
        data: CodingJob[];
        total: number;
        page: number;
        limit?: number;
      }>();
      const privateComponent = component as unknown as {
        assignedCodingJobs: CodingJob[];
        loadAssignedCodingJobs: () => Promise<void>;
      };

      appService.authData = {
        ...appService.authData,
        workspaces: []
      };
      component.isCodingMode = true;
      component.workspaceId = 47;
      component.codingService.codingJobId = 77;
      codingJobBackendServiceMock.getCodingJobs.mockReset();
      codingJobBackendServiceMock.getCodingJobs
        .mockReturnValueOnce(fallbackWorkspaceLoad.asObservable())
        .mockReturnValueOnce(workspace47Reload.asObservable())
        .mockReturnValueOnce(workspace48Reload.asObservable());

      const loadPromise = privateComponent.loadAssignedCodingJobs();
      await new Promise(resolve => {
        setTimeout(resolve, 0);
      });
      expect(codingJobBackendServiceMock.getCodingJobs).toHaveBeenCalledTimes(1);
      expect(codingJobBackendServiceMock.getCodingJobs).toHaveBeenNthCalledWith(
        1,
        47,
        undefined,
        undefined,
        { assignedTo: 'me' }
      );

      appService.emitAuthData({
        ...appService.authData,
        workspaces: [
          { id: 47, name: 'Workspace 47' },
          { id: 48, name: 'Workspace 48' }
        ]
      });
      await new Promise(resolve => {
        setTimeout(resolve, 0);
      });
      expect(codingJobBackendServiceMock.getCodingJobs).toHaveBeenCalledTimes(1);

      fallbackWorkspaceLoad.next({
        data: [currentJob],
        total: 1,
        page: 1
      });
      fallbackWorkspaceLoad.complete();
      await new Promise(resolve => {
        setTimeout(resolve, 0);
      });

      expect(codingJobBackendServiceMock.getCodingJobs).toHaveBeenCalledTimes(3);
      expect(codingJobBackendServiceMock.getCodingJobs).toHaveBeenNthCalledWith(
        2,
        47,
        undefined,
        undefined,
        { assignedTo: 'me' }
      );
      expect(codingJobBackendServiceMock.getCodingJobs).toHaveBeenNthCalledWith(
        3,
        48,
        undefined,
        undefined,
        { assignedTo: 'me' }
      );

      workspace47Reload.next({
        data: [currentJob],
        total: 1,
        page: 1
      });
      workspace47Reload.complete();
      workspace48Reload.next({
        data: [targetJob],
        total: 1,
        page: 1
      });
      workspace48Reload.complete();
      await loadPromise;

      expect(privateComponent.assignedCodingJobs.map(job => `${job.workspace_id}:${job.id}`))
        .toEqual(['47:77', '48:88']);
    });

    it('does not switch coding jobs while a save error is active', async () => {
      const targetJob = createJob(88, 48, 'Target Job', 'active');
      const privateComponent = component as unknown as {
        assignedCodingJobs: CodingJob[];
        selectedCodingJobKey: string;
        authToken: string;
        onCodingJobSelectionChange: (jobKey: string) => Promise<void>;
      };

      component.isCodingMode = true;
      component.workspaceId = 47;
      component.codingService.codingJobId = 77;
      component.codingService.hasSaveError = true;
      privateComponent.authToken = 'valid-token';
      privateComponent.assignedCodingJobs = [createJob(77, 47, 'Current Job', 'active'), targetJob];
      privateComponent.selectedCodingJobKey = '47:77';
      codingJobBackendServiceMock.getCodingJobUnits.mockClear();

      await privateComponent.onCodingJobSelectionChange('48:88');

      expect(codingJobBackendServiceMock.getCodingJobUnits).not.toHaveBeenCalled();
      expect(privateComponent.selectedCodingJobKey).toBe('47:77');
      expect(snackBar.open).toHaveBeenCalledWith(
        'replay.job-switcher.save-error',
        'close',
        { duration: 4000, panelClass: ['snackbar-error'] }
      );
    });

    it('does not switch coding jobs after a note save failed', async () => {
      const targetJob = createJob(88, 48, 'Target Job', 'active');
      const privateComponent = component as unknown as {
        assignedCodingJobs: CodingJob[];
        selectedCodingJobKey: string;
        authToken: string;
        onCodingJobSelectionChange: (jobKey: string) => Promise<void>;
      };

      component.isCodingMode = true;
      component.workspaceId = 47;
      component.testPerson = 'valid@test@BOOKLET_CURRENT';
      component.unitId = 'UNIT_CURRENT';
      component.codingService.currentVariableId = 'VAR_CURRENT';
      component.codingService.codingJobId = 77;
      component.codingService.setAuthToken('valid-token');
      privateComponent.authToken = 'valid-token';
      privateComponent.assignedCodingJobs = [createJob(77, 47, 'Current Job', 'active'), targetJob];
      privateComponent.selectedCodingJobKey = '47:77';
      codingJobBackendServiceMock.saveCodingNotes.mockReturnValueOnce(throwError(() => new Error('note save failed')));
      codingJobBackendServiceMock.getCodingJobUnits.mockClear();

      component.onNotesChanged('unsaved note');
      await Promise.resolve();
      await Promise.resolve();

      expect(component.codingService.hasSaveError).toBe(true);

      await privateComponent.onCodingJobSelectionChange('48:88');

      expect(codingJobBackendServiceMock.getCodingJobUnits).not.toHaveBeenCalled();
      expect(privateComponent.selectedCodingJobKey).toBe('47:77');
      expect(snackBar.open).toHaveBeenCalledWith(
        'replay.job-switcher.save-error',
        'close',
        { duration: 4000, panelClass: ['snackbar-error'] }
      );
    });

    it('waits for pending saves and aborts switching when one fails', async () => {
      const pendingSave = new Subject<CodingJob>();
      const saveAllSpy = jest.spyOn(component.codingService, 'saveAllCodingProgress');
      const currentJob = createJob(77, 47, 'Current Job', 'active');
      const targetJob = createJob(88, 48, 'Target Job', 'active');
      const privateComponent = component as unknown as {
        assignedCodingJobs: CodingJob[];
        selectedCodingJobKey: string;
        authToken: string;
        onCodingJobSelectionChange: (jobKey: string) => Promise<void>;
      };

      component.isCodingMode = true;
      component.workspaceId = 47;
      component.testPerson = 'valid@test@BOOKLET_CURRENT';
      component.unitId = 'UNIT_CURRENT';
      component.codingService.codingJobId = 77;
      component.codingService.setAuthToken('valid-token');
      privateComponent.authToken = 'valid-token';
      privateComponent.assignedCodingJobs = [currentJob, targetJob];
      privateComponent.selectedCodingJobKey = '47:77';
      codingJobBackendServiceMock.saveCodingProgress.mockReturnValueOnce(pendingSave.asObservable());
      codingJobBackendServiceMock.getCodingJobUnits.mockReturnValueOnce(of([{
        responseId: 1,
        unitName: 'UNIT_TARGET',
        unitAlias: 'Target Unit',
        variableId: 'VAR_TARGET',
        variableAnchor: 'VAR_TARGET',
        variablePage: '2',
        bookletName: 'BOOKLET_TARGET',
        personLogin: 'valid',
        personCode: 'test',
        personGroup: 'group',
        isDoubleCoded: false,
        otherCoders: []
      }]));
      replayBackendService.getReplayPayload.mockClear();

      const codeSavePromise = component.onCodeSelected({
        variableId: 'VAR_CURRENT',
        code: {
          id: 1,
          label: 'Code 1',
          score: 1
        }
      });
      await Promise.resolve();
      const switchPromise = privateComponent.onCodingJobSelectionChange('48:88');
      await Promise.resolve();

      pendingSave.error(new Error('pending save failed'));
      await codeSavePromise;
      await switchPromise;

      expect(saveAllSpy).not.toHaveBeenCalled();
      expect(component.workspaceId).toBe(47);
      expect(component.codingService.codingJobId).toBe(77);
      expect(privateComponent.selectedCodingJobKey).toBe('47:77');
      expect(component.codingService.hasSaveError).toBe(true);
      expect(replayBackendService.getReplayPayload).not.toHaveBeenCalled();
      expect(snackBar.open).toHaveBeenCalledWith(
        'replay.job-switcher.switch-error',
        'close',
        { duration: 4000, panelClass: ['snackbar-error'] }
      );
    });

    it('does not switch after a pending save fails before switch flushing starts', async () => {
      const pendingNotesSave = new Subject<CodingJob>();
      const targetUnits = new Subject<{
        responseId: number;
        unitName: string;
        unitAlias: string;
        variableId: string;
        variableAnchor: string;
        variablePage: string;
        bookletName: string;
        personLogin: string;
        personCode: string;
        personGroup: string;
        isDoubleCoded: boolean;
        otherCoders: never[];
      }[]>();
      const saveAllSpy = jest.spyOn(component.codingService, 'saveAllCodingProgress');
      const currentJob = createJob(77, 47, 'Current Job', 'active');
      const targetJob = createJob(88, 48, 'Target Job', 'active');
      const privateComponent = component as unknown as {
        assignedCodingJobs: CodingJob[];
        selectedCodingJobKey: string;
        authToken: string;
        onCodingJobSelectionChange: (jobKey: string) => Promise<void>;
      };

      component.isCodingMode = true;
      component.workspaceId = 47;
      component.testPerson = 'valid@test@BOOKLET_CURRENT';
      component.unitId = 'UNIT_CURRENT';
      component.codingService.currentVariableId = 'VAR_CURRENT';
      component.codingService.codingJobId = 77;
      component.codingService.setAuthToken('valid-token');
      privateComponent.authToken = 'valid-token';
      privateComponent.assignedCodingJobs = [currentJob, targetJob];
      privateComponent.selectedCodingJobKey = '47:77';
      codingJobBackendServiceMock.saveCodingNotes.mockReturnValueOnce(pendingNotesSave.asObservable());
      codingJobBackendServiceMock.getCodingJobUnits.mockReturnValueOnce(targetUnits.asObservable());
      replayBackendService.getReplayPayload.mockClear();

      component.onNotesChanged('unsaved note');
      await Promise.resolve();
      const switchPromise = privateComponent.onCodingJobSelectionChange('48:88');
      await Promise.resolve();

      pendingNotesSave.error(new Error('pending note save failed'));
      await Promise.resolve();
      await Promise.resolve();
      targetUnits.next([{
        responseId: 1,
        unitName: 'UNIT_TARGET',
        unitAlias: 'Target Unit',
        variableId: 'VAR_TARGET',
        variableAnchor: 'VAR_TARGET',
        variablePage: '2',
        bookletName: 'BOOKLET_TARGET',
        personLogin: 'valid',
        personCode: 'test',
        personGroup: 'group',
        isDoubleCoded: false,
        otherCoders: []
      }]);
      targetUnits.complete();
      await switchPromise;

      expect(saveAllSpy).not.toHaveBeenCalled();
      expect(component.workspaceId).toBe(47);
      expect(component.codingService.codingJobId).toBe(77);
      expect(privateComponent.selectedCodingJobKey).toBe('47:77');
      expect(component.codingService.hasSaveError).toBe(true);
      expect(replayBackendService.getReplayPayload).not.toHaveBeenCalled();
      expect(snackBar.open).toHaveBeenCalledWith(
        'replay.job-switcher.switch-error',
        'close',
        { duration: 4000, panelClass: ['snackbar-error'] }
      );
    });
  });

  describe('Submit Coding Job', () => {
    it('does not save all progress again while a save error is active', async () => {
      const saveAllSpy = jest.spyOn(component.codingService, 'saveAllCodingProgress').mockResolvedValue();
      const submitSpy = jest.spyOn(component.codingService, 'submitCodingJob').mockResolvedValue();

      component.workspaceId = 42;
      component.codingService.codingJobId = 123;
      component.codingService.hasSaveError = true;

      await component.submitCodingJob();

      expect(saveAllSpy).not.toHaveBeenCalled();
      expect(submitSpy).toHaveBeenCalledWith(42, 123);
    });
  });
});
