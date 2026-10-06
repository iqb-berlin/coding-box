import { spawnSync } from 'child_process';
import FormData = require('form-data');

// Keep parser failures in a child process: a vulnerable Multer version throws
// from a stream event, outside Nest's request error handling.
const uploadProbe = `
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { FilesInterceptor } = require(process.argv[1]);
const scenario = JSON.parse(process.argv[2]);
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'multipart-regression-'));
const Interceptor = FilesInterceptor('files', 10, scenario.disk ? { dest: directory } : {});
const interceptor = new Interceptor();
const server = http.createServer((req, res) => {
  const context = { switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }) };
  interceptor.intercept(context, { handle: () => null }).then(() => {
    res.end(JSON.stringify({
      body: req.body,
      files: req.files.map(file => ({
        name: file.originalname,
        data: (file.buffer || fs.readFileSync(file.path)).toString('utf8')
      }))
    }));
  }).catch(() => { res.statusCode = 400; res.end('{}'); });
});

process.on('uncaughtException', error => {
  console.error(error.message);
  server.close();
  fs.rmSync(directory, { recursive: true, force: true });
  process.exit(2);
});
server.listen(0, '127.0.0.1', () => {
  const boundary = 'upload-regression';
  const parts = scenario.fields.map(([name, value]) =>
    '--' + boundary + '\\r\\nContent-Disposition: form-data; name="' + name + '"\\r\\n\\r\\n' + value + '\\r\\n');
  parts.push('--' + boundary + '\\r\\nContent-Disposition: form-data; name="files"; filename="unit.xml"\\r\\nContent-Type: text/xml\\r\\n\\r\\n<unit>ä</unit>\\r\\n');
  parts.push('--' + boundary + '--\\r\\n');
  const payload = Buffer.from(parts.join(''));
  const request = http.request({ hostname: '127.0.0.1', port: server.address().port, method: 'POST',
    headers: { 'content-type': 'multipart/form-data; boundary=' + boundary, 'content-length': payload.length }
  }, response => {
    let body = '';
    response.setEncoding('utf8');
    response.on('data', chunk => { body += chunk; });
    response.on('end', () => {
      console.log(JSON.stringify({ status: response.statusCode, result: JSON.parse(body) }));
      server.close(() => {
        fs.rmSync(directory, { recursive: true, force: true });
      });
    });
  });
  request.on('error', error => { console.error(error.message); process.exit(3); });
  request.end(payload);
});
`;

describe('Upload dependency security', () => {
  const probe = (fields: string[][], disk = false) => spawnSync(
    process.execPath,
    ['-e', uploadProbe, require.resolve('@nestjs/platform-express'), JSON.stringify({ fields, disk })],
    { encoding: 'utf8', timeout: 5000 }
  );

  it.each([false, true])('preserves valid multipart uploads (disk storage: %s)', disk => {
    const result = probe([['metadata[title]', 'Example']], disk);

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      status: 200,
      result: {
        body: { metadata: { title: 'Example' } },
        files: [{ name: 'unit.xml', data: '<unit>ä</unit>' }]
      }
    });
  });

  it.each([
    { name: 'array length overflow', fields: [['metadata[4294967294]', 'value'], ['metadata[]', 'value']] },
    { name: 'array length overflow with leading zero', fields: [['metadata[04294967294]', 'value'], ['metadata[]', 'value']] }
  ])('rejects $name through normal request completion', ({ fields }) => {
    const result = probe(fields);

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).status).toBe(400);
  });
});

describe('Outgoing multipart headers', () => {
  it.each([
    { field: 'files\r\nX-Audit: injected', filename: 'scheme.vocs' },
    { field: 'files', filename: 'scheme.vocs"\r\nX-Audit: injected\r\n' }
  ])('prevents header injection from field $field and filename $filename', ({ field, filename }) => {
    const form = new FormData();
    form.append(field, Buffer.from('{"code":1}'), { filename, contentType: 'application/json' });

    const body = form.getBuffer().toString('utf8');

    expect(body).not.toContain('\r\nX-Audit: injected');
    expect(body).toContain('{"code":1}');
    expect(form.getHeaders()['content-type']).toContain('multipart/form-data; boundary=');
  });
});
