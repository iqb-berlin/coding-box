import { ReplayErrorCode } from '../../../../../../../api-dto/coding/replay-error.dto';

const replayErrorMessages: Record<ReplayErrorCode, string> = {
  REPLAY_PERSON_NOT_FOUND: 'Replay person was not found.',
  REPLAY_BOOKLET_NOT_FOUND: 'Replay booklet was not found.',
  REPLAY_UNIT_NOT_FOUND: 'Replay unit was not found.',
  REPLAY_UNIT_DEFINITION_NOT_FOUND: 'Replay unit definition was not found.',
  REPLAY_PLAYER_NOT_FOUND: 'Replay player was not found.'
};

export class ReplayResourceNotFoundError extends Error {
  constructor(readonly code: ReplayErrorCode) {
    super(replayErrorMessages[code]);
    this.name = ReplayResourceNotFoundError.name;
  }
}
