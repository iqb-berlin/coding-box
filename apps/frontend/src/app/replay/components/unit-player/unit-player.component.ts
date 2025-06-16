import {
  AfterViewInit, Component, ElementRef, EventEmitter, Input, OnChanges, OnDestroy, Output, SimpleChange, SimpleChanges, ViewChild, inject
} from '@angular/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { ReactiveFormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import {
  debounceTime, Subject, Subscription, takeUntil
} from 'rxjs';
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
  imports: [MatFormFieldModule, MatInputModule, MatButtonModule, ReactiveFormsModule,
    TranslateModule, SpinnerComponent],
  templateUrl: './unit-player.component.html',
  styleUrl: './unit-player.component.scss'
})
export class UnitPlayerComponent implements AfterViewInit, OnChanges, OnDestroy {
  private appService = inject(AppService);
  private snackBar = inject(MatSnackBar);
  private translateService = inject(TranslateService);
  private backendService = inject(BackendService);

  @Input() unitDef: string | undefined;
  @Input() unitPlayer: string | undefined;
  @Input() unitResponses: ResponseDto | undefined;
  @Input() pageId: string | undefined;
  @Output() invalidPage: EventEmitter<'notInList' | 'notCurrent' | null> = new EventEmitter();
  @ViewChild('hostingIframe') hostingIframe!: ElementRef;
  private validPages: Subject<{ pages: string[], current: string }> = new Subject();
  private iFrameElement: HTMLIFrameElement | undefined;
  postMessageTarget: Window | undefined;
  private ngUnsubscribe = new Subject<void>();
  private validPagesSubscription: Subscription | null = null;
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
    const unitDef = 'unitDef';
    const unitPlayer = 'unitPlayer';
    const unitResponses = 'unitResponses';
    const unitDefChange = changes[unitDef];
    const unitPlayerChange = changes[unitPlayer];
    const unitResponsesChange = changes[unitResponses];

    // Check if `unitDef` is set to undefined
    if (unitDefChange?.previousValue && !unitDefChange.currentValue) {
      this.resetIframeContent();
      return;
    }

