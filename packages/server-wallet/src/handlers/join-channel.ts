import {Either, left, right, chain, map} from 'fp-ts/lib/Either';
import {StateVariables} from '@statechannels/wallet-core';
import {pipe} from 'fp-ts/lib/function';
import {ChannelId} from '@statechannels/client-api-schema';

import {SignState} from '../protocols/actions';
import {ChannelState} from '../protocols/state';
import {WalletError, Values} from '../errors/wallet-error';

type HandlerResult = Either<JoinChannelError, SignState>;
type StepResult = Either<JoinChannelError, ChannelState>;
export interface JoinChannelHandlerParams {
  channelId: ChannelId;
}

export class JoinChannelError extends WalletError {
  readonly type = WalletError.errors.JoinChannelError;

  static readonly reasons = {
    channelNotFound: 'channel not found',
    invalidTurnNum: 'latest state must be turn 0',
    alreadySignedByMe: 'already signed prefund setup',
    internalChannel: 'channel is managed by wallet and cannot be modified by API',
  } as const;

  constructor(
    reason: Values<typeof JoinChannelError.reasons>,
    public readonly data: any = undefined
  ) {
    super(reason);
  }
}

// The helper functions should be factored out, tested, and reusable
const hasStateSignedByMe = (cs: ChannelState): boolean => !!cs.latestSignedByMe;

const ensureNotSignedByMe = (cs: ChannelState): StepResult =>
  hasStateSignedByMe(cs)
    ? left(new JoinChannelError(JoinChannelError.reasons.alreadySignedByMe))
    : right(cs);

function ensureLatestStateIsPrefundSetup(cs: ChannelState): StepResult {
  if (cs.latest.turnNum === 0) return right(cs);
  return left(new JoinChannelError(JoinChannelError.reasons.invalidTurnNum));
}

function myPrefundState(cs: ChannelState): StateVariables {
  return {...cs.latest, turnNum: cs.myIndex};
}
// End helpers

export function joinChannel(
  args: JoinChannelHandlerParams,
  channelState: ChannelState
): HandlerResult {
  // TODO: use Action creator from another branch
  const signStateAction = (sv: StateVariables): SignState => {
    return {
      ...sv,
      type: 'SignState',
      channelId: args.channelId,
    };
  };

  return pipe(
    channelState,
    ensureNotSignedByMe,
    chain(ensureLatestStateIsPrefundSetup),
    map(myPrefundState),
    map(signStateAction)
  );
}
