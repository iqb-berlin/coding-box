import {
  getCodingFreshnessAutoCodingButtonLabel,
  getCodingFreshnessAutoCodingWarnings,
  getCodingFreshnessChipLabel,
  getCodingFreshnessManualReviewGuidanceText,
  getCodingFreshnessManualReviewWarnings,
  getCodingFreshnessSummaryText
} from './coding-freshness-text.util';

describe('coding freshness text utils', () => {
  it('explains a single auto-coding refresh with task results and responses', () => {
    expect(getCodingFreshnessSummaryText([
      {
        version: 'v1',
        state: 'PENDING',
        unitCount: 704,
        affectedResponseCount: 5397
      }
    ])).toBe(
      'Für 704 Aufgaben-Ergebnisse muss Auto-Coding 1 ausgeführt werden. ' +
      'Das betrifft 5397 einzelne Antworten.'
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
      'Für 3 Aufgaben-Ergebnisse muss die Kodierung geprüft oder aktualisiert werden. ' +
      'Das betrifft 9 einzelne Antworten.'
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
      'Für 3 Aufgaben-Ergebnisse muss Auto-Coding 1 ausgeführt oder aktualisiert werden. ' +
      'Das betrifft 9 einzelne Antworten.'
    );
  });

  it('returns a neutral text when no coding freshness warnings remain', () => {
    expect(getCodingFreshnessSummaryText([])).toBe(
      'Für die aktuell berücksichtigten Testergebnisse gibt es keine offenen Aktualisierungshinweise.'
    );
  });

  it('formats chip and action labels with task result wording', () => {
    const item = {
      version: 'v1' as const,
      state: 'PENDING' as const,
      unitCount: 1,
      affectedResponseCount: 4
    };

    expect(getCodingFreshnessChipLabel(item)).toBe(
      'Auto-Coding 1: neu zu kodieren (1 Aufgaben-Ergebnis)'
    );
    expect(getCodingFreshnessAutoCodingButtonLabel([item], 'v1')).toBe(
      '1 Aufgaben-Ergebnis mit Auto-Coding 1 kodieren'
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
      'Für 2 Aufgaben-Ergebnisse muss Auto-Coding 1 erneut ausgeführt werden. ' +
      'Das betrifft 4 einzelne Antworten.'
    );
    expect(getCodingFreshnessAutoCodingButtonLabel([item], 'v1')).toBe(
      '2 Aufgaben-Ergebnisse mit Auto-Coding 1 neu kodieren'
    );
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
