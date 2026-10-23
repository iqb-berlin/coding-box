const http = require('node:http');
const { once } = require('node:events');
const { randomUUID } = require('node:crypto');

// Hold real HTTP responses in Node, outside cy.intercept's command-timeout budget.
function createDeferredResponses() {
  const responses = new Map();
  let server;

  function send(gate, response) {
    response.writeHead(gate.statusCode, gate.headers);
    response.end(gate.body);
  }

  return {
    async create({ body, statusCode = 200, headers = {} }) {
      if (!server) {
        server = http.createServer((request, response) => {
          request.resume();
          const gate = responses.get(request.url);
          if (!gate) {
            response.writeHead(404);
            response.end();
          } else if (gate.released) {
            send(gate, response);
          } else {
            gate.pending.add(response);
            response.on('close', () => gate.pending.delete(response));
          }
        });
        server.listen(0, '127.0.0.1');
        await once(server, 'listening');
      }
      const id = `/${randomUUID()}`;
      responses.set(id, {
        body: typeof body === 'string' ? body : JSON.stringify(body),
        headers: { 'content-type': 'application/json', ...headers },
        statusCode,
        released: false,
        pending: new Set()
      });
      return { id, url: `http://127.0.0.1:${server.address().port}${id}` };
    },
    release(id) {
      const gate = responses.get(id);
      if (!gate) throw new Error('Unknown deferred response.');
      gate.released = true;
      for (const response of gate.pending) send(gate, response);
      gate.pending.clear();
      return null;
    },
    async reset() {
      responses.clear();
      if (server) {
        const closed = new Promise(resolve => server.close(resolve));
        server.closeAllConnections();
        server = undefined;
        await closed;
      }
      return null;
    }
  };
}

module.exports = { createDeferredResponses };
