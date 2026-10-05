import net from 'node:net';

/** Keep browser origins on trusted loopback when Docker runs on a remote daemon. */
export async function startLoopbackForwarders(remoteHost, mappings) {
  const servers = [];
  const sockets = new Set();
  const track = socket => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  };
  let closePromise;
  const close = () => {
    closePromise ??= (async () => {
      for (const socket of sockets) socket.destroy();
      await Promise.all(servers.map(server => new Promise((resolve, reject) => {
        server.close(error => (error ? reject(error) : resolve()));
      })));
    })();
    return closePromise;
  };

  try {
    for (const { localPort, remotePort } of mappings) {
      const server = net.createServer(client => {
        const upstream = net.connect(remotePort, remoteHost);
        track(client);
        track(upstream);
        const destroy = () => {
          client.destroy();
          upstream.destroy();
        };
        client.on('error', destroy);
        upstream.on('error', destroy);
        client.pipe(upstream).pipe(client);
      });
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(localPort, '127.0.0.1', resolve);
      });
      servers.push(server);
    }
    return { ports: servers.map(server => server.address().port), close };
  } catch (error) {
    await close();
    throw error;
  }
}