    // Check if `unitDef` has changed
    if (unitDefChange?.currentValue && unitDefChange.previousValue !== unitDefChange.currentValue) {
      this.handleUnitDefChange(unitDefChange.currentValue, unitPlayerChange, unitResponsesChange);
    }
  }

  private updateIframeContent(content: string): void {
    if (this.iFrameElement && this.iFrameElement.srcdoc !== content) {
      this.iFrameElement.srcdoc = content;
    }
  }

  private resetIframeContent(): void {
    if (this.hostingIframe) {
      this.hostingIframe.nativeElement.srcdoc = '';
    }
  }

  private handleUnitDefChange(
    newUnitDef: string,
    unitPlayerChange?: SimpleChange,
    unitResponsesChange?: SimpleChange
  ): void {
    try {
      this.unitDef = JSON.parse(newUnitDef);

      if (unitResponsesChange?.currentValue?.responses) {
        this.dataParts = unitResponsesChange.currentValue.responses.reduce(
          (acc: { [key: string]: string }, response: { id: string; content: string }) => {
            acc[response.id] = JSON.stringify(response.content);
            return acc;
          }, {}
        );
      }

      if (this.iFrameElement) {
        const unitPlayerContent = unitPlayerChange?.currentValue || this.unitPlayer || '';
        this.updateIframeContent(unitPlayerContent.replace(/&quot;/g, ''));
      }
    } catch (error) { /* empty */ }
  }

  constructor() {
    this.subscribeForMessages();
    this.subscribeForValidPages();
  }

  ngAfterViewInit(): void {
    this.iFrameElement = this.hostingIframe?.nativeElement;
    if (this.iFrameElement && this.unitPlayer) {
      this.updateIframeContent(this.unitPlayer.replace('&quot;', ''));
    }
  }

  private subscribeForValidPages(): void {
    this.validPagesSubscription = this.validPages
      .pipe(debounceTime(2000))
      .subscribe({
        next: validPages => {
          if (!this.pageId) {
            this.invalidPage.emit('notInList');
            return;
          }

          if (!validPages.pages.includes(this.pageId)) {
            this.invalidPage.emit('notInList');
          } else if (validPages.current !== this.pageId) {
            this.invalidPage.emit('notCurrent');
          } else {
            this.invalidPage.emit(null);
            this.cleanupValidPagesSubscription();
          }
        },
        error: () => {
          this.invalidPage.emit('notInList');
        }
      });
  }

  private cleanupValidPagesSubscription(): void {
    this.validPagesSubscription?.unsubscribe();
    this.validPagesSubscription = null;
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
            case 'vo.FromPlayer.ReadyNotification': {
              // Check if the message type is relevant
              if (msgType === 'vopReadyNotification' || msgType === 'player') {
                // Extract the major version number from metadata or API version
                const majorVersionMatch =
                  msgData.metadata?.specVersion.match(/\d+/) ??
                  msgData.apiVersion?.match(/\d+/) ??
                  msgData.specVersion?.match(/\d+/);
                this.playerApiVersion = majorVersionMatch && majorVersionMatch.length > 0 ?
                  Number(majorVersionMatch[0]) :
                  2; // Default to version 2 if none found
              } else {
                // Default version for non-relevant message types
                this.playerApiVersion = 1;
              }

              // Generate a random session ID
              const array = new Uint32Array(1);
              window.crypto.getRandomValues(array);
              this.sessionId = ((array[0] % 20_000_000) + 10_000_000).toString(); // Session ID between 10M and 30M
              this.postMessageTarget = m.source as Window;
              this.sendUnitData();
              break;
            }

            case 'vo.FromPlayer.StartedNotification':
              this.setPageList(msgData.validPages, msgData.currentPage);
              this.setPresentationStatus(msgData.presentationComplete);
              this.setResponsesStatus(msgData.responsesGiven);
              break;

            case 'vopStateChangedNotification':
              if (msgData.playerState) {
                const pages = msgData.playerState.validPages;
                const current = msgData.playerState.currentPage.toString();
                this.setPageList(Object.keys(pages), msgData.playerState.currentPage);
                this.validPages.next({ pages: Object.keys(pages), current });
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
    if (!this.postMessageTarget) {
      return;
    }

    const unitDefStringified = JSON.stringify(this.unitDef);
    const postMessageData: { sessionId: string; unitDefinition: string; type?: string; unitState?: object; playerConfig?: object } = {
      sessionId: this.sessionId,
      unitDefinition: unitDefStringified
    };

    if (this.playerApiVersion === 1) {
      postMessageData.type = 'vo.ToPlayer.DataTransfer';
    } else {
      this.isLoaded.next(true);
      Object.assign(postMessageData, {
        type: 'vopStartCommand',
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
        }
      });
    }

    this.postMessageTarget.postMessage(postMessageData, '*');
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
    } else if (this.pageList.length > 1 && currentPage !== undefined) {
      const currentPageIndex = this.pageList
        .findIndex(page => page.id === currentPage && page.type === '#goto');

      this.pageList.forEach((page, index) => {
        page.disabled = page.type === '#goto' && index === currentPageIndex;
      });

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
    const statusMapping: Record<string, Progress> = {
      yes: 'complete',
      complete: 'complete',
      no: 'some',
      some: 'some'
    };

    this.presentationProgress = statusMapping[status] || 'none';
  }

  setResponsesStatus(status: string): void {
    const statusMap: { [key: string]: Progress } = {
      all: 'complete',
      complete: 'complete',
      yes: 'some',
      some: 'some'
    };

    this.responseProgress = statusMap[status] || 'none';
  }

  setFocusStatus(status: boolean): void {
    this.hasFocus = status;
  }

  gotoPage(target: { action: string; index?: number }): void {
    const { action, index = 0 } = target;
    let nextPageId = '';

    if (action === '#next' || action === '#previous') {
      const currentPageIndex = this.findCurrentPageIndex();
      if (currentPageIndex !== -1) {
        nextPageId = this.getAdjacentPageId(action, currentPageIndex);
      }
    } else if (action === '#goto') {
      nextPageId = this.getTargetPageId(index);
    } else if (index === 0) {
      // Call from player
      nextPageId = action;
    }

    if (nextPageId && this.postMessageTarget) {
      this.sendPageNavigationMessage(nextPageId);
    }
  }

  /**
   * Finds the index of the current (disabled) page in the page list.
   * @returns The current page's index or -1 if not found.
   */
  private findCurrentPageIndex(): number {
    return this.pageList.findIndex(page => page.index > 0 && page.disabled);
  }

  /**
   * Gets the ID of the adjacent page (next or previous) based on the current page index.
   * @param action - The navigation action ('#next' or '#previous').
   * @param currentPageIndex - The index of the current page.
   * @returns The ID of the adjacent page or an empty string if invalid.
   */
  private getAdjacentPageId(action: string, currentPageIndex: number): string {
    if (action === '#next' && currentPageIndex < this.pageList.length - 1) {
      return this.pageList[currentPageIndex + 1]?.id || '';
    } if (action === '#previous' && currentPageIndex > 0) {
      return this.pageList[currentPageIndex - 1]?.id || '';
    }
    return '';
  }

  /**
   * Gets the ID of the target page by index, ensuring it's within a valid range.
   * @param index - The index of the target page.
   * @returns The ID of the target page or an empty string if invalid.
   */
  private getTargetPageId(index: number): string {
    return index > 0 && index < this.pageList.length ? this.pageList[index]?.id || '' : '';
  }

  /**
   * Sends a postMessage to navigate to a specific page.
   * @param pageId - The ID of the page to navigate to.
   */
  private sendPageNavigationMessage(pageId: string): void {
    const messageType =
      this.playerApiVersion === 1 ?
        'vo.ToPlayer.NavigateToPage' :
        'vopPageNavigationCommand';

    const messagePayload =
      this.playerApiVersion === 1 ?
        { type: messageType, sessionId: this.sessionId, newPage: pageId } :
        { type: messageType, sessionId: this.sessionId, target: pageId };

    this.postMessageTarget?.postMessage(messagePayload, '*');
  }

  ngOnDestroy(): void {
    this.ngUnsubscribe.next();
    this.ngUnsubscribe.complete();

    if (this.validPagesSubscription) {
      this.validPagesSubscription.unsubscribe();
      this.validPagesSubscription = null;
    }
  }
}
