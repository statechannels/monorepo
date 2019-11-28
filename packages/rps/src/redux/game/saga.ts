import { select, call, put, take } from 'redux-saga/effects';
import { delay } from 'redux-saga';
import { RPSChannelClient } from '../../utils/rps-channel-client';
import {
  AppData,
  hashPreCommit,
  calculateResult,
  updateAllocation,
  Player,
  ChannelState,
  RoundProposed,
  RoundAccepted,
  Reveal,
} from '../../core';
import * as cs from '../../core/channel-state';
import * as a from './actions';
import * as ls from './state';
import { randomHex } from '../../utils/randomHex';
import { bigNumberify } from 'ethers/utils';

const getGameState = (state: any): ls.GameState => state.game;
const isPlayersTurnNext = (
  localState: ls.LocalState,
  channelState: ChannelState | null
): channelState is ChannelState => {
  if (!('player' in localState) || !channelState) {
    return false;
  }
  const playerIndex = localState.player === 'A' ? 0 : 1;

  return bigNumberify(channelState.turnNum)
    .sub(1) // for it to be our turn, the player before us must have just moved
    .mod(2)
    .eq(playerIndex);
};

export function* gameSaga(client: RPSChannelClient) {
  while (true) {
    yield take('*');
    yield* gameSagaRun(client);
  }
}

function* gameSagaRun(client: RPSChannelClient) {
  const { localState, channelState }: ls.GameState = yield select(getGameState);

  if (cs.isClosed(channelState) && localState.type !== 'GameOver') {
    yield* transitionToGameOver(localState, channelState);
    return;
  }

  switch (localState.type) {
    case 'NeedAddress':
      const address: string = yield call([client, 'getAddress']);
      yield put(a.gotAddressFromWallet(address));
      break;
    case 'GameChosen': // player A
      if (cs.isEmpty(channelState)) {
        yield* createChannel(localState, client);
      } else if (cs.isRunning(channelState)) {
        yield delay(1000);
        yield* startRound();
      }

      break;
    case 'OpponentJoined': // player B
      if (cs.inChannelProposed(channelState)) {
        yield* joinChannel(channelState, client);
        yield delay(1000);
        yield* startRound();
      }
      break;
    case 'WeaponChosen':
      if (ls.isPlayerA(localState)) {
        if (cs.isEmpty(channelState)) {
          // raise error
          break;
        }
        yield* generateSaltAndSendPropose(localState, channelState, client);
      } else {
        // player b
        if (cs.inRoundProposed(channelState)) {
          yield* sendRoundAccepted(localState, channelState, client);
        } else if (cs.inReveal(channelState)) {
          yield* calculateResultAndCloseChannelIfNoFunds(localState, channelState, client);
        }
      }
      break;
    case 'WeaponAndSaltChosen': // player A
      if (cs.inRoundAccepted(channelState)) {
        yield* calculateResultAndSendReveal(localState, channelState, client);
      }
      break;
    case 'WaitForRestart':
      if (ls.isPlayerA(localState) && cs.inStart(channelState)) {
        yield* startRound();
      } else if (ls.isPlayerB(localState) && cs.inReveal(channelState)) {
        yield* sendStartAndStartRound(channelState, client);
      }
      break;
    case 'ShuttingDown':
      if (isPlayersTurnNext(localState, channelState) && !cs.isClosed(channelState)) {
        yield* closeChannel(channelState, client);
      }
      break;
  }
}

function* createChannel(localState: ls.GameChosen, client: RPSChannelClient) {
  const openingBalance = bigNumberify(localState.roundBuyIn)
    .mul(5)
    .toString();
  const startState: AppData = { type: 'start' };
  const newChannelState = yield call(
    [client, 'createChannel'],
    localState.address,
    localState.opponentAddress,
    openingBalance.toString(),
    openingBalance.toString(),
    startState
  );
  yield put(a.updateChannelState(newChannelState));
}

function* joinChannel(channelState: ChannelState, client: RPSChannelClient) {
  const preFundSetup1 = yield call([client, 'joinChannel'], channelState.channelId);
  yield put(a.updateChannelState(preFundSetup1));
}

function* startRound() {
  yield put(a.startRound());
}

function* generateSaltAndSendPropose(
  localState: ls.WeaponChosen,
  channelState: ChannelState,
  client: RPSChannelClient
) {
  // if we're player A, we first generate a salt
  const salt = yield call(randomHex, 64);
  yield put(a.chooseSalt(salt)); // transitions us to WeaponAndSaltChosen

  const { myWeapon, roundBuyIn: stake } = localState;
  const { channelId, aBal, bBal, aAddress, bAddress } = channelState;

  const preCommit = hashPreCommit(myWeapon, salt);

  const roundProposed: AppData = { type: 'roundProposed', preCommit, stake };

  const updatedChannelState = yield call(
    [client, 'updateChannel'],
    channelId,
    aAddress,
    bAddress,
    aBal,
    bBal,
    roundProposed
  );
  yield put(a.updateChannelState(updatedChannelState));
}

