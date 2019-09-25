import React from 'react';
import { PureComponent } from 'react';
import { connect } from 'react-redux';
import { ResponderNonTerminalState as NonTerminalConcludingState } from './states';
import { unreachable } from '../../../../utils/reducer-utils';
import ApproveConcluding from './components/approve-concluding';
import ApproveDefunding from './components/approve-defunding';
import { Defunding } from '../../defunding/container';
import * as actions from './actions';
import Acknowledge from '../../shared-components/acknowledge';
import { ConsensusUpdate } from '../../consensus-update/container';
import WaitForOpponentDecision from './components/wait-for-opponent-decision';

interface Props {
  state: NonTerminalConcludingState;
  approve: typeof actions.concludeApproved;
  defund: typeof actions.defundChosen;
  keepOpen: typeof actions.keepOpenChosen;
  acknowledge: typeof actions.acknowledged;
}

class ConcludingContainer extends PureComponent<Props> {
  render() {
    const { state, approve, defund, keepOpen, acknowledge } = this.props;
    const processId = state.processId;
    switch (state.type) {
      case 'ConcludingResponder.AcknowledgeSuccess':
        return (
          <Acknowledge
            title="Concluding Succesful"
            description="Your channel was closed and defunded."
            acknowledge={() => acknowledge({ processId })}
          />
        );
      case 'ConcludingResponder.AcknowledgeFailure':
        return (
          <Acknowledge
            title="Concluding Failed"
            description={state.reason}
            acknowledge={() => acknowledge({ processId })}
          />
        );
      case 'ConcludingResponder.DecideDefund':
        return (
          <ApproveDefunding
            approve={() => defund({ processId })}
            keepOpen={() => keepOpen({ processId })}
          />
        );
      case 'ConcludingResponder.WaitForDefund':
        return <Defunding state={state.defundingState} />;
      case 'ConcludingResponder.ApproveConcluding':
        return <ApproveConcluding approve={() => approve({ processId })} />;
      case 'ConcludingResponder.WaitForLedgerUpdate':
        return <ConsensusUpdate state={state.consensusUpdateState} />;
      case 'ConcludingResponder.WaitForOpponentSelection':
        return <WaitForOpponentDecision />;
      default:
        return unreachable(state);
    }
  }
}

const mapDispatchToProps = {
  approve: actions.concludeApproved,
  defund: actions.defundChosen,
  acknowledge: actions.acknowledged,
  keepOpen: actions.keepOpenChosen,
};

export const Concluding = connect(
  () => ({}),
  mapDispatchToProps,
)(ConcludingContainer);
