// @ts-ignore

import {expectRevert} from '@statechannels/devtools';
import {Contract} from 'ethers';
import {AddressZero, HashZero} from 'ethers/constants';
import {TransactionRequest} from 'ethers/providers';
import ConsensusAppArtifact from '../../../build/contracts/ConsensusApp.json';
import {validTransition} from '../../../src/contract/consensus-app';
import {ConsensusData} from '../../../src/contract/consensus-data';
import {Outcome} from '../../../src/contract/outcome';
import {createValidTransitionTransaction} from '../../../src/contract/transaction-creators/consensus-app';
import {getTestProvider, setupContracts} from '../../test-helpers';

const provider = getTestProvider();
let consensusApp: Contract;

const numParticipants = 3;

beforeAll(async () => {
  consensusApp = await setupContracts(provider, ConsensusAppArtifact);
});

describe('validTransition', () => {
  it.each`
    isValid  | votesReqd | outcomes          | proposedOutcomes  | description
    ${true}  | ${[0, 2]} | ${['0x1', '0x1']} | ${['0x1', '0x2']} | ${'valid consensus -> propose'}
    ${false} | ${[0, 1]} | ${['0x1', '0x1']} | ${['0x1', '0x2']} | ${'invalid consensus -> propose: votesReqd too low'}
    ${true}  | ${[2, 1]} | ${['0x1', '0x1']} | ${['0x2', '0x2']} | ${'valid vote'}
    ${false} | ${[1, 1]} | ${['0x1', '0x1']} | ${['0x2', '0x2']} | ${'invalid vote: votesReqd not decreased'}
    ${true}  | ${[1, 2]} | ${['0x1', '0x1']} | ${['0x2', '0x1']} | ${'valid veto'}
    ${true}  | ${[2, 2]} | ${['0x1', '0x1']} | ${['0x2', '0x2']} | ${'valid pass'}
    ${true}  | ${[1, 0]} | ${['0x1', '0x2']} | ${['0x2', '0x']}  | ${'valid finalVote'}
    ${false} | ${[1, 0]} | ${['0x1', '0x3']} | ${['0x2', '0x']}  | ${'invalid finalVote: proposedOutcome1 ≠ currentOutcome2'}
  `(
    '$description',
    async ({
      isValid,
      outcomes,
      proposedOutcomes,
      votesReqd,
    }: {
      isValid: boolean;
      outcomes: string[];
      proposedOutcomes: string[];
      votesReqd: number[];
    }) => {
      const fromConsensusData: ConsensusData = {
        furtherVotesRequired: votesReqd[0],
        proposedOutcome: createOutcome(proposedOutcomes[0]),
      };
      const fromOutcome = createOutcome(outcomes[0]);

      const toConsensusData: ConsensusData = {
        furtherVotesRequired: votesReqd[1],
        proposedOutcome: createOutcome(proposedOutcomes[1]),
      };
      const toOutcome = createOutcome(outcomes[1]);

      const transactionRequest = createValidTransitionTransaction(
        fromConsensusData,
        fromOutcome,
        toConsensusData,
        toOutcome,
        numParticipants
      );
      if (isValid) {
        // Send a transaction, so we can measure gas consumption
        await sendTransaction(consensusApp.address, transactionRequest);

        // Just call the function, so we can check the return value easily
        const isValidFromCall = validTransition(
          fromConsensusData,
          fromOutcome,
          toConsensusData,
          toOutcome,
          numParticipants
        );
        expect(isValidFromCall).toBe(true);
      } else {
        await expectRevert(() => sendTransaction(consensusApp.address, transactionRequest));
      }
    }
  );
});

async function sendTransaction(contractAddress: string, transaction: TransactionRequest) {
  // TODO import from test-helpers instead (does not yet exist pending rebase or merge)
  const signer = provider.getSigner(2);
  const response = await signer.sendTransaction({to: contractAddress, ...transaction});
  await response.wait();
}

function createOutcome(amount: string): Outcome {
  return [
    {
      assetHolderAddress: AddressZero,
      allocation: [{destination: HashZero, amount}],
    },
  ];
}
