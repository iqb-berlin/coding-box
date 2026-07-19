import { BadRequestException, Injectable } from '@nestjs/common';
import { VariableDetailDto } from '../../../models/unit-variable-details.dto';
import { mapCodeForExport } from '../../../utils/coding-utils';
import {
  CorrelationAccumulator,
  CorrelationStatus,
  addCorrelationPair,
  calculateCorrelation,
  createCorrelationAccumulator
} from './psychometric-statistics.util';
import { getPsychometricLogicalKey } from './psychometric-key.util';
import {
  MetadataScalarValue,
  NormalizedPsychometricExportServiceOptions,
  PsychometricAnalysis,
  PsychometricItemMapping,
  PsychometricMappedItem,
  PsychometricMetricDefinition,
  PsychometricMetricRow,
  PsychometricMetricType,
  PsychometricMissingDefinition,
  PsychometricRawResponseRow,
  PsychometricResponseSnapshot
} from './psychometric-export.types';

interface AnalysisItem extends PsychometricMappedItem {
  codeDefinitions: Map<number, PsychometricMetricDefinition>;
  categories: Map<string, PsychometricMetricDefinition>;
  scoreAccumulator: CorrelationAccumulator;
  codeAccumulators: Map<number, CorrelationAccumulator>;
  categoryAccumulators: Map<string, CorrelationAccumulator>;
  categoryLimitExceeded: boolean;
}

interface AnalysisMapping {
  items: AnalysisItem[];
  byLogicalKey: Map<string, AnalysisItem>;
}

interface ResponseValue {
  code: number | null;
  score: number | null;
}

interface DomainAggregate {
  sum: number;
  count: number;
}

interface PsychometricAnalysisEngineInput {
  options: NormalizedPsychometricExportServiceOptions;
  mapping: PsychometricItemMapping;
  missingDefinitions: PsychometricMissingDefinition[];
  snapshot: PsychometricResponseSnapshot;
}

interface ResponseAnalysisSummary {
  includedPersonIds: Set<number>;
  includedResponseCount: number;
}

export function createPsychometricScoreSummary(
  scoreRows: PsychometricMetricRow[]
): PsychometricAnalysis['summary'] {
  const sortedCaseCounts = scoreRows
    .map(row => row.n)
    .sort((left, right) => left - right);
  const middleIndex = Math.floor(sortedCaseCounts.length / 2);
  let median = 0;
  if (sortedCaseCounts.length % 2 === 1) {
    median = sortedCaseCounts[middleIndex];
  } else if (sortedCaseCounts.length > 0) {
    median =
      (sortedCaseCounts[middleIndex - 1] +
        sortedCaseCounts[middleIndex]) /
      2;
  }
  const countStatus = (status: CorrelationStatus): number => scoreRows
    .filter(row => row.status === status).length;

  return [
    { key: 'Items insgesamt', value: scoreRows.length },
    {
      key: 'Items mit n = 0',
      value: scoreRows.filter(row => row.n === 0).length
    },
    {
      key: 'Items mit 1 <= n < 30',
      value: scoreRows.filter(row => row.n >= 1 && row.n < 30).length
    },
    {
      key: 'Items mit n >= 30',
      value: scoreRows.filter(row => row.n >= 30).length
    },
    {
      key: 'Items mit berechneter Score-Trennschärfe (Status OK)',
      value: countStatus('OK')
    },
    {
      key: 'Status INSUFFICIENT_CASES',
      value: countStatus('INSUFFICIENT_CASES')
    },
    {
      key: 'Status CONSTANT_ITEM',
      value: countStatus('CONSTANT_ITEM')
    },
    {
      key: 'Status CONSTANT_DOMAIN',
      value: countStatus('CONSTANT_DOMAIN')
    },
    {
      key: 'Minimum paarweise vollständige Fälle (n)',
      value: sortedCaseCounts[0] ?? 0
    },
    {
      key: 'Median paarweise vollständige Fälle (n)',
      value: median
    },
    {
      key: 'Maximum paarweise vollständige Fälle (n)',
      value: sortedCaseCounts[sortedCaseCounts.length - 1] ?? 0
    }
  ];
}

@Injectable()
export class PsychometricAnalysisEngine {
  private readonly emptyCategoryValue = '___EMPTY___';

