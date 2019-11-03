import {ChallengeCreatedEvent} from "../actions";
import {take, select, put} from "redux-saga/effects";
import * as selectors from "../selectors";
import {challengeDetected} from "../protocols/application/actions";
import {APPLICATION_PROCESS_ID} from "../protocols/application/reducer";

/**
 * A simple saga that determines if a challenge created event requires the engine to initialize a respond protocol
 */
export function* challengeResponseInitiator() {
  while (true) {
    const action: ChallengeCreatedEvent = yield take("ENGINE.ADJUDICATOR.CHALLENGE_CREATED_EVENT");
    const {challengeStates, channelId, finalizedAt: expiresAt} = action;

    const channelState = yield select(selectors.getOpenedChannelState, channelId);
    const [{state: latestState}] = challengeStates.slice(-1);
    const numParticipants = latestState.channel.participants.length;
    const ourStateIsLast = latestState.turnNum % numParticipants !== channelState.ourIndex;

    if (ourStateIsLast) {
      yield put(
        challengeDetected({
          state: latestState,
          channelId,
          processId: APPLICATION_PROCESS_ID,
          expiresAt
        })
      );
    }
  }
}
