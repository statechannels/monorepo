import {ethers} from 'ethers';
import {expectRevert} from 'magmo-devtools';
// @ts-ignore
import OptimizedForceMoveArtifact from '../../build/contracts/TESTOptimizedForceMove.json';
// @ts-ignore
import countingAppArtifact from '../../build/contracts/CountingApp.json';
import {keccak256, defaultAbiCoder, hexlify} from 'ethers/utils';
import {setupContracts, sign, newChallengeClearedEvent} from './test-helpers';
import {HashZero, AddressZero} from 'ethers/constants';

const provider = new ethers.providers.JsonRpcProvider(
  `http://localhost:${process.env.DEV_GANACHE_PORT}`,
);
let OptimizedForceMove: ethers.Contract;
let networkId;
const chainId = 1234;
const participants = ['', '', ''];
const wallets = new Array(3);
const challengeDuration = 1000;
const outcome = ethers.utils.id('some outcome data'); // use a fixed outcome for all state updates in all tests
const outcomeHash = keccak256(defaultAbiCoder.encode(['bytes'], [outcome]));
let appDefinition;

// populate wallets and participants array
for (let i = 0; i < 3; i++) {
  wallets[i] = ethers.Wallet.createRandom();
  participants[i] = wallets[i].address;
}
beforeAll(async () => {
  OptimizedForceMove = await setupContracts(provider, OptimizedForceMoveArtifact);
  networkId = (await provider.getNetwork()).chainId;
  appDefinition = countingAppArtifact.networks[networkId].address; // use a fixed appDefinition in all tests
});

// Scenarios are synonymous with channelNonce:

const description1 =
  'It accepts a valid concludeFromOpen tx and sets the channel storage correctly';

describe('respondWithAlternative', () => {
  it.each`
    description     | channelNonce | declaredTurnNumRecord | initialChannelStorageHash | largestTurnNum | whoSignedWhat | reasonString
    ${description1} | ${401}       | ${0}                  | ${HashZero}               | ${8}           | ${[0, 1, 2]}  | ${undefined}
  `(
    '$description', // for the purposes of this test, chainId and participants are fixed, making channelId 1-1 with channelNonce
    async ({
      channelNonce,
      declaredTurnNumRecord,
      initialChannelStorageHash,
      largestTurnNum,
      whoSignedWhat,
      reasonString,
    }) => {
      // compute channelId
      const channelId = keccak256(
        defaultAbiCoder.encode(
          ['uint256', 'address[]', 'uint256'],
          [chainId, participants, channelNonce],
        ),
      );
      // fixedPart
      const fixedPart = {
        chainId,
        participants,
        channelNonce,
        appDefinition,
        challengeDuration,
      };

      const appPartHash = keccak256(
        defaultAbiCoder.encode(
          ['uint256', 'address'], // note lack of appData
          [challengeDuration, appDefinition],
        ),
      );

      // compute stateHashes
      // const variableParts = new Array(wallets.length);
      const stateHashes = new Array(wallets.length);
      for (let i = 0; i < wallets.length; i++) {
        const state = {
          turnNum: largestTurnNum - i,
          isFinal: true,
          channelId,
          appPartHash,
          outcomeHash,
        };
        stateHashes[i] = keccak256(
          defaultAbiCoder.encode(
            [
              'tuple(uint256 turnNum, bool isFinal, bytes32 channelId, bytes32 appPartHash, bytes32 outcomeHash)',
            ],
            [state],
          ),
        );
      }

      // call public wrapper to set state (only works on test contract)
      const tx = await OptimizedForceMove.setChannelStorageHash(
        channelId,
        initialChannelStorageHash,
      );
      await tx.wait();
      expect(await OptimizedForceMove.channelStorageHashes(channelId)).toEqual(
        initialChannelStorageHash,
      );

      // sign the states
      const sigs = new Array(participants.length);
      for (let i = 0; i < participants.length; i++) {
        const sig = await sign(wallets[i], stateHashes[whoSignedWhat[i]]);
        sigs[i] = {v: sig.v, r: sig.r, s: sig.s};
      }

      // call method in a slightly different way if expecting a revert
      if (reasonString) {
        const regex = new RegExp(
          '^' + 'VM Exception while processing transaction: revert ' + reasonString + '$',
        );
        await expectRevert(
          () =>
            OptimizedForceMove.concludeFromOpen(
              declaredTurnNumRecord,
              largestTurnNum,
              fixedPart,
              appPartHash,
              outcomeHash,
              whoSignedWhat,
              sigs,
            ),
          regex,
        );
      } else {
        const tx2 = await OptimizedForceMove.concludeFromOpen(
          declaredTurnNumRecord,
          largestTurnNum,
          fixedPart,
          appPartHash,
          outcomeHash,
          whoSignedWhat,
          sigs,
        );

        // wait for tx to be mined
        await tx2.wait();

        // compute expected ChannelStorageHash
        const blockNumber = await provider.getBlockNumber();
        const blockTimestamp = (await provider.getBlock(blockNumber)).timestamp;
        const expectedChannelStorage = [0, blockTimestamp, HashZero, AddressZero, outcomeHash];
        const expectedChannelStorageHash = keccak256(
          defaultAbiCoder.encode(
            ['uint256', 'uint256', 'bytes32', 'address', 'bytes32'],
            expectedChannelStorage,
          ),
        );

        // check channelStorageHash against the expected value
        expect(await OptimizedForceMove.channelStorageHashes(channelId)).toEqual(
          expectedChannelStorageHash,
        );
      }
    },
  );
});
