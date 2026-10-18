const { createHash } = require('node:crypto');
const { mkdir, readFile, writeFile } = require('node:fs/promises');
const path = require('node:path');
const sources = require('../fixtures/aspect-players.json');

// Release HTML stays in the ignored cache; every cached or downloaded artifact is checked against its pinned hash.
async function loadAspectPlayer(version) {
  const source = sources.find(candidate => candidate.version === version);
  if (!source) {
    throw new Error(`Unpinned Aspect version: ${version}`);
  }
  const cacheDirectory = path.resolve('cache/replay-player');
  const cachePath = path.join(cacheDirectory, source.fileName);
  let html;
  let downloaded = false;
  try {
    html = await readFile(cachePath);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
    const response = await fetch(source.url, { signal: AbortSignal.timeout(45_000) });
    if (!response.ok) {
      throw new Error(`Aspect ${version} download failed: HTTP ${response.status}`);
    }
    html = Buffer.from(await response.arrayBuffer());
    downloaded = true;
  }
  if (createHash('sha256').update(html).digest('hex') !== source.sha256) {
    throw new Error(`Aspect ${version} checksum mismatch`);
  }
  if (downloaded) {
    await mkdir(cacheDirectory, { recursive: true });
    await writeFile(cachePath, html);
  }
  return html.toString('utf8');
}

module.exports = { loadAspectPlayer };
