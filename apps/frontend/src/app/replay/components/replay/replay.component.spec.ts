// eslint-disable-next-line max-classes-per-file
import { ActivatedRoute } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { of } from 'rxjs';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ReplayComponent } from './replay.component';
import { environment } from '../../../../environments/environment';
import { SERVER_URL } from '../../../injection-tokens';
import { BackendService } from '../../../services/backend.service';
import { AppService } from '../../../services/app.service';
import * as tokenUtils from '../../utils/token-utils';
import * as domUtils from '../../utils/dom-utils';

// Beispielhafte Mocks für Services, die im Component per inject() genutzt werden
class BackendServiceMock {
  getUnitDef = jest.fn().mockReturnValue(of([{ data: 'unitDef data', file_id: 'UNIT-123.VOUD' }]));
  getResponses = jest.fn().mockReturnValue(of([{ id: 1, data: 'response data' }]));
  getUnit = jest.fn().mockReturnValue(of([{ data: '<Unit><DefinitionRef player="Player-1.0"></DefinitionRef></Unit>', file_id: 'UNIT-123' }]));
  getPlayer = jest.fn().mockReturnValue(of([{ data: 'player data', file_id: 'PLAYER-1.0' }]));
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
        { provide: BackendService, useClass: BackendServiceMock },
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
    expect(component.player).toBe('');
    expect(component.unitDef).toBe('');
    expect(component.responses).toBeUndefined();
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
      'Keine valide Seite mit der ID "" gefunden',
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
    expect(normalizedId).toBe('PLAYER-1.2');
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
});