function* sendRoundAccepted(
  localState: ls.WeaponChosen,
  channelState: ChannelState<RoundProposed>,
  client: RPSChannelClient
) {
  const playerBWeapon = localState.myWeapon;
  const { channelId, aBal, bBal, aAddress, bAddress } = channelState;
  const { stake, preCommit } = channelState.appData;
  const roundAccepted: AppData = {
    type: 'roundAccepted',
    stake,
    preCommit,
    playerBWeapon,
  };

  const [aBal2, bBal2] = [
    bigNumberify(aBal)
      .sub(stake)
      .toString(),
    bigNumberify(bBal)
      .add(stake)
      .toString(),
  ];

  const newState = yield call(
    [client, 'updateChannel'],
    channelId,
    aAddress,
    bAddress,
    aBal2,
    bBal2,
    roundAccepted
  );
  yield put(a.updateChannelState(newState));
}

function* calculateResultAndSendReveal(
  localState: ls.WeaponAndSaltChosen,
  channelState: ChannelState<RoundAccepted>,
  client: RPSChannelClient
) {
  const { myWeapon, salt } = localState;
  const { aBal, bBal, channelId, aAddress, bAddress } = channelState;
  const { playerBWeapon: theirWeapon, stake } = channelState.appData;
  const result = calculateResult(myWeapon, theirWeapon);
  const [aBal2, bBal2] = updateAllocation(result, Player.PlayerA, stake, aBal, bBal);
  const fundingSituation = calculateFundingSituation(Player.PlayerA, aBal2, bBal2, stake);

  const reveal: AppData = {
    type: 'reveal',
    salt,
    playerAWeapon: myWeapon,
    playerBWeapon: theirWeapon,
  };

  const updatedChannelState = yield call(
    [client, 'updateChannel'],
    channelId,
    aAddress,
    bAddress,
    aBal2.toString(),
    bBal2.toString(),
    reveal
  );
  yield put(a.updateChannelState(updatedChannelState));
  yield put(a.resultArrived(theirWeapon, result, fundingSituation));
}

function* calculateResultAndCloseChannelIfNoFunds(
  localState: ls.WeaponChosen,
  channelState: ChannelState<Reveal>,
  client: RPSChannelClient
) {
  const { playerAWeapon: theirWeapon } = channelState.appData;
  const { aBal, bBal, channelId } = channelState;
  const { myWeapon, roundBuyIn } = localState;
  const result = calculateResult(myWeapon, theirWeapon);
  const fundingSituation = calculateFundingSituation(Player.PlayerB, aBal, bBal, roundBuyIn);
  yield put(a.resultArrived(theirWeapon, result, fundingSituation));
  if (fundingSituation !== 'Ok') {
    const state = yield call([client, 'closeChannel'], channelId);
    yield put(a.updateChannelState(state));
  }
}

function* sendStartAndStartRound(channelState: ChannelState<Reveal>, client: RPSChannelClient) {
  const { aBal, bBal, channelId, bAddress, aAddress } = channelState;
  const start: AppData = { type: 'start' };
  const state = yield call(
    [client, 'updateChannel'],
    channelId,
    aAddress,
    bAddress,
    aBal,
    bBal,
    start
  );
  yield put(a.updateChannelState(state));
  yield put(a.startRound());
}

function* closeChannel(channelState: ChannelState, client: RPSChannelClient) {
  const closingChannelState = yield call([client, 'closeChannel'], channelState.channelId);
  yield put(a.updateChannelState(closingChannelState));
}

function* transitionToGameOver(localState: ls.LocalState, channelState: ChannelState) {
  let reason: ls.ShutDownReason = 'TheyResigned';
  if (localState.type === 'ShuttingDown') {
    reason = localState.reason;
  } else if (isPlayersTurnNext(localState, channelState)) {
    // if the channel is done and it's our turn, it means we must have initiated the shutdown
    reason = 'YouResigned';
  }
  yield put(a.gameOver(reason));
}

const calculateFundingSituation = (
  player: Player,
  aBal: string,
  bBal: string,
  stake: string
): a.FundingSituation => {
  const [myBal, theirBal] = player === Player.PlayerA ? [aBal, bBal] : [bBal, aBal];

  if (bigNumberify(myBal).lt(bigNumberify(stake))) {
    return 'MyFundsTooLow';
  } else if (bigNumberify(theirBal).lt(stake)) {
    return 'OpponentsFundsTooLow';
  } else {
    return 'Ok';
  }
};
