import { Component, signal } from '@angular/core';
import { ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { TranslateModule } from '@ngx-translate/core';
import { Subject } from 'rxjs';
import { AppService } from '../../apps/frontend/src/app/core/services/app.service';
import { FileService } from '../../apps/frontend/src/app/shared/services/file/file.service';
import { UnitPlayerComponent } from '../../apps/frontend/src/app/replay/components/unit-player/unit-player.component';
import { ResponseDto } from '../../api-dto/responses/response-dto';
import aspectSources from '../fixtures/aspect-players.json';

type Start = { type: string; sessionId: string; unitDefinition: string };
type AspectElement = {
  type: string; id: string; alias: string; position: Record<string, unknown>; dimensions: Record<string, unknown>;
  [key: string]: unknown;
};
type AspectUnit = { pages: { sections: {
  elements: AspectElement[]; height: number; gridRowSizes: { value: number; unit: string }[];
}[] }[] };
type MessageSpy = { getCalls(): { args: unknown[] }[]; restore(): void };
let playerHtml = '';

@Component({
  selector: 'coding-box-aspect-assets-host',
  imports: [UnitPlayerComponent],
  template: '<coding-box-unit-player [unitDef]="definition()" [unitPlayer]="player" [unitResponses]="responses()" />'
})
class AspectAssetsHost {
  readonly definition = signal<string | undefined>(undefined);
  readonly responses = signal<ResponseDto | undefined>(undefined);
  readonly player = playerHtml;
}

aspectSources.forEach(({ version }) => {
  describe(`zoneless replay with official Aspect ${version}`, () => {
    let fixture: ComponentFixture<AspectAssetsHost>;
    let messages: Subject<MessageEvent>;
    let forwardMessage: (event: MessageEvent) => void;
    let postSpy: MessageSpy | undefined;
    let metadata: { tag: string; duration: number }[];
    let mediaErrors: { tag: string; source: string | null; currentSrc: string }[];
    let unit: AspectUnit;
    let originalDefinition: string;

    beforeEach(() => {
      cy.viewport(1280, 1000);
      cy.task<string>('replay:aspect-player', version, { log: false, timeout: 60_000 }).then(html => { playerHtml = html; });
      cy.readFile<string>('cypress/fixtures/replay-datasets/two-person-multipage/UNIT-REPLAY.VOUD', 'utf8', { log: false })
        .then(value => { unit = JSON.parse(value) as AspectUnit; });
      cy.fixture('replay-embedded-assets').then((assets: { image: string; audio: string; video: string }) => {
        const base = unit.pages[0].sections[0].elements[0];
        const element = (type: string, id: string, row: number, extra: Record<string, unknown>): AspectElement => ({
          ...base, type, id, alias: id, ...extra,
          position: { ...base.position, gridRow: row },
          dimensions: { ...base.dimensions, width: 250, height: 100 }
        });
        const player = {
          autostart: false, autostartDelay: 0, loop: false, startControl: true, pauseControl: true,
          progressBar: true, interactiveProgressbar: true, volumeControl: true, defaultVolume: 0.8, minVolume: 0.2,
          muteControl: true, interactiveMuteControl: false, hintLabel: 'Bitte starten', hintLabelDelay: 5000,
          activeAfterID: '', minRuns: 0, maxRuns: 0, showRestRuns: false, showRestTime: true, playbackTime: 0
        };
        unit.pages[0].sections[0].elements.push(
          element('image', 'replay_image', 2, {
            src: assets.image, alt: 'Replay image', scale: false, allowFullscreen: false,
            magnifier: false, magnifierSize: 100, magnifierZoom: 1.5, magnifierUsed: false, fileName: 'pixel.png'
          }),
          element('text', 'replay_rich_text', 3, {
            text: `<p>Rich text <img src="${assets.image}" alt="Inline replay image"></p>`,
            markingMode: 'selection', markingPanels: [], highlightableOrange: false, highlightableTurquoise: false,
            highlightableYellow: false, hasSelectionPopup: false, columnCount: 1
          }),
          element('audio', 'replay_audio', 4, { src: assets.audio, fileName: 'sample.wav', player }),
          element('video', 'replay_video', 5, { src: assets.video, fileName: 'sample.mp4', scale: false, player })
        );
        unit.pages[0].sections[0].height = 850;
        unit.pages[0].sections[0].gridRowSizes = Array.from({ length: 5 }, () => ({ value: 1, unit: 'fr' }));
      });
      cy.then(() => {
        metadata = [];
        mediaErrors = [];
        messages = new Subject<MessageEvent>();
        forwardMessage = event => {
          if (event.data?.type === 'vopReadyNotification' && !postSpy) {
            const target = event.source as Window;
            target.document.addEventListener('loadedmetadata', mediaEvent => {
              const media = mediaEvent.target as HTMLMediaElement;
              metadata.push({ tag: media.tagName, duration: media.duration });
            }, true);
            target.document.addEventListener('error', mediaEvent => {
              const media = mediaEvent.target as HTMLMediaElement;
              mediaErrors.push({ tag: media.tagName, source: media.getAttribute('src'), currentSrc: media.currentSrc });
            }, true);
            postSpy = Cypress.sinon.spy(target, 'postMessage');
          }
          messages.next(event);
        };
        window.addEventListener('message', forwardMessage);
        cy.spy(URL, 'revokeObjectURL').as('revokeObjectURL');
      });
    });

    afterEach(() => {
      window.removeEventListener('message', forwardMessage);
      messages.complete();
      postSpy?.restore();
      postSpy = undefined;
    });

    function starts(): Start[] {
      return (postSpy?.getCalls() ?? []).map(call => call.args[0] as Start).filter(message => message.type === 'vopStartCommand');
    }

    function setAnswer(value: string): void {
      fixture.componentInstance.responses.set({
        id: 1, test_person: 'aspect-assets', unit_id: 'UNIT-REPLAY', test_group: 'ASSETS', workspace_id: 1,
        created_at: new Date(0), booklet_id: 'ASSETS', responses: [{
          id: 'elementCodes', content: JSON.stringify([{ id: 'answer_1', status: 'VALUE_CHANGED', value }]),
          ts: 0, responseType: 'iqb-standard@1.0'
        }]
      });
    }

    function body() {
      return cy.get<HTMLIFrameElement>('iframe.unitHost').its('0.contentDocument.body').should('not.be.empty');
    }

    function answer(value: string) {
      return body().find<HTMLTextAreaElement | HTMLInputElement>(
        '[data-element-alias="answer_1"] input, [data-element-alias="answer_1"] textarea', { timeout: 15_000 }
      ).should('be.visible').and('have.value', value);
    }

    function mountUnit(failImage = false, imagesOnly = false) {
      cy.then(() => {
        if (imagesOnly) {
          unit.pages[0].sections[0].elements = unit.pages[0].sections[0].elements.filter(element => !['audio', 'video'].includes(element.type));
        }
        originalDefinition = JSON.stringify(unit);
        const create = URL.createObjectURL.bind(URL);
        cy.stub(URL, 'createObjectURL').callsFake((blob: Blob) => {
          const url = create(blob);
          if (failImage && blob.type === 'image/png') URL.revokeObjectURL(url);
          return url;
        }).as('createObjectURL');
      });
      cy.mount(AspectAssetsHost, {
        imports: [TranslateModule.forRoot()],
        providers: [
          { provide: AppService, useValue: { postMessage$: messages } },
          { provide: FileService, useValue: { getDirectDownloadLink: () => '/api/packages/' } }
        ]
      }).then(result => {
        fixture = result.fixture;
        fixture.nativeElement.style.display = 'block';
        fixture.nativeElement.style.height = '920px';
        setAnswer('answer initial');
        fixture.componentInstance.definition.set(originalDefinition);
      });
    }

    function twentyAnswers() {
      for (let index = 0; index < 20; index += 1) {
        cy.then(() => setAnswer(`answer ${index}`));
        answer(`answer ${index}`);
      }
      cy.then(() => {
        const commands = starts();
        expect(commands).to.have.length(21);
        expect(new Set(commands.map(message => message.sessionId)).size).to.equal(21);
        expect(new Set(commands.map(message => message.unitDefinition)).size).to.equal(1);
        expect(commands[0].unitDefinition).not.to.equal(originalDefinition);
      });
    }

    it('reuses direct and rich-text images for twenty answers and direct navigation, then releases them', () => {
      mountUnit(false, true);
      answer('answer initial');
      body().find<HTMLImageElement>('img[src^="blob:"]').should($images => {
        expect($images.length).to.be.at.least(2);
        [...$images].forEach(image => expect(image.naturalWidth).to.equal(1));
      });
      twentyAnswers();
      cy.get('@createObjectURL').should('have.callCount', 1);
      cy.get('@revokeObjectURL').should('not.have.been.called');
      cy.then(() => {
        const player = fixture.debugElement.query(By.directive(UnitPlayerComponent)).componentInstance as UnitPlayerComponent;
        expect(player.navigateToPage('1')).to.equal(true);
      });
      body().find('[data-element-alias="answer_2"]').should('be.visible');
      cy.then(() => {
        const player = fixture.debugElement.query(By.directive(UnitPlayerComponent)).componentInstance as UnitPlayerComponent;
        player.navigateToPage('0');
      });
      answer('answer 19');
      cy.then(() => expect(starts()).to.have.length(21));
      cy.then(() => fixture.destroy());
      cy.get('@revokeObjectURL').should('have.callCount', 1);
    });

    it('keeps cached media across twenty answers despite Aspect clearing src after successful metadata loading', () => {
      mountUnit();
      answer('answer initial');
      cy.wrap(null, { timeout: 10_000 }).should(() => {
        expect(metadata.some(event => event.tag === 'AUDIO' && event.duration > 0)).to.equal(true);
        expect(metadata.some(event => event.tag === 'VIDEO' && event.duration > 0)).to.equal(true);
        expect(mediaErrors.some(event => event.tag === 'AUDIO' && event.source === '' && event.currentSrc.startsWith('blob:'))).to.equal(true);
      });
      cy.then(() => expect(starts(), 'source cleanup must not trigger fallback').to.have.length(1));
      twentyAnswers();
      cy.get('@createObjectURL').should('have.callCount', 3);
      cy.get('@revokeObjectURL').should('not.have.been.called');
      cy.then(() => fixture.destroy());
      cy.get('@revokeObjectURL').should('have.callCount', 3);
    });

    it('falls back once after a revoked image Blob and keeps the next answer on the original definition', () => {
      mountUnit(true);
      answer('answer initial');
      body().find<HTMLImageElement>('img[src^="data:image/png"]').should($images => {
        expect($images.length).to.be.at.least(2);
        [...$images].forEach(image => expect(image.naturalWidth).to.equal(1));
      });
      cy.then(() => {
        expect(starts()).to.have.length(2);
        expect(starts()[1].unitDefinition).to.equal(originalDefinition);
        setAnswer('answer after fallback');
      });
      answer('answer after fallback');
      cy.then(() => {
        expect(starts()).to.have.length(3);
        expect(starts()[2].unitDefinition).to.equal(originalDefinition);
      });
      cy.get('@createObjectURL').should('have.callCount', 3);
    });
  });
});
