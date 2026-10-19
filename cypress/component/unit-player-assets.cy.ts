import { ComponentFixture } from '@angular/core/testing';
import { Component, signal } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { Subject } from 'rxjs';
import { AppService } from '../../apps/frontend/src/app/core/services/app.service';
import { FileService } from '../../apps/frontend/src/app/shared/services/file/file.service';
import { UnitPlayerComponent } from '../../apps/frontend/src/app/replay/components/unit-player/unit-player.component';
import { ResponseDto } from '../../api-dto/responses/response-dto';

// A protocol fixture, not the Aspect player: exercise real srcdoc, media and postMessage in the browser.
const player = `<!doctype html><html><body><main></main><script>
window.starts = [];
window.startTimes = [];
window.addEventListener('message', async event => {
  if (event.data.type !== 'vopStartCommand') return;
  const message = event.data;
  window.starts.push(message);
  window.startTimes.push(performance.now());
  const unit = JSON.parse(message.unitDefinition);
  const isBlob = unit.image.startsWith('blob:');
  if (isBlob && (unit.mode === 'initial-state-only' || (unit.mode === 'later-silent' && window.starts.length > 1))) {
    parent.postMessage({ type: 'vopStateChangedNotification', sessionId: message.sessionId,
      playerState: { validPages: [], currentPage: '0' } }, '*');
    parent.postMessage({ type: 'vopStateChangedNotification', sessionId: message.sessionId,
      log: [{ key: 'initializing', content: 'loading' }] }, '*');
    if (window.starts.length > 1) {
      const previousSession = window.starts[window.starts.length - 2].sessionId;
      parent.postMessage({ type: 'vopStateChangedNotification', sessionId: previousSession,
        playerState: { validPages: ['0'], currentPage: '0' } }, '*');
      parent.postMessage({ type: 'vopRuntimeErrorNotification', sessionId: previousSession, code: 'image-not-loading' }, '*');
    }
    return;
  }
  if (unit.mode === 'silent' && isBlob) return;
  if (unit.mode === 'runtime-error' && unit.image.startsWith('blob:')) {
    parent.postMessage({ type: 'vopRuntimeErrorNotification', sessionId: message.sessionId, code: 'image-not-loading' }, '*');
    return;
  }
  if (unit.mode === 'asset-error' && unit.image.startsWith('blob:')) URL.revokeObjectURL(unit.image);
  const main = document.querySelector('main');
  main.replaceChildren();
  const answer = document.createElement('p');
  answer.id = 'answer';
  answer.textContent = message.unitState.dataParts?.answer ? JSON.parse(message.unitState.dataParts.answer) : 'initial';
  main.append(answer);
  const media = [['img', 'image', 'load'], ['audio', 'audio', 'loadedmetadata'], ['video', 'video', 'loadedmetadata']];
  try {
    await Promise.all(media.filter(([, key]) => unit[key]).map(([tag, key, ready]) => new Promise((resolve, reject) => {
      const element = document.createElement(tag);
      element.id = key;
      element.addEventListener(ready, resolve, { once: true });
      element.addEventListener('error', reject, { once: true });
      element.src = unit[key];
      main.append(element);
    })));
    document.body.dataset.visibleAnswer = answer.textContent;
    parent.postMessage({ type: 'vopStateChangedNotification', sessionId: message.sessionId, playerState: { validPages: ['0'], currentPage: '0' } }, '*');
  } catch { /* The host must handle the real media error and retry with the original definition. */ }
});
parent.postMessage({ type: 'vopReadyNotification', apiVersion: '3.0' }, '*');
</script></body></html>`;

@Component({
  selector: 'coding-box-replay-assets-host',
  imports: [UnitPlayerComponent],
  template: '<coding-box-unit-player [unitDef]="definition()" [unitPlayer]="player" [unitResponses]="responses()" />'
})
class ReplayAssetsHost {
  readonly definition = signal<string | undefined>(undefined);
  readonly responses = signal<ResponseDto | undefined>(undefined);
  readonly player = player;
}

