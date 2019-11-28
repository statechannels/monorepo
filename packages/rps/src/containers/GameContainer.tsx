import React, { Fragment } from 'react';
import { connect } from 'react-redux';

import { SiteState } from '../redux/reducer';
import { Weapon } from '../core';
import * as gameActions from '../redux/game/actions';

import WaitingRoomPage from '../components/WaitingRoomPage';
import ProfileContainer from './ProfileContainer';

import { LocalState, PlayingStateName } from '../redux/game/state';

import LobbyContainer from './LobbyContainer';
import {
  ProposeGamePage,
  ConfirmGamePage,
  SelectWeaponPage,
  WeaponSelectedPage,
  GameOverPage,
  WaitForResting,
  ResultPage,
} from '../components';
import { unreachable } from '../utils/unreachable';

interface GameProps {
  state: LocalState;
  chooseWeapon: (move: Weapon) => void;
  playAgain: () => void;
  confirmGame: () => void;
  declineGame: () => void;
  conclude: () => void;
}

// TODO: Add wallet from wallet package
function GameContainer(props: GameProps) {
  return <Fragment>{RenderGame(props)}</Fragment>;
}

function RenderGame(props: GameProps) {
  const { state } = props;

  switch (state.type) {
    case 'Empty':
      return <ProfileContainer />;
    case 'NeedAddress':
    case 'Lobby':
    case 'CreatingOpenGame':
      return <LobbyContainer />;
    case 'WaitingRoom':
      return (
        <WaitingRoomPage
          cancelOpenGame={props.declineGame}
          roundBuyIn={state.roundBuyIn.toString()}
        />
      );
    case 'GameChosen':
      return <ProposeGamePage message="Waiting for opponent to confirm" />;
    case 'OpponentJoined':
      return (
        <ConfirmGamePage
          confirmGame={props.confirmGame}
          cancelGame={props.declineGame}
          stake={state.roundBuyIn.toString()}
          opponentName={state.opponentName}
        />
      );
    case 'ChooseWeapon':
      return <SelectWeaponPage chooseWeapon={props.chooseWeapon} />;
    case 'WeaponChosen':
    case 'WeaponAndSaltChosen':
      return (
        <WeaponSelectedPage
          message="Waiting for your opponent to choose their move"
          yourWeapon={state.myWeapon}
        />
      );
    case 'ResultPlayAgain':
      return (
        <WaitForResting
          yourWeapon={state.myWeapon}
          theirWeapon={state.theirWeapon}
          result={state.result}
          playAgain={props.playAgain}
          waitForOpponent={false}
        />
      );
    case 'WaitForRestart':
      return (
        <WaitForResting
          yourWeapon={state.myWeapon}
          theirWeapon={state.theirWeapon}
          result={state.result}
          playAgain={props.playAgain}
          waitForOpponent={true}
        />
      );
    case 'ShuttingDown':
      return (
        <ResultPage
          yourWeapon={state.myWeapon}
          theirWeapon={state.theirWeapon}
          result={state.result}
          playAgain={props.playAgain}
          shutDownReason={state.reason}
        />
      );
    case 'GameOver':
      // const ourTurn = state.player === 'A' ? state.turnNum % 2 !== 0 : turnNum % 2 === 0;
      const ourTurn = true; // TODO compute this properly
      return (
        <GameOverPage
          visible={(state.type as PlayingStateName) === 'GameOver'}
          conclude={props.conclude}
          ourTurn={ourTurn}
        />
      );
    default:
      unreachable(state);
      throw new Error(`View not created`);
  }
}

const mapStateToProps = (state: SiteState) => ({
  state: state.game.localState,
});

const mapDispatchToProps = {
  chooseWeapon: gameActions.chooseWeapon,
  playAgain: gameActions.playAgain,
  confirmGame: gameActions.startRound,
  declineGame: gameActions.cancelGame,
  conclude: gameActions.resign,
};

export default connect(mapStateToProps, mapDispatchToProps)(GameContainer);
