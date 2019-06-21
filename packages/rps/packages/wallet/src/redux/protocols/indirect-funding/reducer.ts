import { unreachable } from '../../../utils/reducer-utils';
import { TwoPartyPlayerIndex } from '../../types';
import { playerAReducer, initialize as initializeA } from './player-a/reducer';
import { playerBReducer, initialize as initializeB } from './player-b/reducer';
import { SharedData } from '../../state';
import { ChannelState } from '../../channel-store';
import { isPlayerAState } from './player-a/states';
import { NonTerminalIndirectFundingState, IndirectFundingState } from './states';
import { IndirectFundingAction } from './actions';
import { ProtocolStateWithSharedData } from '../../../redux/protocols';

type ReturnVal = ProtocolStateWithSharedData<IndirectFundingState>;

export function initialize(
  processId: string,
  channel: ChannelState,
  sharedData: SharedData,
): ReturnVal {
  // todo: would be nice to avoid casting here
  const ourIndex: TwoPartyPlayerIndex = channel.ourIndex;

  switch (ourIndex) {
    case TwoPartyPlayerIndex.A:
      return initializeA(processId, channel.channelId, sharedData);
    case TwoPartyPlayerIndex.B:
      return initializeB(processId, channel.channelId, sharedData);
    default:
      return unreachable(ourIndex);
  }
}

export const indirectFundingReducer = (
  protocolState: NonTerminalIndirectFundingState,
  sharedData: SharedData,
  action: IndirectFundingAction,
): ReturnVal => {
  if (isPlayerAState(protocolState)) {
    return playerAReducer(protocolState, sharedData, action);
  } else {
    return playerBReducer(protocolState, sharedData, action);
  }
};