  async analyze(
    input: PsychometricAnalysisEngineInput
  ): Promise<PsychometricAnalysis> {
    const { options, missingDefinitions, snapshot } = input;
    const mapping = this.createAnalysisMapping(input.mapping);
    this.initializeMetricDefinitions(
      mapping.items,
      missingDefinitions,
      options.maxCategoryCount
    );

    const { includedPersonIds, includedResponseCount } =
      await this.analyzeResponses(
        options,
        mapping,
        missingDefinitions,
        snapshot
      );
    const rows = this.createMetricRows(mapping.items, options.maxCategoryCount);

    await options.checkCancellation?.();
    await options.onProgress?.(100, {
      processedRows: snapshot.totalRows * 2,
      totalRows: snapshot.totalRows * 2
    });

    return {
      rows,
      summary: [
        { key: 'Ergebnisversion', value: options.version },
        {
          key: 'Domänenbildung',
          value:
            options.domain.mode === 'workspace' ?
              'Gesamter Workspace' :
              `${options.domain.scope}: ${options.domain.entryId}`
        },
        {
          key: 'Part-Whole-Korrektur',
          value: options.partWholeCorrection
        },
        { key: 'Maximale Kategorienzahl', value: options.maxCategoryCount },
        { key: 'Zugeordnete Items', value: mapping.items.length },
        {
          key: 'Legacy-VOMD-Fallbacks',
          value: input.mapping.fallbacks.length
        },
        { key: 'Berücksichtigte Testpersonen', value: includedPersonIds.size },
        { key: 'Berücksichtigte Ergebniszeilen', value: includedResponseCount },
        {
          key: 'Ausgeschlossene Testpersonen mit Duplikaten',
          value: snapshot.duplicatePersonIds.size
        },
        {
          key: 'Hinweis Duplikate',
          value:
            'Testpersonen mit mehreren Ergebniszeilen für dieselbe Unit-Variable-Kombination wurden vollständig ausgeschlossen.'
        },
        {
          key: 'Hinweis fehlende Scores',
          value:
            'Numerische Missing-Scores wurden einbezogen; Missing-Scores mit null wurden paarweise ausgeschlossen.'
        },
        ...createPsychometricScoreSummary(
          rows.filter(row => row.type === 'SCORE')
        )
      ]
    };
  }

  private normalizeCode(
    code: number | null,
    missingDefinitions: PsychometricMissingDefinition[]
  ): number | null {
    const mir = missingDefinitions.find(missing => missing.id === 'mir');
    const mci = missingDefinitions.find(missing => missing.id === 'mci');
    return mapCodeForExport(code, {
      mirCode: mir?.code,
      mciCode: mci?.code
    });
  }

  private normalizeScore(
    value: ResponseValue,
    normalizedCode: number | null,
    missingDefinitions: PsychometricMissingDefinition[]
  ): number | null {
    const missing = missingDefinitions.find(
      definition => definition.code === normalizedCode
    );
    if (missing) {
      return missing.score;
    }
    return value.score;
  }

  private parseCategories(
    rawValue: string | null,
    variable: VariableDetailDto
  ): PsychometricMetricDefinition[] {
    if (rawValue === null) {
      return [];
    }
    const value = String(rawValue).trim();
    if (!value) {
      if (!this.acceptsEmptyCategory(variable)) {
        return [];
      }
      const emptyDefinition = (variable.values || []).find(
        definition => String(definition.value ?? '').trim() === ''
      );
      return [
        {
          value: this.emptyCategoryValue,
          label: emptyDefinition?.label || this.emptyCategoryValue,
          source: 'UNIT_DEFINITION'
        }
      ];
    }
    if (value.toLowerCase() === 'null') {
      return [];
    }

    let parsed: unknown = value;
    try {
      parsed = JSON.parse(value);
    } catch {
      // Plain text values are valid categories.
    }

    const categoryValues: string[] = [];
    if (Array.isArray(parsed)) {
      if (
        variable.multiple === true &&
        parsed.every(item => typeof item === 'boolean')
      ) {
        parsed.forEach((selected, index) => {
          if (selected) {
            categoryValues.push(
              variable.values?.[index]?.value || String(index + 1)
            );
          }
        });
      } else {
        parsed.forEach(item => {
          if (item !== null && item !== undefined) {
            categoryValues.push(
              typeof item === 'object' ? JSON.stringify(item) : String(item)
            );
          }
        });
      }
    } else if (parsed !== null && parsed !== undefined) {
      categoryValues.push(
        typeof parsed === 'object' ? JSON.stringify(parsed) : String(parsed)
      );
    }

    return Array.from(new Set(categoryValues.map(item => item.trim())))
      .filter(Boolean)
      .map(category => {
        const definitionValue =
          category === this.emptyCategoryValue ? '' : category;
        const valueDefinition = (variable.values || []).find(
          definition => String(definition.value) === definitionValue
        );
        const codeDefinition = (variable.codes || []).find(
          definition => String(definition.id) === category
        );
        return {
          value: category,
          label: valueDefinition?.label || codeDefinition?.label || category,
          score: codeDefinition?.score,
          source: this.getCategorySource(valueDefinition, codeDefinition)
        };
      });
  }

