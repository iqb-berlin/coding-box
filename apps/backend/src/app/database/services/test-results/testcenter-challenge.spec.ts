import { createHash } from 'crypto';
import { BadGatewayException } from '@nestjs/common';
import { solveTestcenterChallenge } from './testcenter-challenge';

describe('Testcenter proof of work', () => {
  const fixture = (number = 17) => ({
    algorithm: 'SHA-256',
    salt: 'test-salt?loginType=admin',
    signature: 'provider-signature',
    maxNumber: 20,
    challenge: createHash('sha256').update(`test-salt?loginType=admin${number}`).digest('hex')
  });

  it('solves the advertised hash while retaining the provider signature and credentials binding', async () => {
    await expect(solveTestcenterChallenge(fixture())).resolves.toEqual({
      algorithm: 'SHA-256',
      salt: 'test-salt?loginType=admin',
      signature: 'provider-signature',
      challenge: fixture().challenge,
      number: 17
    });
  });

  it.each([null, {}, { ...fixture(), algorithm: 'unknown' }, { ...fixture(), maxNumber: -1 },
    { ...fixture(), maxNumber: 1_000_001 }, { ...fixture(), maxNumber: 1.2 }, { ...fixture(), salt: 'a'.repeat(8193) },
    { ...fixture(), challenge: 'not-a-hash' }])('rejects malformed or excessive provider work: %j', async input => {
    await expect(solveTestcenterChallenge(input)).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('refuses challenges whose solution exceeds the advertised limit', async () => {
    await expect(solveTestcenterChallenge(fixture(21))).rejects.toThrow('no solution');
  });

  it('bounds concurrent CPU work and releases capacity after completion', async () => {
    const first = solveTestcenterChallenge(fixture());
    const second = solveTestcenterChallenge(fixture());
    await expect(solveTestcenterChallenge(fixture())).rejects.toMatchObject({ status: 503 });
    await Promise.all([first, second]);
    await expect(solveTestcenterChallenge(fixture())).resolves.toMatchObject({ number: 17 });
  });
});
