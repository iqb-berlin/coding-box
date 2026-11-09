import { testcenterChoices } from './test-center-instance-selection';

describe('Testcenter selection follows current approvals', () => {
  it('does not recreate revoked IQB choices and uses the administrator name', () => {
    expect(testcenterChoices([])).toEqual([]);
    expect(testcenterChoices([{ label: 'Renamed study', baseUrl: 'https://iqb-testcenter1.de', source: 'standard' }]))
      .toEqual([{ id: 1, label: 'Renamed study' }]);
  });
});
