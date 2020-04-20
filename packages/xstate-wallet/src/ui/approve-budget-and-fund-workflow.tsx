import React from 'react';
import './wallet.scss';
import {ApproveBudgetAndFundService} from '../workflows/approve-budget-and-fund';
import {useService} from '@xstate/react';

import {formatEther} from 'ethers/utils';
import {Button, Heading, Flex, Text, Box, Link} from 'rimble-ui';
import {getAmountsFromBudget} from './selectors';

interface Props {
  service: ApproveBudgetAndFundService;
}

export const ApproveBudgetAndFund = (props: Props) => {
  const [current, send] = useService(props.service);
  const {budget} = current.context;
  const {playerAmount, hubAmount} = getAmountsFromBudget(budget);

  const waitForUserApproval = ({waiting}: {waiting: boolean} = {waiting: false}) => (
    <Flex alignItems="left" flexDirection="column">
      <Heading textAlign="center" mb={0}>
        App Budget
      </Heading>
      <Heading textAlign="center" as="h4" mt={0} mb={2}>
        {budget.domain}
      </Heading>

      <Text fontSize={1} pb={2}>
        Approve budget for <strong>{budget.domain}</strong>?
      </Text>

      <Flex justifyContent="center" pb={2}>
        <Box>
          <Text>Send: {formatEther(playerAmount)} ETH</Text>
          <Text>Receive: {formatEther(hubAmount)} ETH</Text>
        </Box>
      </Flex>
      <Text fontSize={1} pb={2}>
        The app will have full control to manage these funds on your behalf.
      </Text>
      <Text pb={3} fontSize={1}>
        You will need to deposit {formatEther(playerAmount)} ETH into a channel with a state channel
        hub.
      </Text>
      <Button
        disabled={waiting}
        onClick={() => send('USER_APPROVES_BUDGET')}
        className="approve-budget-button"
      >
        Approve budget
      </Button>
      <Button.Text onClick={() => send('USER_REJECTS_BUDGET')}>Cancel</Button.Text>
    </Flex>
  );

  const waitForPreFS = (
    <Flex alignItems="center" flexDirection="column">
      <Heading>Deposit funds</Heading>

      <Text textAlign="center">Waiting for the hub to respond.</Text>
    </Flex>
  );

  const depositInit = (
    <Flex alignItems="center" flexDirection="column">
      <Heading>Deposit funds</Heading>

      <Text textAlign="center">Querying blockchain</Text>
    </Flex>
  );

  const depositWaitTurn = (
    <Flex alignItems="center" flexDirection="column">
      <Heading>Deposit funds</Heading>

      <Text textAlign="center">Waiting for hub to deposit</Text>
    </Flex>
  );

  const depositSubmitTransaction = (
    <Flex alignItems="center" flexDirection="column">
      <Heading>Deposit funds</Heading>

      <Text textAlign="center" id="please-approve-transaction">
        Please approve the transaction in metamask
      </Text>
    </Flex>
  );

  const depositWaitMining = ({transactionId}: {transactionId: string}) => (
    <Flex alignItems="center" flexDirection="column">
      <Heading>Deposit funds</Heading>

      <Text pb={2}>Waiting for your transaction to be mined.</Text>

      <Text>
        Click <Link href={`https://etherscan.io/tx/${transactionId}`}>here</Link> to follow the
        progress on etherscan.
      </Text>
    </Flex>
  );

  const depositRetry = () => (
    <Flex alignItems="left" justifyContent="space-between" flexDirection="column">
      <Heading textAlign="center">Deposit Funds</Heading>

      <Text pb={4}>Your deposit transaction failed. Do you want to retry?</Text>

      <Button onClick={() => send('USER_APPROVES_RETRY')}>Resubmit transaction</Button>
      <Button.Text onClick={() => send('USER_REJECTS_RETRY')}>Cancel</Button.Text>
    </Flex>
  );

  // in the current setup, the hub deposits first, so this should never be shown
  const depositFullyFunded = (
    <Flex alignItems="center" flexDirection="column">
      <Heading>Deposit funds</Heading>

      <Text textAlign="center">Waiting for hub to deposit</Text>
    </Flex>
  );

  if (current.matches('waitForUserApproval')) {
    return waitForUserApproval();
  } else if (current.matches('createBudgetAndLedger')) {
    return waitForUserApproval({waiting: true});
  } else if (current.matches('waitForPreFS')) {
    return waitForPreFS;
  } else if (current.matches({deposit: 'init'})) {
    return depositInit;
  } else if (current.matches({deposit: 'waitTurn'})) {
    return depositWaitTurn;
  } else if (current.matches({deposit: 'submitTransaction'})) {
    return depositSubmitTransaction;
  } else if (current.matches({deposit: 'waitMining'})) {
    return depositWaitMining(current.context);
  } else if (current.matches({deposit: 'retry'})) {
    return depositRetry();
  } else if (current.matches({deposit: 'waitFullyFunded'})) {
    return depositFullyFunded;
  } else if (current.matches('done')) {
    // workflow hides ui, so user shouldn't ever see this
    return <div>Success! Returning to app..</div>;
  } else if (current.matches('failure')) {
    // workflow hides ui, so user shouldn't ever see this
    return <div>Failed :(. Returning to app..</div>;
  } else {
    return <div>Todo</div>;
  }
};
