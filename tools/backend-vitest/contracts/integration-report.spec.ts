import { describe, it, expect } from 'vitest';
import { normalizeResults } from '../integration.mjs';
import { assertIntegrationResults } from '../../../scripts/qa/run-backend-integration.mjs';

const report = (fullName: string, status: string, name = 'double-coding-kappa-query.postgres.spec.ts') => ({
  success: true, numPassedTests: 1, numPendingTests: status === 'passed' ? 0 : 1, numTodoTests: 0,
  numPendingTestSuites: 0, testResults: [{ name, assertionResults: [{ fullName, status }] }]
});
describe('unchanged integration gate with native Vitest JSON', () => {
  it('accepts only the exact optional benchmark skip and retains the raw report', () => {
    const raw = report('Kappa SQL filters against PostgreSQL and the complete Liquibase schema measures the former and filtered retrieval on identical synthetic data', 'skipped');
    expect(() => assertIntegrationResults(normalizeResults(raw))).not.toThrow();
    expect(raw.testResults[0].assertionResults[0].status).toBe('skipped');
  });
  it('rejects a skipped mandatory assertion and failed or empty results', () => {
    expect(() => assertIntegrationResults(normalizeResults(report('mandatory', 'skipped', 'real.postgres.spec.ts')))).toThrow();
    expect(() => assertIntegrationResults({ ...normalizeResults(report('mandatory', 'passed')), success: false })).toThrow();
    expect(() => assertIntegrationResults({ ...normalizeResults(report('mandatory', 'passed')), testResults: [] })).toThrow();
  });
});
