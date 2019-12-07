import {connect} from 'react-redux';

import GameBar from '../components/GameBar';
import {SiteState} from '../redux/reducer';
import {PlayingState} from 'src/redux/game/state';

function mapStateToProps(state: SiteState) {
  const {localState, channelState} = state.game;

  const {name, opponentName, roundBuyIn, player} = localState as PlayingState;
  const aBal = channelState ? channelState.aBal : '';
  const bBal = channelState ? channelState.bBal : '';

  const myBalance = player === 'A' ? aBal : bBal;
  const opponentBalance = player === 'B' ? aBal : bBal;

  return {
    myName: name,
    opponentName,
    myBalance,
    opponentBalance,
    roundBuyIn,
  };
}

const mapDispatchToProps = {};

export default connect(mapStateToProps, mapDispatchToProps)(GameBar);
