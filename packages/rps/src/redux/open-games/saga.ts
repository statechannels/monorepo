import {fork, take, select, cancel, call, apply, put} from 'redux-saga/effects';

export const getLocalState = (storeObj: any) => storeObj.game.localState;
function getOpenGame(storObj: any, address: string) {
  return storObj.openGames.filter(game => (game.address = address))[0];
}

import {default as firebase, reduxSagaFirebase} from '../../gateways/firebase';

import * as actions from './actions';

import {LocalState} from '../game/state';
import {bigNumberify} from 'ethers/utils';
import {gameJoined} from '../game/actions';
import {FIREBASE_PREFIX} from '../../constants';

export default function* openGameSaga(address: string) {
  // could be more efficient by only watching actions that could change the state
  // this is more robust though, so stick to watching all actions for the time being
  let openGameSyncerProcess: any = null;
  let myGameIsOnFirebase = false;

  while (true) {
    const localState: LocalState = yield select(getLocalState);

    if (
      localState.type === 'Setup.Lobby' ||
      localState.type === 'Setup.NeedAddress' ||
      localState.type === 'B.WaitingRoom'
    ) {
      // if we're in the lobby we need to sync openGames
      if (!openGameSyncerProcess || !openGameSyncerProcess.isRunning()) {
        openGameSyncerProcess = yield fork(openGameSyncer);
      }
    } else {
      // if we're not in the lobby, we shouldn't be syncing openGames
      if (openGameSyncerProcess) {
        yield cancel(openGameSyncerProcess);
      }
    }
    const action = yield take('*');

    if (action.type === 'JoinOpenGame' && localState.type === 'A.GameChosen') {
      const openGameKey = `/${FIREBASE_PREFIX}/challenges/${localState.opponentAddress}`;
      const taggedOpenGame = {
        isPublic: false,
        playerAName: localState.name,
        playerAOutcomeAddress: localState.outcomeAddress,
      };
      yield call(reduxSagaFirebase.database.patch, openGameKey, taggedOpenGame);
    }

    if (localState.type === 'B.WaitingRoom') {
      let myOpenGame;
      const myOpenGameKey = `/${FIREBASE_PREFIX}/challenges/${address}`;

      if (!myGameIsOnFirebase) {
        // my game isn't on firebase (as far as the app knows)
        // attempt to put the game on firebase - will be a no-op if already there

        myOpenGame = {
          address,
          outcomeAddress: localState.outcomeAddress || address,
          name: localState.name,
          stake: localState.roundBuyIn.toString(),
          createdAt: new Date().getTime(),
          isPublic: true,
          playerAName: 'unknown',
          playerAOutcomeAddress: 'unknown',
        };

        const disconnect = firebase
          .database()
          .ref(myOpenGameKey)
          .onDisconnect();
        yield apply(disconnect, disconnect.remove, []);
        // use update to allow us to pick our own key
        yield call(reduxSagaFirebase.database.update, myOpenGameKey, myOpenGame);
        myGameIsOnFirebase = true;
      } else {
        const storeObj = yield select();
        myOpenGame = getOpenGame(storeObj, myOpenGameKey);
        if (myOpenGame && !myOpenGame.isPublic) {
          yield put(
            gameJoined(
              myOpenGame.playerAName,
              myOpenGame.opponentAddress,
              myOpenGame.playerAOutcomeAddress
            )
          );
          yield call(reduxSagaFirebase.database.delete, myOpenGameKey);
          myGameIsOnFirebase = false;
        }
      }
    }
    if (localState.type === 'Setup.Lobby' && myGameIsOnFirebase && localState.address) {
      // we cancelled our game
      const myOpenGameKey = `/${FIREBASE_PREFIX}/challenges/${localState.address}`;
      yield call(reduxSagaFirebase.database.delete, myOpenGameKey);
      myGameIsOnFirebase = false;
    }
  }
}
// maps { '0xabc': openGame1Data, ... } to [openGame1Data, ....]
const openGameTransformer = dict => {
  if (!dict.value) {
    return [];
  }
  const allGames = Object.keys(dict.value).map(key => {
    // Convert to a proper BN hex string
    dict.value[key].stake = bigNumberify(dict.value[key].stake).toHexString();
    return dict.value[key];
  });

  return allGames;
};

function* openGameSyncer() {
  yield fork(
    reduxSagaFirebase.database.sync,
    `/${FIREBASE_PREFIX}/challenges`,
    {
      successActionCreator: actions.syncOpenGames,
      transform: openGameTransformer,
    },
    'value'
  );
}
