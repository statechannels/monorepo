import {
  confirmChannelCreationWorkflow,
  config,
  WorkflowContext
} from '../../workflows/confirm-create-channel';
export default {title: 'X-state wallet'};
import {storiesOf} from '@storybook/react';
import {interpret} from 'xstate';
import {EphemeralObsoleteStore} from '@statechannels/wallet-protocols';
import {Participant} from '@statechannels/client-api-schema/types/definitions';
import {renderWalletInFrontOfApp} from './helpers';

const store = new EphemeralObsoleteStore({
  privateKeys: {
    ['0xaddress']: '0xkey'
  },
  ethAssetHolderAddress: '0xassetholder'
});

const alice: Participant = {
  participantId: 'a',
  signingAddress: '0xa',
  destination: '0xad'
};

const bob: Participant = {
  participantId: 'b',
  signingAddress: '0xb',
  destination: '0xbd'
};

const testContext: WorkflowContext = {
  participants: [alice, bob],
  allocations: [],
  appDefinition: '0x0',
  appData: '0x0',
  chainId: '0',
  challengeDuration: 1
};

if (config.states) {
  Object.keys(config.states).forEach(state => {
    const machine = interpret<any, any, any>(
      confirmChannelCreationWorkflow(store, testContext).withContext(testContext),
      {
        devTools: true
      }
    ); // start a new interpreted machine for each story
    machine.onEvent(event => console.log(event.type)).start(state);
    storiesOf('Workflows / Confirm Create Channel', module).add(
      state.toString(),
      renderWalletInFrontOfApp(machine)
    );
    machine.stop(); // the machine will be stopped before it can be transitioned. This means the console.log on L49 throws a warning that we sent an event to a stopped machine.
  });
}
