import {storiesOf} from '@storybook/react';
import {interpret} from 'xstate';
import React from 'react';
import {
  DomainBudget,
  Participant,
  ethBudget,
  BN,
  Zero,
  makeAddress
} from '@statechannels/wallet-core';
import {utils} from 'ethers';

import {logger} from '../../logger';
import {Store} from '../../store';
import {MessagingServiceInterface, MessagingService} from '../../messaging';
import {ApproveBudgetAndFund} from '../approve-budget-and-fund-workflow';
import {machine as approveBudgetAndFundWorkflow} from '../../workflows/approve-budget-and-fund';

import {renderComponentInFrontOfApp} from './helpers';

const store = new Store();

store.initialize(['0x8624ebe7364bb776f891ca339f0aaa820cc64cc9fca6a28eec71e6d8fc950f29']);
const messagingService: MessagingServiceInterface = new MessagingService(store);

const budget: DomainBudget = ethBudget('web3torrent.statechannels.org', {
  availableReceiveCapacity: BN.from(utils.parseEther('0.05')),
  availableSendCapacity: BN.from(utils.parseEther('0.05'))
});

const alice: Participant = {
  participantId: 'a',
  signingAddress: makeAddress('0x1000000000000000000000000000000000000001'),
  destination: '0xad' as any
};

const hub: Participant = {
  participantId: 'b',
  signingAddress: makeAddress('0x1000000000000000000000000000000000000002'),
  destination: '0xbd' as any
};

const addStory = (name, value, context) => {
  const workflow = approveBudgetAndFundWorkflow(store, messagingService, context);
  const service = interpret(workflow, {devTools: true}); // start a new interpreted machine for each story
  service.onEvent(event => logger.info(event.type)).start(value);
  storiesOf('Workflows / Approve Budget And Fund', module).add(
    name,
    renderComponentInFrontOfApp(<ApproveBudgetAndFund service={service} />)
  );
  service.stop(); // the machine will be stopped before it can be transitioned. This means the logger.info on L49 throws a warning that we sent an event to a stopped machine.
};

const testContext = {
  budget,
  requestId: 55,
  player: alice,
  hub
};
const contextWithLedger = {...testContext, ledgerId: 'ledger123', ledgerState: {}};
const contextWithDeposit = {
  ...contextWithLedger,
  depositAt: BN.from(5),
  totalAfterDeposit: BN.from(10),
  fundedAt: BN.from(12)
};

const contextWaitTurn = {
  ...contextWithDeposit,
  ledgerTotal: Zero,
  lastChangeBlockNum: 9792500,
  currentBlockNum: 9792500
};
const contextSubmitTransaction = {...contextWaitTurn, ledgerTotal: BN.from(5)};
const contextWaitMining = {...contextSubmitTransaction, transactionId: 'transaction-123'};
const contextWaitFullyFunded = {...contextWaitTurn, ledgerTotal: BN.from(10)};

addStory('waitForUserApproval', 'waitForUserApproval', testContext);
addStory('createLedger', 'createLedger', testContext);
addStory('createBudget', 'createBudget', testContext);
addStory('waitForPreFS', 'waitForPreFS', contextWithLedger);
addStory('deposit.init', {deposit: 'init'}, contextWithDeposit);
addStory('deposit.waitTurn', {deposit: 'waitTurn'}, contextWaitTurn);
addStory('deposit.submitTransaction', {deposit: 'submitTransaction'}, contextSubmitTransaction);
addStory('deposit.retry', {deposit: 'retry'}, contextSubmitTransaction);
addStory('deposit.waitMining', {deposit: 'waitMining'}, contextWaitMining);
addStory('deposit.waitFullyFunded', {deposit: 'waitFullyFunded'}, contextWaitFullyFunded);