describe('zoneless replay embedded assets', () => {
  let fixture: ComponentFixture<ReplayAssetsHost>;
  let assets: { image: string; audio: string; video: string };
  let messages: Subject<MessageEvent>;
  let forwardMessage: (event: MessageEvent) => void;

  beforeEach(() => {
    cy.fixture('replay-embedded-assets').then(value => { assets = value; });
    cy.then(() => {
      messages = new Subject<MessageEvent>();
      forwardMessage = event => messages.next(event);
      window.addEventListener('message', forwardMessage);
      cy.spy(URL, 'createObjectURL').as('createObjectURL');
      cy.spy(URL, 'revokeObjectURL').as('revokeObjectURL');
    });
  });

  afterEach(() => {
    window.removeEventListener('message', forwardMessage);
    messages.complete();
  });

  function mountUnit(mode = ''): void {
    cy.then(() => cy.mount(ReplayAssetsHost, {
      imports: [TranslateModule.forRoot()],
      providers: [
        { provide: AppService, useValue: { postMessage$: messages } },
        { provide: FileService, useValue: { getDirectDownloadLink: () => '/api/packages/' } }
      ]
    })).then(result => {
      fixture = result.fixture;
      fixture.componentInstance.definition.set(JSON.stringify({ ...assets, duplicateImage: assets.image, mode }));
    });
  }

  function setAnswer(content: string): void {
    fixture.componentInstance.responses.set({
      id: 1, test_person: 'fixture-person', unit_id: 'fixture-unit', test_group: 'fixture-group',
      workspace_id: 1, created_at: new Date(0), booklet_id: 'fixture-booklet',
      responses: [{ id: 'answer', content, ts: 0, responseType: 'json' }]
    });
  }

  function frameBody(timeout = 4000) {
    return cy.get<HTMLIFrameElement>('iframe.unitHost', { timeout })
      .its('0.contentDocument.body', { timeout }).should('not.be.empty');
  }

  it('loads PNG, WAV and MP4 and reuses the same three URLs across twenty answers', () => {
    mountUnit();
    frameBody().should('have.attr', 'data-visible-answer', 'initial');
    frameBody().find<HTMLImageElement>('#image').should($image => {
      expect($image[0].naturalWidth).to.equal(1);
      expect($image[0].src).to.match(/^blob:/);
    });
    frameBody().find<HTMLMediaElement>('audio, video').should($media => {
      expect($media).to.have.length(2);
      [...$media].forEach(element => expect(element.readyState).to.be.at.least(1));
    });
    for (let index = 0; index < 20; index += 1) {
      cy.then(() => setAnswer(`answer ${index}`));
      frameBody().should('have.attr', 'data-visible-answer', `answer ${index}`);
    }
    cy.get('@createObjectURL').should('have.callCount', 3);
    cy.get('@revokeObjectURL').should('not.have.been.called');
    cy.get<HTMLIFrameElement>('iframe.unitHost').then($frame => {
      const starts = ($frame[0].contentWindow as Window & { starts: { unitDefinition: string; sessionId: string }[] }).starts;
      expect(starts).to.have.length(21);
      expect(new Set(starts.map(message => message.sessionId)).size).to.equal(21);
      expect(new Set(starts.map(message => message.unitDefinition)).size).to.equal(1);
    });
    cy.then(() => fixture.componentInstance.definition.set(JSON.stringify({ ...assets, id: 'next-unit' })));
    cy.get('@createObjectURL').should('have.callCount', 6);
    cy.get('@revokeObjectURL').should('have.callCount', 3);
    cy.then(() => fixture.destroy());
    cy.get('@revokeObjectURL').should('have.callCount', 6);
  });

  it('monitors a later answer despite early and stale state reports after a successful first start', () => {
    mountUnit('later-silent');
    frameBody().should('have.attr', 'data-visible-answer', 'initial');
    cy.then(() => setAnswer('second answer'));
    frameBody(15_000).should('have.attr', 'data-visible-answer', 'second answer');
    frameBody().find<HTMLImageElement>('#image').should($image => {
      expect($image[0].src).to.match(/^data:/);
      expect($image[0].naturalWidth).to.equal(1);
    });
    cy.get<HTMLIFrameElement>('iframe.unitHost').then($frame => {
      const { starts, startTimes } = $frame[0].contentWindow as Window & {
        starts: { sessionId: string; unitState: { dataParts: { answer: string } } }[];
        startTimes: number[];
      };
      expect(starts).to.have.length(3);
      expect(new Set(starts.map(message => message.sessionId)).size).to.equal(3);
      expect(startTimes[2] - startTimes[1]).to.be.at.least(9500);
      expect(starts[2].unitState.dataParts.answer).to.equal('"second answer"');
    });
    cy.get('@createObjectURL').should('have.callCount', 3);
  });

  ['runtime-error', 'asset-error', 'silent', 'initial-state-only'].forEach(mode => {
    it(`falls back once after ${mode} and keeps subsequent answers on the original definition`, () => {
      mountUnit(mode);
      frameBody(15_000).should('have.attr', 'data-visible-answer', 'initial');
      frameBody().find<HTMLImageElement>('#image').should($image => {
        expect($image[0].naturalWidth).to.equal(1);
        expect($image[0].src).to.match(/^data:/);
      });
      cy.then(() => setAnswer('after fallback'));
      frameBody().should('have.attr', 'data-visible-answer', 'after fallback');
      cy.get<HTMLIFrameElement>('iframe.unitHost').then($frame => {
        const starts = ($frame[0].contentWindow as Window & { starts: { unitDefinition: string; sessionId: string }[] }).starts;
        expect(starts).to.have.length(3);
        expect(starts[1].unitDefinition).to.equal(starts[2].unitDefinition);
      });
      cy.get('@createObjectURL').should('have.callCount', 3);
    });
  });
});
