// Read an explicitly selected test fixture from a real Testcenter. Never write provider data or credentials to disk.
const assert = require('node:assert/strict');
const path = require('node:path');
require('reflect-metadata');
require('ts-node').register({ project: path.resolve(__dirname, '../../apps/backend/tsconfig.app.json'), transpileOnly: true });
const axios = require('axios');
const { HttpService } = require('@nestjs/axios');
const { resolveTestcenterBaseUrl } = require('../../apps/backend/src/app/database/services/test-results/testcenter-target.ts');
const { Logger } = require('@nestjs/common');
const { TestcenterService } = require('../../apps/backend/src/app/database/services/test-results/testcenter.service.ts');
const { PersonService } = require('../../apps/backend/src/app/database/services/test-results/person.service.ts');

const required = name => {
  const value = process.env[name];
  assert.ok(value, `Missing ${name}`);
  return value;
};

async function main() {
  const url = required('TESTCENTER_LIVE_URL').replace(/\/+$/, '');
  const username = required('TESTCENTER_LIVE_USERNAME');
  const password = required('TESTCENTER_LIVE_PASSWORD');
  const workspace = required('TESTCENTER_LIVE_WORKSPACE');
  const group = required('TESTCENTER_LIVE_GROUP');
  assert.match(workspace, /^[1-9]\d*$/, 'TESTCENTER_LIVE_WORKSPACE must be a positive numeric workspace ID');
  // Row processing logs can include fixture identifiers. The report contains counts only.
  Logger.overrideLogger(false);
  const options = { timeout: 30000, maxRedirects: 0, maxContentLength: 16 * 1024 * 1024, maxBodyLength: 64 * 1024, proxy: false };
  const http = new HttpService(axios.create(options));
  const persons = new PersonService({
    getWorkspaceGroups: async () => [], getGroupsWithBookletLogs: async () => new Map()
  }, null);
  const approvedTarget = { resolve: async (server, target) => resolveTestcenterBaseUrl(server, target, '', [url]) };
  const service = new TestcenterService(persons, http, null, null, null, null, undefined, undefined, undefined, approvedTarget);
  const session = await service.authenticate({ username, password, server: '', url });
  assert.ok(typeof session.token === 'string' && session.token, 'Expected an authenticated Testcenter session');
  assert.ok(session.claims?.workspaceAdmin?.some(entry => String(entry.id) === workspace), 'The test account needs access to the fixture workspace');
  const headers = { Authtoken: session.token };
  const { data: version } = await http.axiosRef.get(`${url}/api/version`, { maxContentLength: 4096 });
  const groups = await service.getTestgroups('1', workspace, '', url, session.token);
  assert.ok(groups.some(entry => entry.groupName === group), 'The selected fixture group must exist');
  const base = `${url}/api/workspace/${workspace}`;
  const { data: responses } = await http.axiosRef.get(`${base}/report/response`, { headers, params: { dataIds: group } });
  const { data: logs } = await http.axiosRef.get(`${base}/report/log`, { headers, params: { dataIds: group } });
  const { data: files } = await http.axiosRef.get(`${base}/files`, { headers });
  assert.ok(Array.isArray(responses) && responses.length, 'The fixture must have saved responses');
  assert.ok(Array.isArray(logs) && logs.length, 'The fixture must have saved logs');
  const file = Object.values(files).flat().find(entry => entry?.type === 'Unit' && entry.name);
  assert.ok(file, 'The fixture workspace must contain a Unit file');
  const download = await service.getFile(file, '', workspace, session.token, url);
  assert.ok(download.data && JSON.stringify(download.data).length, 'Expected a non-empty file download');
  const issues = [];
  const people = await persons.createPersonList(responses, 1);
  for (let index = 0; index < people.length; index++) {
    const person = await persons.assignBookletsToPerson(people[index], responses, issues);
    people[index] = await persons.assignUnitsToBookletAndPerson(person, responses, issues);
  }
  const logPeople = await persons.createPersonList(logs, 1);
  for (let index = 0; index < logPeople.length; index++) {
    const personLogs = persons.filterLogRowsForPerson(logs, logPeople[index]);
    let person = persons.assignBookletLogsToPerson(logPeople[index], personLogs, issues);
    person = persons.ensureBookletsForUnitLogs(person, personLogs);
    person.booklets = person.booklets.map(booklet => persons.assignUnitLogsToBooklet(booklet, personLogs, issues));
    logPeople[index] = person;
  }
  const units = people.flatMap(person => person.booklets.flatMap(booklet => booklet.units));
  const parsedResponses = units.flatMap(unit => unit.subforms.flatMap(subform => subform.responses));
  assert.ok(parsedResponses.length, 'The Kodierbox parser must retain fixture responses');
  const parsedLogs = logPeople.reduce((total, person) => total + person.booklets.reduce((count, booklet) =>
    count + booklet.logs.length + booklet.sessions.length + booklet.units.reduce((sum, unit) => sum + unit.logs.length, 0), 0), 0);
  assert.ok(parsedLogs, 'The Kodierbox parser must retain fixture logs');
  assert.equal(issues.filter(issue => issue.level === 'error').length, 0, 'No parser errors are permitted');
  console.log(JSON.stringify({
    version: version.version, authenticated: true, groupFound: true, fileDownloaded: true,
    responseRows: responses.length, logRows: logs.length, parsedResponses: parsedResponses.length, parsedLogs,
    parserWarnings: issues.filter(issue => issue.level === 'warning').length,
    persistedToCodingBox: false
  }));
}

main().catch(error => {
  // Never print Axios errors, provider bodies, challenge salts, tokens or fixture rows.
  console.error(error?.code === 'ERR_ASSERTION' ? error.message : 'Live Testcenter verification failed; inspect the approved test instance and configuration.');
  process.exitCode = 1;
});
