import React from 'react';
import {Button} from 'reactstrap';
import {ApplicationLayout} from './ApplicationLayout';
import {formatUnits} from 'ethers/utils';

interface Props {
  cancelOpenGame: () => void;
  roundBuyIn: string;
}

export default class WaitingRoomPage extends React.PureComponent<Props> {
  render() {
    const {cancelOpenGame, roundBuyIn} = this.props;
    return (
      <ApplicationLayout>
        <div className="waiting-room-container">
          <h2 className="w-100 text-center">
            Waiting for someone to join your game for {formatUnits(roundBuyIn, 'ether')} ETH each.
          </h2>
          <Button className="cancel-challenge-button" onClick={cancelOpenGame}>
            Cancel
          </Button>
        </div>
      </ApplicationLayout>
    );
  }
}