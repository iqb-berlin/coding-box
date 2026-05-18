import {
  getCodingFreshnessAttentionTitle,
  getCodingFreshnessAutoCodingButtonLabel,
  getCodingFreshnessAutoCodingWarnings,
  getCodingFreshnessChipLabel,
  getCodingFreshnessManualReviewGuidanceText,
  getCodingFreshnessManualReviewWarnings,
  getCodingFreshnessSummaryText,
  isCodingFreshnessOpenWarning
} from './coding-freshness-text.util';

describe('coding freshness text utils', () => {
  it('explains a single auto-coding refresh with tasks and response values', () => {
    expect(getCodingFreshnessSummaryText([
      {
        version: 'v1',
        state: 'PENDING',
        unitCount: 704,
        affectedResponseCount: 5397
      }
    ])).toBe(
      'Auto-Coding 1 muss für 704 Aufgabenbearbeitungen ausgeführt werden. ' +
      'Das betrifft 5397 Antwortwerte.'
    );
  });

  it('does not double count the same imported responses across two auto-coding runs', () => {
    expect(getCodingFreshnessSummaryText([
      {
        version: 'v1',
        state: 'PENDING',
        unitCount: 671,
        affectedResponseCount: 5098
      },
      {
        version: 'v3',
        state: 'PENDING',
        unitCount: 671,
        affectedResponseCount: 5098
      }
    ])).toBe(
      'Je betroffenem Auto-Coding-Lauf sind 5098 Antwortwerte in 671 Aufgabenbearbeitungen zu bearbeiten. ' +
      'Auto-Coding 1 und Auto-Coding 2 müssen ausgeführt werden.'
    );
  });

  it('uses a generic text when multiple coding states are affected', () => {
    expect(getCodingFreshnessSummaryText([
      {
        version: 'v1',
        state: 'PENDING',
        unitCount: 2,
        affectedResponseCount: 6
      },
      {
        version: 'v2',
        state: 'MANUAL_REVIEW_REQUIRED',
        unitCount: 1,
        affectedResponseCount: 3
      }
    ])).toBe(
      'Es sind mehrere Kodierschritte offen. ' +
      'Die Chips zeigen je Kodierschritt, wie viele Aufgabenbearbeitungen betroffen sind.'
    );
  });

  it('keeps the auto-coding action specific when one auto-coding version has multiple affected states', () => {
    expect(getCodingFreshnessSummaryText([
      {
        version: 'v1',
        state: 'PENDING',
        unitCount: 2,
        affectedResponseCount: 6
      },
      {
        version: 'v1',
        state: 'STALE',
        unitCount: 1,
        affectedResponseCount: 3
      }
    ])).toBe(
      'Auto-Coding 1 muss für 3 Aufgabenbearbeitungen ausgeführt oder aktualisiert werden. ' +
      'Das betrifft 9 Antwortwerte.'
    );
  });

  it('returns a neutral text when no coding freshness warnings remain', () => {
    expect(getCodingFreshnessSummaryText([])).toBe(
      'Für die aktuell berücksichtigten Testergebnisse gibt es keine offenen Aktualisierungshinweise.'
    );
  });

  it('formats chip and action labels with task wording', () => {
    const item = {
      version: 'v1' as const,
      state: 'PENDING' as const,
      unitCount: 1,
      affectedResponseCount: 4
    };

    expect(getCodingFreshnessChipLabel(item)).toBe(
      'Auto-Coding 1: 1 Aufgabenbearbeitung kodieren'
    );
    expect(getCodingFreshnessAutoCodingButtonLabel([item], 'v1')).toBe(
      'Auto-Coding 1 für 1 Aufgabenbearbeitung starten'
    );
  });

  it('uses refresh wording for stale auto-coding work', () => {
    const item = {
      version: 'v1' as const,
      state: 'STALE' as const,
      unitCount: 2,
      affectedResponseCount: 4
    };

    expect(getCodingFreshnessSummaryText([item])).toBe(
      'Auto-Coding 1 muss für 2 Aufgabenbearbeitungen aktualisiert werden. ' +
      'Das betrifft 4 Antwortwerte.'
    );
    expect(getCodingFreshnessAutoCodingButtonLabel([item], 'v1')).toBe(
      'Auto-Coding 1 für 2 Aufgabenbearbeitungen aktualisieren'
    );
  });

  it('summarizes the attention title by affected coding area', () => {
    expect(getCodingFreshnessAttentionTitle([
      {
        version: 'v1',
        state: 'PENDING',
        unitCount: 1,
        affectedResponseCount: 2
      }
    ])).toBe('Auto-Coding aktualisieren');

    expect(getCodingFreshnessAttentionTitle([
      {
        version: 'v2',
        state: 'MANUAL_REVIEW_REQUIRED',
        unitCount: 1,
        affectedResponseCount: 2
      }
    ])).toBe('Manuelle Kodierung prüfen');
  });

  it('separates auto-coding warnings from manual review warnings', () => {
    const items = [
      {
        version: 'v1' as const,
        state: 'PENDING' as const,
        unitCount: 1,
        affectedResponseCount: 2
      },
      {
        version: 'v2' as const,
        state: 'MANUAL_REVIEW_REQUIRED' as const,
        unitCount: 1,
        affectedResponseCount: 2
      }
    ];

    expect(getCodingFreshnessAutoCodingWarnings(items)).toEqual([items[0]]);
    expect(getCodingFreshnessManualReviewWarnings(items)).toEqual([items[1]]);
  });

  it('ignores current and empty manual coding freshness rows', () => {
    const items = [
      {
        version: 'v2' as const,
        state: 'CURRENT' as const,
        unitCount: 1,
        affectedResponseCount: 2
      },
      {
        version: 'v2' as const,
        state: 'MANUAL_REVIEW_REQUIRED' as const,
        unitCount: 0,
        affectedResponseCount: 2
      },
      {
        version: 'v2' as const,
        state: 'MANUAL_REVIEW_REQUIRED' as const,
        unitCount: 1,
        affectedResponseCount: 2
      }
    ];

    expect(getCodingFreshnessManualReviewWarnings(items)).toEqual([items[2]]);
  });

  it('ignores empty auto-coding freshness rows', () => {
    const item = {
      version: 'v1' as const,
      state: 'PENDING' as const,
      unitCount: 0,
      affectedResponseCount: 2
    };

    expect(isCodingFreshnessOpenWarning(item)).toBe(false);
    expect(getCodingFreshnessAutoCodingWarnings([item])).toEqual([]);
    expect(getCodingFreshnessSummaryText([item])).toBe(
      'Für die aktuell berücksichtigten Testergebnisse gibt es keine offenen Aktualisierungshinweise.'
    );
  });

  it('gives direct guidance for manual review only', () => {
    expect(getCodingFreshnessManualReviewGuidanceText([
      {
        version: 'v2',
        state: 'MANUAL_REVIEW_REQUIRED',
        unitCount: 1,
        affectedResponseCount: 10
      }
    ])).toBe(
      'Öffnen Sie die manuelle Prüfung und wenden Sie abgeschlossene Job-Ergebnisse erneut an ' +
      'oder kodieren Sie offene Fälle neu.'
    );
  });

  it('keeps the workflow order when auto-coding and manual review are both open', () => {
    expect(getCodingFreshnessManualReviewGuidanceText([
      {
        version: 'v1',
        state: 'STALE',
        unitCount: 1,
        affectedResponseCount: 4
      },
      {
        version: 'v2',
        state: 'MANUAL_REVIEW_REQUIRED',
        unitCount: 1,
        affectedResponseCount: 4
      }
    ])).toBe(
      'Aktualisieren Sie zuerst die offenen Auto-Coding-Schritte. ' +
      'Prüfen Sie danach die manuelle Kodierung.'
    );
  });
});
