const CHANNEL_EXISTS = new Error(
  'Attempting to open a channel that already exists -- use a different nonce'
);
const CHANNEL_MISSING = new Error('Channel does not exist');
const COMMITMENT_NOT_SIGNED = new Error('Commitment not signed by mover');
const INVALID_TRANSITION = new Error('Invalid transition');
const INVALID_COMMITMENT_UNKNOWN_REASON = new Error(
  'Commitment is not valid, but th reason is not known'
);
const NOT_OUR_TURN = new Error('Not our turn to create a commitment');
const VALUE_LOST = new Error('Value not preserved');
const processMissing = (processId: string) => new Error(`Process ${processId} not running`);
const processRunning = (processId: string) => new Error(`Process ${processId} already running`);

export default {
  CHANNEL_EXISTS,
  COMMITMENT_NOT_SIGNED,
  CHANNEL_MISSING,
  INVALID_TRANSITION,
  INVALID_COMMITMENT_UNKNOWN_REASON,
  NOT_OUR_TURN,
  VALUE_LOST,
  processMissing,
  processRunning
};
