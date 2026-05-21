import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { TranslateModule } from '@ngx-translate/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { of } from 'rxjs';
import { ReviewListDialogComponent } from './review-list-dialog.component';
import { CodingManagementUiService } from '../../services/coding-management-ui.service';
import { Success } from '../../../../models/success.model';

describe('ReviewListDialogComponent', () => {
  let component: ReviewListDialogComponent;
  let fixture: ComponentFixture<ReviewListDialogComponent>;
  let uiService: jest.Mocked<Partial<CodingManagementUiService>>;

  const response = {
    id: 1,
    unitid: 10,
    variableid: 'var1',
    status: 'VALUE_CHANGED',
    value: 'UEsD',
    subform: '',
    code: '1',
    score: null,
    codedstatus: 'CODING_COMPLETE',
    unitname: 'Unit1',
    login_name: 'login1'
  } as Success;

  beforeEach(async () => {
    Object.defineProperty(window, 'IntersectionObserver', {
      writable: true,
      value: jest.fn().mockImplementation(() => ({
        observe: jest.fn(),
        disconnect: jest.fn()
      }))
    });

    uiService = {
      openReplayForResponse: jest.fn().mockReturnValue(of(''))
    };

    await TestBed.configureTestingModule({
      imports: [
        ReviewListDialogComponent,
        TranslateModule.forRoot(),
        NoopAnimationsModule
      ],
      providers: [
        {
          provide: MatDialogRef,
          useValue: { close: jest.fn() }
        },
        {
          provide: MAT_DIALOG_DATA,
          useValue: { responses: [response] }
        },
        {
          provide: CodingManagementUiService,
          useValue: uiService
        }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(ReviewListDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should mark entries with empty replay URLs as failed and not auto-retry them', () => {
    component.loadReplay(0);
    component.loadReplay(0);

    expect(component.reviewItems[0].hasError).toBe(true);
    expect(uiService.openReplayForResponse).toHaveBeenCalledTimes(1);
  });

  it('should allow retrying failed replay entries', () => {
    component.loadReplay(0);
    (uiService.openReplayForResponse as jest.Mock).mockReturnValue(of('http://replay.url'));

    component.retryReplay(0);

    expect(component.reviewItems[0].hasError).toBe(false);
    expect(component.reviewItems[0].isLoaded).toBe(true);
    expect(uiService.openReplayForResponse).toHaveBeenCalledTimes(2);
  });
});
