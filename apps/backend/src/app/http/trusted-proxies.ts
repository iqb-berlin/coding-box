import { isIP } from 'node:net';

/** No trust by default; explicitly support one ingress hop or known proxy subnets. */
export function parseTrustedProxies(value: unknown): false | 1 | string[] {
  if (value === undefined || value === null || value === '' || value === 'false') return false;
  if (value === '1' || value === 1) return 1;
  if (typeof value !== 'string') throw new Error('HTTP_TRUSTED_PROXIES must contain proxy addresses or CIDR subnets');
  const proxies = value.split(',').map(entry => entry.trim());
  const aliases = new Set(['loopback', 'linklocal', 'uniquelocal']);
  for (const proxy of proxies) {
    if (aliases.has(proxy)) continue;
    const [address, prefix, extra] = proxy.split('/');
    const family = isIP(address);
    if (!family || extra !== undefined || (prefix !== undefined && (
      !/^\d+$/.test(prefix) || Number(prefix) < 1 || Number(prefix) > (family === 4 ? 32 : 128)
    ))) {
      throw new Error('HTTP_TRUSTED_PROXIES must contain proxy addresses or CIDR subnets; unrestricted trust is not allowed');
    }
  }
  return proxies;
}
