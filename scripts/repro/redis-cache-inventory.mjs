#!/usr/bin/env node

import Redis from 'ioredis';

const host = process.env.REDIS_HOST || 'localhost';
const port = Number.parseInt(process.env.REDIS_PORT || '6379', 10);
const scanCount = Number.parseInt(process.env.SCAN_COUNT || '500', 10);
const topLimit = Number.parseInt(process.env.TOP_LIMIT || '25', 10);
const sampleLimit = Number.parseInt(process.env.SAMPLE_LIMIT || '0', 10);
const namespacePrefix = process.env.REDIS_NAMESPACE_PREFIX || 'coding-box:';
const cachePrefix = `${namespacePrefix}cache:`;

const redis = new Redis({ host, port, lazyConnect: true, maxRetriesPerRequest: 1 });

function logicalKey(key) {
  if (key.startsWith(cachePrefix)) {
    return key.slice(cachePrefix.length);
  }
  if (key.startsWith(namespacePrefix)) {
    return key.slice(namespacePrefix.length);
  }
  return key;
}

function classify(key) {
  const logical = logicalKey(key);
  if (key.startsWith(cachePrefix)) {
    const knownCachePrefixes = [
      'response-analysis:',
      'response_analysis:',
      'response_analysis_page:',
      'validation:v2:',
      'responses:',
      'manual_coding_variables:',
      'manual_coding_scope_summary:',
      'coding_statistics:',
      'coding_statistics_version:',
      'coding_applied_results_overview:',
      'workspace-overview-stats-',
      'flat_response_filter_options:',
      'flat_responses_count:',
      'flat-frequencies-',
      'unit_variables:',
      'workspace_unit_variables:'
    ];
    const match = knownCachePrefixes.find(prefix => logical.startsWith(prefix));
    if (match) {
      return `cache:${match.replace(/[:/-]$/, '')}`;
    }
    return `cache:${logical.split(/[:_-]/, 1)[0] || 'unknown'}`;
  }

  const queueMatch = logical.match(/^([^:]+):/);
  if (queueMatch) {
    return `queue:${queueMatch[1]}`;
  }
  return 'other';
}

function createStats() {
  return {
    keys: 0,
    bytes: 0,
    noExpire: 0,
    expiring: 0,
    missingMemory: 0,
    minTtl: Number.POSITIVE_INFINITY,
    maxTtl: 0
  };
}

function addStats(stats, memoryBytes, ttl) {
  stats.keys += 1;
  if (Number.isFinite(memoryBytes)) {
    stats.bytes += memoryBytes;
  } else {
    stats.missingMemory += 1;
  }
  if (ttl === -1) {
    stats.noExpire += 1;
  } else if (ttl > 0) {
    stats.expiring += 1;
    stats.minTtl = Math.min(stats.minTtl, ttl);
    stats.maxTtl = Math.max(stats.maxTtl, ttl);
  }
}

function humanBytes(bytes) {
  const units = ['B', 'KiB', 'MiB', 'GiB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function serializeStats([group, stats]) {
  return {
    group,
    keys: stats.keys,
    bytes: stats.bytes,
    humanBytes: humanBytes(stats.bytes),
    noExpire: stats.noExpire,
    expiring: stats.expiring,
    minTtlSeconds: Number.isFinite(stats.minTtl) ? stats.minTtl : null,
    maxTtlSeconds: stats.maxTtl || null,
    missingMemory: stats.missingMemory
  };
}

async function scanKeys() {
  const groups = new Map();
  const allStats = createStats();
  const largest = [];
  let cursor = '0';
  let scanned = 0;

  do {
    const [nextCursor, keys] = await redis.scan(cursor, 'COUNT', scanCount);
    cursor = nextCursor;
    const batch = sampleLimit > 0 ?
      keys.slice(0, Math.max(0, sampleLimit - scanned)) :
      keys;
    if (batch.length === 0) {
      continue;
    }
    const pipeline = redis.pipeline();
    batch.forEach(key => {
      pipeline.memory('USAGE', key);
      pipeline.ttl(key);
      pipeline.type(key);
    });
    const replies = await pipeline.exec();
    for (let index = 0; index < batch.length; index += 1) {
      const key = batch[index];
      const memoryReply = replies[index * 3];
      const ttlReply = replies[index * 3 + 1];
      const typeReply = replies[index * 3 + 2];
      const memoryBytes = memoryReply?.[0] ? NaN : Number(memoryReply[1]);
      const ttl = ttlReply?.[0] ? -2 : Number(ttlReply[1]);
      const type = typeReply?.[0] ? 'unknown' : String(typeReply[1]);
      const groupName = classify(key);
      const group = groups.get(groupName) || createStats();

      addStats(group, memoryBytes, ttl);
      addStats(allStats, memoryBytes, ttl);
      groups.set(groupName, group);

      largest.push({
        key,
        group: groupName,
        type,
        ttlSeconds: ttl,
        bytes: Number.isFinite(memoryBytes) ? memoryBytes : 0,
        humanBytes: humanBytes(Number.isFinite(memoryBytes) ? memoryBytes : 0)
      });
    }
    scanned += batch.length;
  } while (cursor !== '0' && (sampleLimit === 0 || scanned < sampleLimit));

  largest.sort((a, b) => b.bytes - a.bytes);
  const sortedGroups = Array.from(groups.entries())
    .map(serializeStats)
    .sort((a, b) => b.bytes - a.bytes);

  return {
    generatedAt: new Date().toISOString(),
    redis: { host, port, namespacePrefix, scannedKeys: scanned },
    totals: serializeStats(['all', allStats]),
    groups: sortedGroups,
    largestKeys: largest.slice(0, topLimit)
  };
}

try {
  await redis.connect();
  const report = await scanKeys();
  console.log(JSON.stringify(report, null, 2));
} finally {
  redis.disconnect();
}
