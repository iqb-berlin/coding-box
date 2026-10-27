// Run in a fresh Node process so NODE_EXTRA_CA_CERTS is read at startup.
const assert = require('node:assert/strict');
const path = require('node:path');

require('reflect-metadata');
require('ts-node').register({
  project: path.resolve(__dirname, '../../apps/backend/tsconfig.app.json'),
  transpileOnly: true
});

const axios = require('axios');
const { HttpService } = require('@nestjs/axios');
const { TestcenterService } = require('../../apps/backend/src/app/database/services/test-results/testcenter.service.ts');

async function main() {
  const http = new HttpService(axios.create({ proxy: false, family: 4, timeout: 5000 }));
  const service = new TestcenterService(null, http, null, null, null, null);
  const credentials = { username: 'tls-fixture', password: 'synthetic-password', server: '', url: process.argv[2] };
  const session = await service.authenticate(credentials);
  assert.equal(session.token, 'synthetic-token');
  const file = await service.getFile({ type: 'Unit', name: 'example.xml' }, '', 'study', session.token, credentials.url);
  assert.deepEqual(file.data, { content: '<Unit/>' });
  console.log(JSON.stringify({ authenticated: true, downloaded: true }));
}

main().catch(error => {
  console.log(JSON.stringify({ error: error.message }));
  process.exitCode = 1;
});
