import { take, cancel, actionChannel, fork, spawn, race, call, put } from 'redux-saga/effects';
import { delay } from 'redux-saga';

import * as applicationActions from './actions';
import * as autoOpponentActions from '../auto-opponent/actions';
import { walletSaga, actions as walletActions } from '../../wallet';

import waitingRoomSaga from '../waiting-room/saga';
import gameSaga from '../game/saga';
import lobbySaga from '../lobby/saga';
import messageServiceSaga from '../message-service/saga';
import autoOpponentSaga from '../auto-opponent/saga';

export default function* applicationControllerSaga(userId: string) {
  // need to yield* so that the fork(walletSaga) runs in the context of this saga -
  // otherwise it'll be killed when the setupWallet saga returns
  const { address } = yield call(setupWallet, userId);

  yield call(setupAutoOpponent);

  yield fork(messageServiceSaga, address);

  const channel = yield actionChannel([
    applicationActions.LOBBY_REQUEST,
    applicationActions.WAITING_ROOM_REQUEST,
    applicationActions.GAME_REQUEST,
  ]);
  let currentRoom = yield fork(lobbySaga, address);
  
  while (true) {
    const action: applicationActions.AnyAction = yield take(channel);
    yield cancel(currentRoom); // todo: maybe we should do some checks first

    switch (action.type) {
      case applicationActions.LOBBY_REQUEST:
        currentRoom = yield fork(lobbySaga, address);
        break;
      case applicationActions.WAITING_ROOM_REQUEST:
        const isPublic = true;
        currentRoom = yield fork(waitingRoomSaga, address, action.name, action.stake, isPublic);
        break;
      case applicationActions.GAME_REQUEST:
        currentRoom = yield fork(gameSaga, action.gameEngine);
        break;
      default:
        // todo: check for unreachability
    }
  }
}

function* setupWallet(uid) {
  const channel = yield actionChannel(walletActions.INITIALIZATION_SUCCESS);

  const task = yield spawn(walletSaga, uid);

  const { success, failure } = yield race({
    success: take(channel),
    failure: call(delay, 2000),
  });

  if (failure) {
    yield put(walletActions.initializationFailure('Wallet initialization timed out'))
  } else {
    const address = (success as walletActions.InitializationSuccess).address;

    return { address, task };
  }
}

function* setupAutoOpponent() {
  const channel = yield actionChannel(autoOpponentActions.INITIALIZATION_SUCCESS);

  const task = yield spawn(autoOpponentSaga);

  const { success, failure } = yield race({
    success: take(channel),
    failure: call(delay, 2000),
  });

  if (failure) { throw new Error('Auto-opponent initialization timed out'); }

  const address = (success as autoOpponentActions.InitializationSuccess).address;

  return { address, task };
}
