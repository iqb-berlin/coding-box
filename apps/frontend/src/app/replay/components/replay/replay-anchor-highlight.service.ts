import { DestroyRef, inject, Injectable } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import type { UnitsReplayUnit } from '../../services/units-replay.service';
import {
  highlightAspectSectionWithAnchor,
  highlightBundleVariableMarkers,
  scrollToElementByAlias
} from '../../utils/dom-utils';
import type { UnitPlayerComponent } from '../unit-player/unit-player.component';

interface ReplayHighlightContext {
  player: () => UnitPlayerComponent | undefined;
  anchor: () => string | undefined;
  page: () => string | undefined;
  currentUnit: () => UnitsReplayUnit | undefined;
}

@Injectable()
export class ReplayAnchorHighlightService {
  private readonly translate = inject(TranslateService);
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private highlightRun = 0;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.cancel());
  }

  show(context: ReplayHighlightContext): void {
    if (!context.anchor()) return;

    this.cancel();
    this.highlight(context, this.highlightRun, 1);
  }

  cancel(): void {
    this.highlightRun += 1;
    clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
  }

  private highlight(context: ReplayHighlightContext, run: number, attempt: number): void {
    this.retryTimer = undefined;
    const anchor = context.anchor();
    if (run !== this.highlightRun || !anchor) return;

    const iframe = context.player()?.hostingIframe()?.nativeElement;
    if (iframe) {
      const highlighted = highlightAspectSectionWithAnchor(iframe, anchor);
      highlightBundleVariableMarkers(iframe, this.bundleMarkers(context.currentUnit(), anchor, context.page()));
      if (highlighted.length > 0) {
        scrollToElementByAlias(iframe, anchor);
        return;
      }
    }

    if (attempt < 40) {
      this.retryTimer = setTimeout(() => this.highlight(context, run, attempt + 1), 100);
    }
  }

  private bundleMarkers(unit: UnitsReplayUnit | undefined, anchor: string, page: string | undefined) {
    if (!unit?.bundleContext || !page) return [];

    const label = this.translate.instant('code-selector.bundle-auto-coded-label');
    const tooltip = this.translate.instant('code-selector.bundle-auto-coded-tooltip');
    return unit.bundleContext.variables.filter(variable => (
      variable.status === 'auto-coded' &&
      variable.unitName === unit.name &&
      variable.variableAnchor &&
      variable.variableAnchor !== anchor &&
      variable.variablePage === page
    )).map(variable => ({ anchor: variable.variableAnchor, label, tooltip }));
  }
}
