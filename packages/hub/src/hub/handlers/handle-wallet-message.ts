import {
  ConcludeInstigated,
  RelayableAction,
  RelayActionWithMessage,
  SignedStatesReceived,
  StrategyProposed,
  ChannelOpen,
  getProcessId
} from '../../communication';
import {getProcess} from '../../wallet/db/queries/walletProcess';
import {handleNewProcessAction} from './handle-new-process-action';
import {handleOngoingProcessAction} from './handle-ongoing-process-action';
import {getChannelId} from '@statechannels/nitro-protocol';

export async function handleWalletMessage(
  message: RelayableAction
): Promise<RelayActionWithMessage[] | undefined> {
  if (isNewProcessAction(message) && (await shouldHandleAsNewProcessAction(message))) {
    return handleNewProcessAction(message);
  } else if (isProtocolAction(message)) {
    return handleOngoingProcessAction(message);
  } else {
    return undefined;
  }
}

async function shouldHandleAsNewProcessAction(action: ChannelOpen): Promise<boolean> {
  return !(await getProcess(getProcessId(action)));
}

function isNewProcessAction(action: RelayableAction): action is ChannelOpen {
  return action.type === 'Channel.Open';
}

function isProtocolAction(
  action: RelayableAction
): action is StrategyProposed | SignedStatesReceived {
  return (
    action.type === 'WALLET.FUNDING_STRATEGY_NEGOTIATION.STRATEGY_PROPOSED' ||
    action.type === 'WALLET.COMMON.SIGNED_STATES_RECEIVED'
  );
}
