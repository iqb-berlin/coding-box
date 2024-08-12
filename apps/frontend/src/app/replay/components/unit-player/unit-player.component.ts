import {
  AfterViewInit,
  Component, ElementRef, EventEmitter, Input, OnChanges, OnDestroy, Output, SimpleChanges, ViewChild
} from '@angular/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { ReactiveFormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { debounceTime, Subject, takeUntil } from 'rxjs';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AppService } from '../../../services/app.service';
import { BackendService } from '../../../services/backend.service';
import { ResponseDto } from '../../../../../../../api-dto/responses/response-dto';
import { SpinnerComponent } from '../spinner/spinner.component';

export interface PageData {
  index: number;
  id: string;
  type: '#next' | '#previous' | '#goto';
  disabled: boolean;
}

export type Progress = 'none' | 'some' | 'complete';

@Component({
  selector: 'coding-box-unit-player',
  standalone: true,
  imports: [MatFormFieldModule, MatInputModule, MatButtonModule, ReactiveFormsModule,
    TranslateModule, SpinnerComponent],
  templateUrl: './unit-player.component.html',
  styleUrl: './unit-player.component.scss'
})
export class UnitPlayerComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() unitDef: string | undefined;
  @Input() unitPlayer: string | undefined;
  @Input() unitResponses: ResponseDto | undefined;
  @Input() pageId: string | undefined;
  @Output() invalidPage: EventEmitter<boolean> = new EventEmitter();
  @ViewChild('hostingIframe') hostingIframe!: ElementRef;
  private validPages: Subject<string[]> = new Subject<string[]>();
  private iFrameElement: HTMLIFrameElement | undefined;
  postMessageTarget: Window | undefined;
  ngUnsubscribe = new Subject<void>();
  playerApiVersion = 3;
  private sessionId = '';
  pageList: PageData[] = [];
  presentationProgress: Progress = 'none';
  responseProgress: Progress = 'none';
  hasFocus: boolean = false;
  responses!: Response[] | null;
  count: number = 0;
  dataParts!: { [key: string]: string };
  isLoaded: Subject<boolean> = new Subject<boolean>();

  ngOnChanges(changes: SimpleChanges): void {
    // eslint-disable-next-line @typescript-eslint/dot-notation
    if (changes['unitDef']?.previousValue && !changes['unitDef']?.currentValue) {
      if (this.hostingIframe) this.hostingIframe.nativeElement.srcdoc = '';
      return;
    }
    // eslint-disable-next-line @typescript-eslint/dot-notation
    if (changes['unitDef']?.currentValue && (changes['unitDef']?.previousValue !== changes['unitDef']?.currentValue)) {
      const { unitDef, unitPlayer, unitResponses } = changes;
      const parsedJSONUnitDef = JSON.parse(unitDef.currentValue);
      if (unitResponses?.currentValue && (unitResponses.currentValue).responses) {
        this.dataParts = unitResponses.currentValue.responses
          .reduce((acc: {
            [key: string]: string }, current: { id: string; content: string; ts: number; responseType: string }) => {
            acc[current.id] = current.content;
            return acc;
          }, {});
      }
      this.unitDef = parsedJSONUnitDef;
      if (this.iFrameElement) {
        this.iFrameElement.srcdoc = (unitPlayer ? unitPlayer.currentValue : this.unitPlayer).replace('&quot;', '');
      }
    }
  }

  constructor(
    private appService: AppService,
    private snackBar: MatSnackBar,
    private translateService: TranslateService,
    private backendService: BackendService
  ) {
    this.subscribeForMessages();
    this.subscribeForValidPages();
  }

  ngAfterViewInit(): void {
    this.iFrameElement = this.hostingIframe?.nativeElement;
    if (this.iFrameElement && this.unitPlayer) {
      this.iFrameElement.srcdoc = this.unitPlayer.replace('&quot;', '');
    }
  }

  private subscribeForValidPages(): void {
    this.validPages
      .pipe(debounceTime(500),
        takeUntil(this.ngUnsubscribe))
      .subscribe((pages: string[]) => {
        if (!this.pageId || !pages.includes(this.pageId)) {
          this.invalidPage.emit(true);
        }
      });
  }

  private subscribeForMessages(): void {
    this.appService.postMessage$
      .pipe(takeUntil(this.ngUnsubscribe))
      .subscribe((m: MessageEvent) => {
        const msgData = m.data;
        const msgType = msgData.type;
        if ((msgType !== undefined) && (msgType !== null) && (m.source === this.iFrameElement?.contentWindow)) {
          switch (msgType) {
            case 'vopReadyNotification':
            case 'player':
            case 'vo.FromPlayer.ReadyNotification':
              if (msgType === 'vopReadyNotification' || msgType === 'player') {
                let majorVersion;
                if (msgData.metadata) {
                  majorVersion = msgData.metadata.specVersion.match(/\d+/);
                } else {
                  majorVersion = msgData.apiVersion ?
                    msgData.apiVersion.match(/\d+/) : msgData.specVersion.match(/\d+/);
                }
                if (majorVersion.length > 0) {
                  this.playerApiVersion = Number(majorVersion[0]);
                } else {
                  this.playerApiVersion = 2;
                }
              } else {
                this.playerApiVersion = 1;
              }
              this.sessionId = Math.floor(Math.random() * 20000000 + 10000000)
                .toString();
              this.postMessageTarget = m.source as Window;
              this.sendUnitData();
              break;

            case 'vo.FromPlayer.StartedNotification':
              this.setPageList(msgData.validPages, msgData.currentPage);
              this.setPresentationStatus(msgData.presentationComplete);
              this.setResponsesStatus(msgData.responsesGiven);
              break;

            case 'vopStateChangedNotification':
              if (msgData.playerState) {
                const pages = msgData.playerState.validPages;
                this.setPageList(Object.keys(pages), msgData.playerState.currentPage);
                this.validPages.next(Object.keys(pages));
              }
              if (msgData.unitState) {
                this.responses = Object.values(msgData.unitState.dataParts)
                  .map((dp: unknown) => JSON.parse(dp as string));
                this.setPresentationStatus(msgData.unitState.presentationProgress);
                this.setResponsesStatus(msgData.unitState.responseProgress);
              }
              break;

            case 'vo.FromPlayer.ChangedDataTransfer':
              this.setPageList(msgData.validPages, msgData.currentPage);
              this.setPresentationStatus(msgData.presentationComplete);
              this.setResponsesStatus(msgData.responsesGiven);
              break;

            case 'vo.FromPlayer.PageNavigationRequest':
              this.snackBar.open(
                this.translateService
                  .instant('player-send-page-navigation-request', { target: msgData.newPage }),
                '',
                { duration: 3000 });
              this.gotoPage({ action: msgData.newPage });
              break;

            case 'vopPageNavigationCommand':
              this.snackBar.open(
                this.translateService
                  .instant('player-send-page-navigation-request', { target: msgData.target }),
                '',
                { duration: 3000 });
              this.gotoPage({ action: msgData.target });
              break;

            case 'vo.FromPlayer.UnitNavigationRequest':
              this.snackBar.open(
                this.translateService
                  .instant('player-send-unit-navigation-request',
                    { target: msgData.navigationTarget }),
                '',
                { duration: 3000 });
              break;

            case 'vopUnitNavigationRequestedNotification':
              this.snackBar.open(
                this.translateService
                  .instant('player-send-unit-navigation-request',
                    { target: msgData.target }),
                '',
                { duration: 3000 });
              break;

            case 'vopWindowFocusChangedNotification':
              this.setFocusStatus(msgData.hasFocus);
              break;

            default:
              // eslint-disable-next-line no-console
              console.warn(`processMessagePost ignored message: ${msgType}`);
              break;
          }
        }
      });
  }

  async sendUnitData() {
    this.postUnitDef();
  }

  private postUnitDef(): void {
    const unitDefStringified = JSON.stringify(this.unitDef);
    if (this.postMessageTarget) {
      if (this.playerApiVersion === 1) {
        this.postMessageTarget.postMessage({
          type: 'vo.ToPlayer.DataTransfer',
          sessionId: this.sessionId,
          unitDefinition: unitDefStringified
        }, '*');
      } else {
        this.isLoaded.next(true);
        this.postMessageTarget.postMessage({
          type: 'vopStartCommand',
          sessionId: this.sessionId,
          unitState: {
            dataParts: this.dataParts,
            presentationProgress: 'none',
            responseProgress: 'none'
          },
          playerConfig: {
            stateReportPolicy: 'eager',
            pagingMode: 'buttons',
            directDownloadUrl: this.backendService.getDirectDownloadLink(),
            startPage: this.pageId || this.unitResponses?.unit_state?.CURRENT_PAGE_ID || ''
          },
          unitDefinition: unitDefStringified
        }, '*');
      }
    }
  }

  // ++++++++++++ page nav ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  setPageList(validPages?: string[], currentPage?: string): void {
    if ((validPages instanceof Array)) {
      const newPageList: PageData[] = [];
      if (validPages.length > 1) {
        for (let i = 0; i < validPages.length; i++) {
          if (i === 0) {
            newPageList.push({
              index: -1,
              id: '#previous',
              disabled: validPages[i] === currentPage,
              type: '#previous'
            });
          }

          newPageList.push({
            index: i + 1,
            id: validPages[i],
            disabled: validPages[i] === currentPage,
            type: '#goto'
          });

          if (i === validPages.length - 1) {
            newPageList.push({
              index: -1,
              id: '#next',
              disabled: validPages[i] === currentPage,
              type: '#next'
            });
          }
        }
      }
      this.pageList = newPageList;
    } else if ((this.pageList.length > 1) && (currentPage !== undefined)) {
      let currentPageIndex = 0;
      for (let i = 0; i < this.pageList.length; i++) {
        if (this.pageList[i].type === '#goto') {
          if (this.pageList[i].id === currentPage) {
            this.pageList[i].disabled = true;
            currentPageIndex = i;
          } else {
            this.pageList[i].disabled = false;
          }
        }
      }
      if (currentPageIndex === 1) {
        this.pageList[0].disabled = true;
        this.pageList[this.pageList.length - 1].disabled = false;
      } else {
        this.pageList[0].disabled = false;
        this.pageList[this.pageList.length - 1].disabled = currentPageIndex === this.pageList.length - 2;
      }
    }
  }

  setPresentationStatus(status: string): void {
    if (status === 'yes' || status === 'complete') {
      this.presentationProgress = 'complete';
    } else if (status === 'no' || status === 'some') {
      this.presentationProgress = 'some';
    } else {
      this.presentationProgress = 'none';
    }
  }

  setResponsesStatus(status: string): void {
    if (status === 'all' || status === 'complete') {
      this.responseProgress = 'complete';
    } else if (status === 'yes' || status === 'some') {
      this.responseProgress = 'some';
    } else {
      this.responseProgress = 'none';
    }
  }

  setFocusStatus(status: boolean): void {
    this.hasFocus = status;
  }

  gotoPage(target: { action: string, index?: number }): void {
    const action = target.action;
    const index = target.index || 0;
    let nextPageId = '';
    // currentpage is detected by disabled-attribute of page
    if (action === '#next') {
      let currentPageIndex = 0;
      for (let i = 0; i < this.pageList.length; i++) {
        if ((this.pageList[i].index > 0) && (this.pageList[i].disabled)) {
          currentPageIndex = i;
          break;
        }
      }
      if ((currentPageIndex > 0) && (currentPageIndex < this.pageList.length - 2)) {
        nextPageId = this.pageList[currentPageIndex + 1].id;
      }
    } else if (action === '#previous') {
      let currentPageIndex = 0;
      for (let i = 0; i < this.pageList.length; i++) {
        if ((this.pageList[i].index > 0) && (this.pageList[i].disabled)) {
          currentPageIndex = i;
          break;
        }
      }
      if (currentPageIndex > 1) {
        nextPageId = this.pageList[currentPageIndex - 1].id;
      }
    } else if (action === '#goto') {
      if ((index > 0) && (index < this.pageList.length - 1)) {
        nextPageId = this.pageList[index].id;
      }
    } else if (index === 0) {
      // call from player
      nextPageId = action;
    }

    if (nextPageId.length > 0 && this.postMessageTarget) {
      if (this.playerApiVersion === 1) {
        this.postMessageTarget.postMessage({
          type: 'vo.ToPlayer.NavigateToPage',
          sessionId: this.sessionId,
          newPage: nextPageId
        }, '*');
      } else {
        this.postMessageTarget.postMessage({
          type: 'vopPageNavigationCommand',
          sessionId: this.sessionId,
          target: nextPageId
        }, '*');
      }
    }
  }

  ngOnDestroy() {
    this.ngUnsubscribe.next();
    this.ngUnsubscribe.complete();
  }
}
