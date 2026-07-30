import { SetMetadata } from '@nestjs/common';

export const CODING_STATUS_MUTATION_METADATA = 'coding-status-mutation';

export const MutatesCodingStatus = () => SetMetadata(
  CODING_STATUS_MUTATION_METADATA,
  true
);