  private getDomainScore(
    aggregate: DomainAggregate | undefined,
    itemScore: number | null,
    partWholeCorrection: boolean
  ): number | null {
    if (!aggregate || aggregate.count === 0) {
      return null;
    }

    const shouldSubtract = partWholeCorrection && itemScore !== null;
    const count = aggregate.count - (shouldSubtract ? 1 : 0);
    if (count <= 0) {
      return null;
    }
    const sum = aggregate.sum - (shouldSubtract ? itemScore : 0);
    return sum / count;
  }

  private createAnalysisMapping(
    mapping: PsychometricItemMapping
  ): AnalysisMapping {
    const items = mapping.items.map<AnalysisItem>(item => ({
      ...item,
      codeDefinitions: new Map(),
      categories: new Map(),
      scoreAccumulator: createCorrelationAccumulator(),
      codeAccumulators: new Map(),
      categoryAccumulators: new Map(),
      categoryLimitExceeded: false
    }));
    const itemsByKey = new Map(items.map(item => [item.key, item]));
    const byLogicalKey = new Map<string, AnalysisItem>();
    mapping.byLogicalKey.forEach((item, logicalKey) => {
      const analysisItem = itemsByKey.get(item.key);
      if (analysisItem) {
        byLogicalKey.set(logicalKey, analysisItem);
      }
    });
    return { items, byLogicalKey };
  }

  private async analyzeResponses(
    options: NormalizedPsychometricExportServiceOptions,
    mapping: AnalysisMapping,
    missingDefinitions: PsychometricMissingDefinition[],
    snapshot: PsychometricResponseSnapshot
  ): Promise<ResponseAnalysisSummary> {
    const personDomainScores = new Map<string, DomainAggregate>();
    const includedPersonIds = new Set<number>();
    let includedResponseCount = 0;

    await snapshot.forEachBatch(async (rows, processedRows) => {
      rows.forEach(row => {
        const personId = Number(row.personId);
        if (snapshot.duplicatePersonIds.has(personId)) {
          return;
        }

        const item = this.getMappedItem(mapping, row);
        if (!item) {
          return;
        }
        const value = this.getResponseValue(row);
        const normalizedCode = this.normalizeCode(
          value.code,
          missingDefinitions
        );
        const normalizedScore = this.normalizeScore(
          value,
          normalizedCode,
          missingDefinitions
        );
        const domain = this.requireDomain(item);
        const domainKey = this.getPersonDomainKey(personId, domain.id);

        includedPersonIds.add(personId);
        includedResponseCount += 1;
        if (normalizedScore !== null) {
          const aggregate = personDomainScores.get(domainKey) || {
            sum: 0,
            count: 0
          };
          aggregate.sum += normalizedScore;
          aggregate.count += 1;
          personDomainScores.set(domainKey, aggregate);
        }

        if (
          normalizedCode !== null &&
          !item.codeDefinitions.has(normalizedCode)
        ) {
          item.codeDefinitions.set(normalizedCode, {
            value: String(normalizedCode),
            label: String(normalizedCode),
            source: 'OBSERVED'
          });
        }

        if (
          this.isCategoryEligible(normalizedCode) &&
          !item.categoryLimitExceeded
        ) {
          this.parseCategories(row.value, item.variable).forEach(category => {
            this.addCategoryDefinition(
              item,
              category,
              options.maxCategoryCount
            );
          });
        }
      });
      await options.onProgress?.(
        10 + Math.round((processedRows / Math.max(1, snapshot.totalRows)) * 35),
        {
          processedRows,
          totalRows: snapshot.totalRows * 2
        }
      );
    }, options.checkCancellation);

    mapping.items.forEach(item => {
      item.codeDefinitions.forEach((_definition, code) => {
        item.codeAccumulators.set(code, createCorrelationAccumulator());
      });
      if (!item.categoryLimitExceeded) {
        item.categories.forEach((_definition, category) => {
          item.categoryAccumulators.set(
            category,
            createCorrelationAccumulator()
          );
        });
      }
    });

    await snapshot.forEachBatch(async (rows, processedRows) => {
      rows.forEach(row => {
        const personId = Number(row.personId);
        if (snapshot.duplicatePersonIds.has(personId)) {
          return;
        }

        const item = this.getMappedItem(mapping, row);
        if (!item) {
          return;
        }
        const value = this.getResponseValue(row);
        const normalizedCode = this.normalizeCode(
          value.code,
          missingDefinitions
        );
        const normalizedScore = this.normalizeScore(
          value,
          normalizedCode,
          missingDefinitions
        );
        const domain = this.requireDomain(item);
        const aggregate = personDomainScores.get(
          this.getPersonDomainKey(personId, domain.id)
        );
        const domainScore = this.getDomainScore(
          aggregate,
          normalizedScore,
          options.partWholeCorrection
        );
        if (domainScore === null) {
          return;
        }

        if (normalizedScore !== null) {
          addCorrelationPair(
            item.scoreAccumulator,
            normalizedScore,
            domainScore
          );
        }

        if (normalizedCode !== null) {
          item.codeAccumulators.forEach((accumulator, code) => {
            addCorrelationPair(
              accumulator,
              normalizedCode === code ? 1 : 0,
              domainScore
            );
          });
        }

        if (
          !item.categoryLimitExceeded &&
          this.isCategoryEligible(normalizedCode)
        ) {
          const observedCategories = new Set(
            this.parseCategories(row.value, item.variable).map(
              category => category.value
            )
          );
          item.categoryAccumulators.forEach((accumulator, category) => {
            addCorrelationPair(
              accumulator,
              observedCategories.has(category) ? 1 : 0,
              domainScore
            );
          });
        }
      });
      await options.onProgress?.(
        50 + Math.round((processedRows / Math.max(1, snapshot.totalRows)) * 40),
        {
          processedRows: snapshot.totalRows + processedRows,
          totalRows: snapshot.totalRows * 2
        }
      );
    }, options.checkCancellation);

    return {
      includedPersonIds,
      includedResponseCount
    };
  }

