export interface CorrelationAccumulator {
  n: number;
  sumX: number;
  sumY: number;
  sumXX: number;
  sumYY: number;
  sumXY: number;
  positiveCount: number;
}

export type CorrelationStatus =
  'OK' | 'INSUFFICIENT_CASES' | 'CONSTANT_ITEM' | 'CONSTANT_DOMAIN';

export interface CorrelationResult {
  correlation: number | null;
  status: CorrelationStatus;
}

export function createCorrelationAccumulator(): CorrelationAccumulator {
  return {
    n: 0,
    sumX: 0,
    sumY: 0,
    sumXX: 0,
    sumYY: 0,
    sumXY: 0,
    positiveCount: 0
  };
}

export function addCorrelationPair(
  accumulator: CorrelationAccumulator,
  x: number,
  y: number
): void {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return;
  }

  accumulator.n += 1;
  accumulator.sumX += x;
  accumulator.sumY += y;
  accumulator.sumXX += x * x;
  accumulator.sumYY += y * y;
  accumulator.sumXY += x * y;
  if (x === 1) {
    accumulator.positiveCount += 1;
  }
}

export function calculateCorrelation(
  accumulator: CorrelationAccumulator
): CorrelationResult {
  if (accumulator.n < 2) {
    return {
      correlation: null,
      status: 'INSUFFICIENT_CASES'
    };
  }

  const xVariance =
    accumulator.n * accumulator.sumXX - accumulator.sumX * accumulator.sumX;
  if (xVariance <= 0) {
    return {
      correlation: null,
      status: 'CONSTANT_ITEM'
    };
  }

  const yVariance =
    accumulator.n * accumulator.sumYY - accumulator.sumY * accumulator.sumY;
  if (yVariance <= 0) {
    return {
      correlation: null,
      status: 'CONSTANT_DOMAIN'
    };
  }

  const covariance =
    accumulator.n * accumulator.sumXY - accumulator.sumX * accumulator.sumY;

  return {
    correlation: covariance / Math.sqrt(xVariance * yVariance),
    status: 'OK'
  };
}
