import {
  AfterViewInit,
  Component, ElementRef, ViewChild
} from '@angular/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { ReactiveFormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Subject, takeUntil } from 'rxjs';
import { MatSnackBar } from '@angular/material/snack-bar';
import { BackendService } from '../../services/backend.service';
import { AppService } from '../../services/app.service';
import { unitDef } from './unitDefinition';
import { dataParts } from './dataParts';


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
  imports: [MatFormFieldModule, MatInputModule, MatButtonModule, ReactiveFormsModule, TranslateModule],
  templateUrl: './unit-player.component.html',
  styleUrl: './unit-player.component.scss'
})
export class UnitPlayerComponent implements AfterViewInit {
  @ViewChild('hostingIframe') hostingIframe!: ElementRef;
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

  constructor(
    private backendService:BackendService,
    private appService: AppService,
    private snackBar: MatSnackBar,
    private translateService: TranslateService
  ) {
    this.subscribeForMessages();
  }

  ngAfterViewInit(): void {
    this.iFrameElement = this.hostingIframe?.nativeElement;
    this.backendService.getVeronaPlayer().subscribe((player: string) => {
      if (this.iFrameElement) {
        this.iFrameElement.srcdoc = player;
        if (this.postMessageTarget) {
          this.postMessageTarget.postMessage({
            type: 'vopStartCommand',
            sessionId: 3,
            unitState: {
              dataParts: {},
              presentationProgress: 'none',
              responseProgress: 'none'
            },
            playerConfig: {
              stateReportPolicy: 'eager',
              pagingMode: 'auto',
              directDownloadUrl: ''
            },
            unitDefinition: unitDef
          }, '*');
        }
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
    const unitDefStringified = JSON.stringify(unitDef);
    if (this.postMessageTarget) {
      if (this.playerApiVersion === 1) {
        this.postMessageTarget.postMessage({
          type: 'vo.ToPlayer.DataTransfer',
          sessionId: this.sessionId,
          unitDefinition: unitDefStringified
        }, '*');
      } else {
        this.postMessageTarget.postMessage({
          type: 'vopStartCommand',
          sessionId: this.sessionId,
          unitState: {
            dataParts: dataParts ,
            presentationProgress: 'none',
            responseProgress: 'none'
          },
          playerConfig: {
            stateReportPolicy: 'eager',
            pagingMode: 'auto',
            directDownloadUrl: ''
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
}
