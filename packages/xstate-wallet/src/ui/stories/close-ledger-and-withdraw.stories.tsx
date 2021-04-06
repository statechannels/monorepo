import {storiesOf} from '@storybook/react';
import {interpret} from 'xstate';
import React from 'react';
import {Participant, DomainBudget, ethBudget, BN, makeAddress} from '@statechannels/wallet-core';
import {utils} from 'ethers';

import {MessagingService, MessagingServiceInterface} from '../../messaging';
import {CloseLedgerAndWithdraw} from '../close-ledger-and-withdraw';
import {Store} from '../../store';
import {logger} from '../../logger';
import {
  workflow as closeLedgerWithdrawWorkflow,
  config,
  WorkflowContext
} from '../../workflows/close-ledger-and-withdraw';

import {renderComponentInFrontOfApp} from './helpers';

const store = new Store();
store.initialize(['0x8624ebe7364bb776f891ca339f0aaa820cc64cc9fca6a28eec71e6d8fc950f29']);
const messagingService: MessagingServiceInterface = new MessagingService(store);

const alice: Participant = {
  participantId: 'a',
  signingAddress: makeAddress('0x1000000000000000000000000000000000000001'),
  destination: '0xad' as any
};

const bob: Participant = {
  participantId: 'b',
  signingAddress: makeAddress('0x1000000000000000000000000000000000000002'),
  destination: '0xbd' as any
};

const budget: DomainBudget = ethBudget('rps.statechannels.org', {
  availableReceiveCapacity: BN.from(utils.parseEther('0.05')),
  availableSendCapacity: BN.from(utils.parseEther('0.05'))
});
const testContext: WorkflowContext = {
  player: alice,
  opponent: bob,
  requestId: 123,
  ledgerId: 'ledger-id-123',
  domain: 'abc.com',
  budget
};

if (config.states) {
  Object.keys(config.states).forEach(state => {
    const machine = interpret<any, any, any>(
      closeLedgerWithdrawWorkflow(store, messagingService, testContext).withContext(testContext),
      {
        devTools: true
      }
    ); // start a new interpreted machine for each story
    machine.onEvent(event => logger.info(event.type)).start(state);
    storiesOf('Workflows / Close And Withdraw', module).add(
      state.toString(),
      renderComponentInFrontOfApp(<CloseLedgerAndWithdraw service={machine} />)
    );
    machine.stop(); // the machine will be stopped before it can be transitioned. This means the logger throws a warning that we sent an event to a stopped machine.
  });
}