  private initializeMetricDefinitions(
    items: AnalysisItem[],
    missingDefinitions: PsychometricMissingDefinition[],
    maxCategoryCount: number
  ): void {
    items.forEach(item => {
      missingDefinitions.forEach(missing => {
        item.codeDefinitions.set(missing.code, {
          value: String(missing.code),
          label: missing.label,
          score: missing.score === null ? undefined : missing.score,
          source: 'MISSING_PROFILE'
        });
      });
      (item.variable.codes || []).forEach(code => {
        const numericCode = Number(code.id);
        if (!Number.isFinite(numericCode)) {
          return;
        }
        if (!item.codeDefinitions.has(numericCode)) {
          item.codeDefinitions.set(numericCode, {
            value: String(code.id),
            label: code.label || String(code.id),
            score: code.score,
            source: 'VOCS'
          });
        }
      });
      (item.variable.values || []).forEach(value => {
        const rawCategoryValue = String(value.value ?? '').trim();
        const categoryValue =
          rawCategoryValue ||
          (this.acceptsEmptyCategory(item.variable) ?
            this.emptyCategoryValue :
            '');
        if (categoryValue) {
          this.addCategoryDefinition(
            item,
            {
              value: categoryValue,
              label: value.label || categoryValue,
              source: 'UNIT_DEFINITION'
            },
            maxCategoryCount
          );
        }
      });
      (item.variable.valuePositionLabels || []).forEach((label, index) => {
        const categoryValue = String(
          item.variable.values?.[index]?.value ?? index + 1
        ).trim();
        if (categoryValue) {
          this.addCategoryDefinition(
            item,
            {
              value: categoryValue,
              label: label || categoryValue,
              source: 'UNIT_DEFINITION'
            },
            maxCategoryCount
          );
        }
      });
    });
  }

  private addCategoryDefinition(
    item: AnalysisItem,
    definition: PsychometricMetricDefinition,
    maxCategoryCount: number
  ): void {
    if (item.categoryLimitExceeded || item.categories.has(definition.value)) {
      return;
    }
    if (item.categories.size >= maxCategoryCount) {
      item.categoryLimitExceeded = true;
      return;
    }
    item.categories.set(definition.value, definition);
  }

  private acceptsEmptyCategory(variable: VariableDetailDto): boolean {
    return variable.processing?.includes('TAKE_EMPTY_AS_VALID') === true;
  }

  private getMappedItem(
    mapping: AnalysisMapping,
    row: PsychometricRawResponseRow
  ): AnalysisItem | undefined {
    return mapping.byLogicalKey.get(
      getPsychometricLogicalKey(row.unitName, row.variableId)
    );
  }

  private getResponseValue(row: PsychometricRawResponseRow): ResponseValue {
    return {
      code: this.toNullableNumber(row.code),
      score: this.toNullableNumber(row.score)
    };
  }

