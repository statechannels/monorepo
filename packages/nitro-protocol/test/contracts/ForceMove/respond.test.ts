import {expectRevert} from '@statechannels/devtools';
import {Contract, Wallet} from 'ethers';
import {HashZero} from 'ethers/constants';
import {bigNumberify, defaultAbiCoder, hexlify} from 'ethers/utils';
// @ts-ignore
import countingAppArtifact from '../../../build/contracts/CountingApp.json';
// @ts-ignore
import ForceMoveArtifact from '../../../build/contracts/TESTForceMove.json';
import {Channel, getChannelId} from '../../../src/contract/channel';
import {hashChannelStorage} from '../../../src/contract/channel-storage';
import {Outcome} from '../../../src/contract/outcome';
import {hashState, State} from '../../../src/contract/state';
import {respondArgs} from '../../../src/contract/transaction-creators/force-move';
import {
  NO_ONGOING_CHALLENGE,
  RESPONSE_UNAUTHORIZED,
  WRONG_CHANNEL_STORAGE,
} from '../../../src/contract/transaction-creators/revert-reasons';
import {getNetworkMap, getTestProvider, setupContracts, sign} from '../../test-helpers';

const provider = getTestProvider();
let ForceMove: Contract;
let networkId;
let networkMap;
const chainId = '0x1234';
const participants = ['', '', ''];
const wallets = new Array(3);
const challengeDuration = 0x1000;
const assetHolderAddress = Wallet.createRandom().address;
const outcome: Outcome = [{assetHolderAddress, allocation: []}];
let appDefinition;

// populate wallets and participants array
for (let i = 0; i < 3; i++) {
  wallets[i] = Wallet.createRandom();
  participants[i] = wallets[i].address;
}
const nonParticipant = Wallet.createRandom();

beforeAll(async () => {
  networkMap = await getNetworkMap();
  ForceMove = await setupContracts(provider, ForceMoveArtifact);
  networkId = (await provider.getNetwork()).chainId;
  appDefinition = networkMap[networkId][countingAppArtifact.contractName]; // use a fixed appDefinition in all tests
});

// Scenarios are synonymous with channelNonce:

const description1 = 'It accepts a respond tx for an ongoing challenge';
const description2 = 'It reverts a respond tx if the challenge has expired';
const description3 = 'It reverts a respond tx if the channel storage does not match';
const description4 = 'It reverts a respond tx if it is not signed by the correct participant';
const description5 =
  'It reverts a respond tx if the response state is not a validTransition from the challenge state';

describe('respond', () => {
  const turnNumRecord = 8;
  let channelNonce = 1000;
  const future = 1e12;
  const past = 1;
  beforeEach(() => (channelNonce += 1));
  it.each`
    description     | finalizesAt | slotEmpty | isFinalAB         | appDatas  | challenger    | responder         | reasonString
    ${description1} | ${future}   | ${false}  | ${[false, false]} | ${[0, 1]} | ${wallets[2]} | ${wallets[0]}     | ${undefined}
    ${description2} | ${past}     | ${false}  | ${[false, false]} | ${[0, 1]} | ${wallets[2]} | ${wallets[0]}     | ${NO_ONGOING_CHALLENGE}
    ${description3} | ${future}   | ${true}   | ${[false, false]} | ${[0, 1]} | ${wallets[2]} | ${wallets[0]}     | ${WRONG_CHANNEL_STORAGE}
    ${description4} | ${future}   | ${false}  | ${[false, false]} | ${[0, 1]} | ${wallets[2]} | ${nonParticipant} | ${RESPONSE_UNAUTHORIZED}
    ${description5} | ${future}   | ${false}  | ${[false, false]} | ${[0, 0]} | ${wallets[2]} | ${wallets[0]}     | ${'CountingApp: Counter must be incremented'}
  `(
    '$description', // for the purposes of this test, chainId and participants are fixed, making channelId 1-1 with channelNonce
    async ({isFinalAB, appDatas, challenger, responder, finalizesAt, slotEmpty, reasonString}) => {
      const channel: Channel = {chainId, channelNonce: hexlify(channelNonce), participants};
      const channelId = getChannelId(channel);

      const challengeState: State = {
        turnNum: turnNumRecord,
        isFinal: isFinalAB[0],
        channel,
        outcome,
        appData: defaultAbiCoder.encode(['uint256'], [appDatas[0]]),
        appDefinition,
        challengeDuration,
      };

      const responseState: State = {
        turnNum: turnNumRecord + 1,
        isFinal: isFinalAB[1],
        channel,
        outcome,
        appData: defaultAbiCoder.encode(['uint256'], [appDatas[1]]),
        appDefinition,
        challengeDuration,
      };
      const responseStateHash = hashState(responseState);

      const challengeExistsHash = slotEmpty
        ? HashZero
        : hashChannelStorage({
            turnNumRecord,
            finalizesAt,
            state: challenger ? challengeState : undefined,
            challengerAddress: challenger.address,
            outcome,
          });

      // call public wrapper to set state (only works on test contract)
      await (await ForceMove.setChannelStorageHash(channelId, challengeExistsHash)).wait();
      expect(await ForceMove.channelStorageHashes(channelId)).toEqual(challengeExistsHash);

      // sign the state
      const responseSignature = await sign(responder, responseStateHash);

      const tx = ForceMove.respond(
        ...respondArgs({challengeState, responseSignature, responseState})
      );

      if (reasonString) {
        await expectRevert(() => tx, reasonString);
      } else {
        const receipt = await (await tx).wait();
        const event = receipt.events.pop();

        expect(event.args).toMatchObject({
          channelId,
          newTurnNumRecord: bigNumberify(turnNumRecord + 1),
        });

        // compute and check new expected ChannelStorageHash

        const expectedChannelStorageHash = hashChannelStorage({
          turnNumRecord: turnNumRecord + 1,
          finalizesAt: 0,
        });
        expect(await ForceMove.channelStorageHashes(channelId)).toEqual(expectedChannelStorageHash);
      }
    }
  );
});
