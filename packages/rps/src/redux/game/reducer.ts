import {
  WeaponChosen,
  weaponChosen,
  weaponAndSaltChosen,
  resultPlayAgain,
  LocalState,
  lobby,
  waitForRestart,
  chooseWeapon,
  shuttingDown,
  gameChosen,
  waitingRoom,
  opponentJoined,
  gameOver,
  GameState,
  creatingOpenGame,
  needAddress,
} from './state';
import { Reducer, combineReducers } from 'redux';
import {
  GameAction,
  JoinOpenGame,
  ChooseWeapon,
  ChooseSalt,
  ResultArrived,
  PlayAgain,
  Resign,
  UpdateChannelState,
  CreateGame,
  GameJoined,
  StartRound,
  GameOver,
  UpdateProfile,
  CancelGame,
  NewOpenGame,
  GotAddressFromWallet,
} from './actions';
import { ChannelState } from '../../core';
import { unreachable } from '../../utils/unreachable';

const emptyLocalState: LocalState = { type: 'Empty' };

const channelReducer: Reducer<ChannelState | null> = (
  state: ChannelState | null = null,
  action: UpdateChannelState
) => {
  if (action.type === 'UpdateChannelState') {
    return action.channelState;
  } else {
    return state;
  }
};

const localReducer: Reducer<LocalState> = (
  state: LocalState = emptyLocalState,
  action: GameAction
) => {
  switch (action.type) {
    case 'GotAddressFromWallet':
      return handleGotAddressFromWallet(state, action);
    case 'UpdateProfile':
      return handleUpdateProfile(state, action);
    case 'NewOpenGame':
      return handleNewOpenGame(state, action);
    case 'JoinOpenGame':
      return handleJoinOpenGame(state, action);
    case 'CreateGame':
      return handleCreateGame(state, action);
    case 'CancelGame':
      return handleCancelGame(state, action);
    case 'GameJoined':
      return handleGameJoined(state, action);
    case 'ChooseWeapon':
      return handleChooseWeapon(state, action);
    case 'ChooseSalt':
      return handleChooseSalt(state, action);
    case 'ResultArrived':
      return handleResultArrived(state, action);
    case 'PlayAgain':
      return handlePlayAgain(state, action);
    case 'StartRound':
      return handleStartRound(state, action);
    case 'Resign':
      return handleResign(state, action);
    case 'GameOver':
      return handleGameOver(state, action);
    default:
      return unreachable(action, state);
  }
};

export const gameReducer: Reducer<GameState> = combineReducers({
  localState: localReducer,
  channelState: channelReducer,
});

const handleUpdateProfile = (state: LocalState, action: UpdateProfile): LocalState => {
  if (state.type !== 'Empty') {
    return state;
  }
  return needAddress({
    ...state,
    ...action,
  });
};

const handleGotAddressFromWallet = (
  state: LocalState,
  action: GotAddressFromWallet
): LocalState => {
  if (state.type !== 'NeedAddress') {
    return state;
  }
  return lobby({
    ...state,
    ...action,
  });
};

const handleNewOpenGame = (state: LocalState, action: NewOpenGame): LocalState => {
  if (state.type !== 'Lobby') {
    return state;
  }

  return creatingOpenGame(state);
};

const handleJoinOpenGame = (state: LocalState, action: JoinOpenGame): LocalState => {
  if (state.type === 'Empty' || state.type === 'NeedAddress') {
    return state;
  }

  const { opponentName, opponentAddress, roundBuyIn } = action;
  const { name, address } = state;

  return gameChosen({ name, address, opponentName, roundBuyIn }, opponentAddress);
};

const handleGameJoined = (state: LocalState, action: GameJoined): LocalState => {
  if (state.type !== 'WaitingRoom') {
    return state;
  }

  const { opponentName, opponentAddress } = action;
  const { name, address, roundBuyIn } = state;

  return opponentJoined({ name, address, opponentName, roundBuyIn, opponentAddress });
};

const handleCreateGame = (state: LocalState, action: CreateGame): LocalState => {
  if (state.type === 'Empty' || state.type === 'NeedAddress') {
    return state;
  }

  const { roundBuyIn } = action;
  const { name, address } = state;

  return waitingRoom({ name, address, roundBuyIn });
};

const handleCancelGame = (state: LocalState, action: CancelGame): LocalState => {
  if (state.type === 'WaitingRoom' || state.type === 'OpponentJoined') {
    return lobby(state);
  } else {
    return state;
  }
};

const handleChooseWeapon = (state: LocalState, action: ChooseWeapon): LocalState => {
  if (state.type !== 'ChooseWeapon') {
    return state;
  }

  const { weapon } = action;
  return weaponChosen(state, weapon);
};

const handleChooseSalt = (state: LocalState, action: ChooseSalt): LocalState => {
  if (state.type !== 'WeaponChosen' || state.player !== 'A') {
    return state;
  }
  // not sure why typsecript can't see that player === 'A' here ...
  const oldLocalState = state as WeaponChosen & { player: 'A' };

  const { salt } = action;
  return weaponAndSaltChosen(oldLocalState, salt);
};

const handleResultArrived = (state: LocalState, action: ResultArrived): LocalState => {
  if (state.type !== 'WeaponChosen' && state.type !== 'WeaponAndSaltChosen') {
    return state;
  }
  const { theirWeapon, result, fundingSituation } = action;
  switch (fundingSituation) {
    case 'Ok':
      return resultPlayAgain(state, theirWeapon, result);
    case 'MyFundsTooLow':
      return shuttingDown(state, 'InsufficientFundsYou', theirWeapon, result);
    case 'OpponentsFundsTooLow':
      return shuttingDown(state, 'InsufficientFundsOpponent', theirWeapon, result);
    default:
      return state;
  }
};

const handlePlayAgain = (state: LocalState, action: PlayAgain): LocalState => {
  if (state.type !== 'ResultPlayAgain') {
    return state;
  }
  return waitForRestart(state, state.theirWeapon, state.result);
};

const handleStartRound = (state: LocalState, action: StartRound): LocalState => {
  if (
    state.type !== 'WaitForRestart' &&
    state.type !== 'GameChosen' &&
    state.type !== 'OpponentJoined'
  ) {
    return state;
  }

  return chooseWeapon(state);
};

const handleResign = (state: LocalState, action: Resign): LocalState => {
  if (
    state.type === 'Empty' ||
    state.type === 'NeedAddress' ||
    state.type === 'Lobby' ||
    state.type === 'WaitingRoom' ||
    state.type === 'CreatingOpenGame'
  ) {
    return state;
  }
  return shuttingDown({ ...state, myWeapon: undefined }, 'YouResigned');
};

const handleGameOver = (state: LocalState, action: GameOver): LocalState => {
  if (
    state.type === 'Empty' ||
    state.type === 'NeedAddress' ||
    state.type === 'Lobby' ||
    state.type === 'WaitingRoom' ||
    state.type === 'CreatingOpenGame'
  ) {
    return state;
  }
  const { reason } = action;

  return gameOver(state, reason);
};