  private toNullableNumber(value: unknown): number | null {
    if (value === null || value === undefined || value === '') {
      return null;
    }
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : null;
  }

  private isCategoryEligible(code: number | null): boolean {
    return code !== null && code >= 0;
  }

  private getCategorySource(
    valueDefinition: unknown,
    codeDefinition: unknown
  ): PsychometricMetricDefinition['source'] {
    if (valueDefinition) {
      return 'UNIT_DEFINITION';
    }
    if (codeDefinition) {
      return 'VOCS';
    }
    return 'OBSERVED';
  }

  private createMetricRows(
    items: AnalysisItem[],
    maxCategoryCount: number
  ): PsychometricMetricRow[] {
    const rows: PsychometricMetricRow[] = [];
    items.forEach(item => {
      rows.push(
        this.toMetricRow(item, 'SCORE', item.scoreAccumulator, undefined)
      );
      item.codeDefinitions.forEach((definition, code) => {
        rows.push(
          this.toMetricRow(
            item,
            'CODE',
            item.codeAccumulators.get(code),
            definition
          )
        );
      });

      if (item.categoryLimitExceeded) {
        const domain = this.requireDomain(item);
        rows.push({
          type: 'CATEGORY',
          domain: domain.id,
          domainLabel: domain.label,
          unit: item.unitName,
          item: item.itemId,
          variable: item.variableId,
          itemLabel: item.itemLabel,
          code: '',
          category: '',
          label: '',
          score: '',
          source: '',
          n: 0,
          positiveN: '',
          positiveShare: '',
          correlation: '',
          status: 'TOO_MANY_CATEGORIES',
          note: `Mehr als ${maxCategoryCount} Kategorien überschreiten das konfigurierte Limit.`
        });
      } else {
        item.categories.forEach((definition, category) => {
          rows.push(
            this.toMetricRow(
              item,
              'CATEGORY',
              item.categoryAccumulators.get(category),
              definition
            )
          );
        });
      }
    });

    return rows.sort(
      (left, right) => left.type.localeCompare(right.type) ||
        left.domainLabel.localeCompare(right.domainLabel, 'de', {
          numeric: true,
          sensitivity: 'base'
        }) ||
        left.unit.localeCompare(right.unit, 'de', {
          numeric: true,
          sensitivity: 'base'
        }) ||
        left.variable.localeCompare(right.variable, 'de', {
          numeric: true,
          sensitivity: 'base'
        }) ||
        left.code.localeCompare(right.code, 'de', { numeric: true }) ||
        left.category.localeCompare(right.category, 'de', { numeric: true })
    );
  }

  private toMetricRow(
    item: AnalysisItem,
    type: PsychometricMetricType,
    accumulator: CorrelationAccumulator | undefined,
    definition: PsychometricMetricDefinition | undefined
  ): PsychometricMetricRow {
    const domain = this.requireDomain(item);
    const safeAccumulator = accumulator || createCorrelationAccumulator();
    const result = calculateCorrelation(safeAccumulator);
    return {
      type,
      domain: domain.id,
      domainLabel: domain.label,
      unit: item.unitName,
      item: item.itemId,
      variable: item.variableId,
      itemLabel: item.itemLabel,
      code: type === 'CODE' ? definition?.value || '' : '',
      category: type === 'CATEGORY' ? definition?.value || '' : '',
      label: definition?.label || '',
      score: definition?.score ?? '',
      source: definition?.source || '',
      n: safeAccumulator.n,
      positiveN: type === 'SCORE' ? '' : safeAccumulator.positiveCount,
      positiveShare:
        type === 'SCORE' || safeAccumulator.n === 0 ?
          '' :
          safeAccumulator.positiveCount / safeAccumulator.n,
      correlation: result.correlation ?? '',
      status: result.status,
      note: this.getCorrelationNote(result.status)
    };
  }

  private getCorrelationNote(status: CorrelationStatus): string {
    switch (status) {
      case 'INSUFFICIENT_CASES':
        return 'Weniger als zwei paarweise vollständige Fälle.';
      case 'CONSTANT_ITEM':
        return 'Itemwert bzw. Dummyvariable ist konstant.';
      case 'CONSTANT_DOMAIN':
        return 'Domänenscore ist konstant.';
      default:
        return '';
    }
  }

  private requireDomain(item: AnalysisItem): MetadataScalarValue {
    if (!item.domain) {
      throw new BadRequestException(
        `Keine Domäne für ${item.unitName}/${item.variableId}`
      );
    }
    return item.domain;
  }

  private getPersonDomainKey(personId: number, domainId: string): string {
    return `${personId}\u001F${domainId}`;
  }
}
