import { ApiProperty } from '@nestjs/swagger';

export const replayErrorCodes = [
  'REPLAY_PERSON_NOT_FOUND',
  'REPLAY_BOOKLET_NOT_FOUND',
  'REPLAY_UNIT_NOT_FOUND',
  'REPLAY_UNIT_DEFINITION_NOT_FOUND',
  'REPLAY_PLAYER_NOT_FOUND'
] as const;

export type ReplayErrorCode = (typeof replayErrorCodes)[number];

export class ReplayErrorDto {
  @ApiProperty({ example: 404 })
  statusCode!: 404;

  @ApiProperty({ enum: replayErrorCodes, example: 'REPLAY_UNIT_NOT_FOUND' })
  code!: ReplayErrorCode;

  @ApiProperty({ example: 'Replay unit was not found.' })
  message!: string;
}
