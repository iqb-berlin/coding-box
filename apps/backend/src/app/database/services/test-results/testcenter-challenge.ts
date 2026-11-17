import { BadGatewayException, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'crypto';
import { setImmediate } from 'timers/promises';

interface TestcenterChallenge {
  algorithm: string;
  challenge: string;
  salt: string;
  signature: string;
  maxNumber: number;
}

let activeChallenges = 0;

/** Bound provider-controlled CPU work and yield between batches so the API remains responsive. */
export async function solveTestcenterChallenge(data: unknown): Promise<Omit<TestcenterChallenge, 'maxNumber'> & { number: number }> {
  if (activeChallenges >= 2) throw new ServiceUnavailableException('Testcenter challenge capacity exceeded. Please retry later.');
  activeChallenges += 1;
  try {
    return await solve(data);
  } finally {
    activeChallenges -= 1;
  }
}

async function solve(data: unknown): Promise<Omit<TestcenterChallenge, 'maxNumber'> & { number: number }> {
  if (!data || typeof data !== 'object') throw new BadGatewayException('Invalid Testcenter challenge');
  const challenge = data as TestcenterChallenge;
  const algorithm = new Map([['SHA-256', 'sha256'], ['SHA-512', 'sha512']]).get(challenge.algorithm);
  if (!algorithm || !Number.isSafeInteger(challenge.maxNumber) || challenge.maxNumber < 0 || challenge.maxNumber > 1_000_000 ||
      typeof challenge.salt !== 'string' || !challenge.salt || challenge.salt.length > 8192 ||
      typeof challenge.signature !== 'string' || !challenge.signature || challenge.signature.length > 1024 ||
      typeof challenge.challenge !== 'string' || !/^[a-f0-9]+$/i.test(challenge.challenge) ||
      challenge.challenge.length !== createHash(algorithm).digest('hex').length) {
    throw new BadGatewayException('Invalid or unsupported Testcenter challenge');
  }
  const started = performance.now();
  for (let number = 0; number <= challenge.maxNumber; number++) {
    if (number % 1000 === 0) {
      if (performance.now() - started > 5000) throw new ServiceUnavailableException('Testcenter challenge exceeded its time limit');
      await setImmediate();
    }
    if (createHash(algorithm).update(`${challenge.salt}${number}`).digest('hex') === challenge.challenge.toLowerCase()) {
      return {
        algorithm: challenge.algorithm, challenge: challenge.challenge, salt: challenge.salt, signature: challenge.signature, number
      };
    }
  }
  throw new BadGatewayException('Testcenter challenge has no solution within the advertised limit');
}
