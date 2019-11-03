import {SharedData, queueMessage, registerChannelToMonitor} from "../../state";
import * as states from "./states";
import * as actions from "./actions";
import {ProtocolStateWithSharedData} from "..";
import {unreachable} from "../../../utils/reducer-utils";
import {validationSuccess, signatureSuccess, signatureFailure, validationFailure} from "../../../magmo-engine-client";
import {checkAndInitialize, signAndInitialize, signAndStore, checkAndStore} from "../../channel-store/reducer";
import {ProtocolAction} from "../../actions";
import * as dispute from "../dispute";
import {disputeReducer} from "../dispute/reducer";
import {convertStateToCommitment} from "../../../utils/nitro-converter";
import {joinSignature} from "ethers/utils";
import {State, SignedState} from "@statechannels/nitro-protocol";

// TODO: Right now we're using a fixed application ID
// since we're not too concerned with handling multiple running app channels.
// This might need to change in the future.
export const APPLICATION_PROCESS_ID = "Application";

export function initialize(
  sharedData: SharedData,
  channelId: string,
  address: string,
  privateKey: string
): ProtocolStateWithSharedData<states.ApplicationState> {
  return {
    protocolState: states.waitForFirstState({channelId, privateKey, address}),
    sharedData: registerChannelToMonitor(sharedData, APPLICATION_PROCESS_ID, channelId, [])
  };
}

export function applicationReducer(
  protocolState: states.ApplicationState,
  sharedData: SharedData,
  action: ProtocolAction
): ProtocolStateWithSharedData<states.ApplicationState> {
  if (states.isTerminalApplicationState(protocolState)) {
    return {protocolState, sharedData};
  }
  if (!actions.isApplicationAction(action)) {
    return {protocolState, sharedData};
  }
  if (dispute.isDisputeAction(action)) {
    return handleDisputeAction(protocolState, sharedData, action);
  }
  switch (action.type) {
    case "ENGINE.APPLICATION.OPPONENT_STATE_RECEIVED":
      return opponentStateReceivedReducer(protocolState, sharedData, action);
    case "ENGINE.APPLICATION.OWN_STATE_RECEIVED":
      return ownStateReceivedReducer(protocolState, sharedData, action);
    case "ENGINE.APPLICATION.CONCLUDED":
      return {sharedData, protocolState: states.success({})};
    case "ENGINE.APPLICATION.CHALLENGE_DETECTED":
      return challengeDetectedReducer(protocolState, sharedData, action);
    case "ENGINE.APPLICATION.CHALLENGE_REQUESTED":
      return challengeRequestedReducer(protocolState, sharedData, action);
    default:
      return unreachable(action);
  }
}

function ownStateReceivedReducer(
  protocolState: states.NonTerminalApplicationState,
  sharedData: SharedData,
  action: actions.OwnStateReceived
): ProtocolStateWithSharedData<states.ApplicationState> {
  const signResult = signAndUpdate(action.state, protocolState, sharedData);
  if (!signResult.isSuccess) {
    return {
      sharedData: queueMessage(sharedData, signatureFailure("Other", signResult.reason)),
      protocolState
    };
  } else {
    const updatedSharedData = {...sharedData, channelStore: signResult.store};
    return {
      sharedData: queueMessage(updatedSharedData, signatureSuccess(joinSignature(signResult.signedState.signature))),
      protocolState: states.ongoing(protocolState)
    };
  }
}

function opponentStateReceivedReducer(
  protocolState: states.NonTerminalApplicationState,
  sharedData: SharedData,
  action: actions.OpponentStateReceived
): ProtocolStateWithSharedData<states.ApplicationState> {
  const {signedState} = action;
  const validateResult = validateAndUpdate(signedState, protocolState, sharedData);
  if (!validateResult.isSuccess) {
    // TODO: Currently checkAndStore doesn't contain any validation messages
    // We might want to return a more descriptive message to the app?
    return {
      sharedData: queueMessage(sharedData, validationFailure("InvalidSignature")),
      protocolState
    };
  } else {
    const updatedSharedData = {...sharedData, channelStore: validateResult.store};
    return {
      sharedData: queueMessage(updatedSharedData, validationSuccess()),
      protocolState: states.ongoing(protocolState)
    };
  }
}

function challengeRequestedReducer(
  protocolState: states.NonTerminalApplicationState,
  sharedData: SharedData,
  action: actions.ChallengeRequested
): ProtocolStateWithSharedData<states.ApplicationState> {
  const {channelId, processId} = action;
  const disputeState = dispute.initializeChallenger(channelId, processId, sharedData);
  const newProtocolState = states.waitForDispute({
    ...protocolState,
    disputeState: disputeState.state
  });
  return {
    protocolState: newProtocolState,
    sharedData: {...disputeState.sharedData, currentProcessId: APPLICATION_PROCESS_ID}
  };
}

function challengeDetectedReducer(
  protocolState: states.NonTerminalApplicationState,
  sharedData: SharedData,
  action: actions.ChallengeDetected
): ProtocolStateWithSharedData<states.ApplicationState> {
  const {channelId, processId, expiresAt: expiryTime, state} = action;
  const disputeState = dispute.initializeResponder(
    processId,
    channelId,
    expiryTime,
    sharedData,
    convertStateToCommitment(state)
  );
  const newProtocolState = states.waitForDispute({
    ...protocolState,
    disputeState: disputeState.protocolState
  });
  return {
    protocolState: newProtocolState,
    sharedData: {...disputeState.sharedData, currentProcessId: APPLICATION_PROCESS_ID}
  };
}

function handleDisputeAction(
  protocolState: states.NonTerminalApplicationState,
  sharedData: SharedData,
  action: dispute.DisputeAction
): ProtocolStateWithSharedData<states.ApplicationState> {
  if (protocolState.type !== "Application.WaitForDispute") {
    return {protocolState, sharedData};
  }
  const newDisputeState = disputeReducer(protocolState.disputeState, sharedData, action);
  if (
    newDisputeState.protocolState.type === "Challenging.SuccessOpen" ||
    newDisputeState.protocolState.type === "Challenging.Failure" ||
    newDisputeState.protocolState.type === "Responding.Success"
  ) {
    return {
      protocolState: states.ongoing({...protocolState}),
      sharedData: newDisputeState.sharedData
    };
  }
  if (
    newDisputeState.protocolState.type === "Challenging.SuccessClosed" ||
    newDisputeState.protocolState.type === "Responding.Failure"
  ) {
    return {
      protocolState: states.success({...protocolState}),
      sharedData: newDisputeState.sharedData
    };
  }
  const newApplicationState = {...protocolState, disputeState: newDisputeState.protocolState};
  return {protocolState: newApplicationState, sharedData: newDisputeState.sharedData};
}

const validateAndUpdate = (
  signedState: SignedState,
  protocolState: states.ApplicationState,
  sharedData: SharedData
) => {
  if (protocolState.type === "Application.WaitForFirstState") {
    return checkAndInitialize(sharedData.channelStore, signedState, protocolState.privateKey);
  } else if (protocolState.type === "Application.Ongoing") {
    return checkAndStore(sharedData.channelStore, signedState);
  } else {
    return {isSuccess: false, store: sharedData.channelStore};
  }
};

const signAndUpdate = (state: State, protocolState: states.ApplicationState, sharedData: SharedData) => {
  if (protocolState.type === "Application.WaitForFirstState") {
    return signAndInitialize(sharedData.channelStore, state, protocolState.privateKey);
  } else {
    return signAndStore(sharedData.channelStore, state);
  }
};
