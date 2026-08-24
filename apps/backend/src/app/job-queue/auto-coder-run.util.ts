import { BadRequestException } from '@nestjs/common';

export type AutoCoderRun = 1 | 2;

export const requireAutoCoderRun = (value: unknown): AutoCoderRun => {
  if (value === 1 || value === 2) {
    return value;
  }

  throw new BadRequestException('autoCoderRun must be 1 or 2');
};
