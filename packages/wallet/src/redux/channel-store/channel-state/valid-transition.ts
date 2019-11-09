import {ChannelState} from "./states";
import {getChannelId, State, SignedState} from "@statechannels/nitro-protocol";
import {hasValidSignature} from "../../../utils/signing-utils";

export function validTransition(channelState: ChannelState, state: State): boolean {
  const channelNonce = state.channel.channelNonce;
  const channelId = getChannelId(state.channel);

  return (
    state.turnNum === channelState.turnNum + 1 &&
    channelNonce === channelState.channelNonce &&
    state.channel.participants[0] === channelState.participants[0] &&
    state.channel.participants[1] === channelState.participants[1] &&
    channelId === channelState.channelId
  );
}

export function validStateTransition(first: State, second: State): boolean {
  return (
    second.turnNum === first.turnNum + 1 &&
    getChannelId(first.channel) === getChannelId(second.channel)
  );
}

export function validTransitions(states: SignedState[]): boolean {
  const validSignatures = states.reduce((_, s) => {
    if (!hasValidSignature(s)) {
      return false;
    }
    return true;
  }, true);
  if (!validSignatures) {
    return false;
  }

  for (let i = 0; i < states.length - 1; i += 1) {
    const first = states[i];
    const second = states[i + 1];
    if (!validStateTransition(first.state, second.state)) {
      return false;
    }
  }

  return true;
}
