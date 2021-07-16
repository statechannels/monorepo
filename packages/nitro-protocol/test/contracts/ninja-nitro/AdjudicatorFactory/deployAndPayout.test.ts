import {expectRevert} from '@statechannels/devtools';
import {Contract, Wallet, ethers, BigNumber, constants} from 'ethers';

import SingleChannelAdjudicatorArtifact from '../../../../artifacts/contracts/ninja-nitro/SingleChannelAdjudicator.sol/SingleChannelAdjudicator.json';
import AdjudicatorFactoryArtifact from '../../../../artifacts/contracts/ninja-nitro/AdjudicatorFactory.sol/AdjudicatorFactory.json';
import TokenArtifact from '../../../../artifacts/contracts/Token.sol/Token.json';
import {Channel, getChannelId} from '../../../../src/contract/channel';
import {AllocationAssetOutcome} from '../../../../src/contract/outcome';
import {State} from '../../../../src/contract/state';
import {concludePushOutcomeAndTransferAllArgs} from '../../../../src/contract/transaction-creators/nitro-adjudicator';
import {
  compileEventsFromLogs,
  computeOutcome,
  getPlaceHolderContractAddress,
  getRandomNonce,
  getTestProvider,
  OutcomeShortHand,
  randomChannelId,
  randomExternalDestination,
  replaceAddressesAndBigNumberify,
  setupContract,
} from '../../../test-helpers';
import {convertBytes32ToAddress, signStates} from '../../../../src';
import {NITRO_MAX_GAS} from '../../../../src/transactions';

const provider = getTestProvider();
let AdjudicatorFactory: Contract;
let Token: Contract;
const chainId = process.env.CHAIN_NETWORK_ID;
const participants: string[] = [];
const wallets: Wallet[] = [];
const challengeDuration = 0x1000;

let appDefinition: string;

const addresses = {
  // Channels
  c: undefined,
  C: randomChannelId(),
  X: randomChannelId(),
  // Externals
  A: randomExternalDestination(),
  B: randomExternalDestination(),
  // // Externals preloaded with TOK (cheaper to pay to)
  At: randomExternalDestination(),
  Bt: randomExternalDestination(),
  // Asset Holders
  ETH: undefined,
  ETH2: undefined,
  ERC20: undefined,
};

/*const tenPayouts = {ERC20: {}};
const fiftyPayouts = {ERC20: {}};
const oneHundredPayouts = {ERC20: {}};

for (let i = 0; i < 100; i++) {
  const destination = randomExternalDestination();
  addresses[i.toString()] = destination;
  if (i < 10) tenPayouts.ERC20[i.toString()] = 1;
  if (i < 50) fiftyPayouts.ERC20[i.toString()] = 1;
  if (i < 100) oneHundredPayouts.ERC20[i.toString()] = 1;
}*/

// Populate wallets and participants array
for (let i = 0; i < 3; i++) {
  const rWallet = Wallet.createRandom();
  wallets.push(rWallet);
  participants.push(rWallet.address);
}
beforeAll(async () => {
  appDefinition = getPlaceHolderContractAddress();
  Token = await setupContract(provider, TokenArtifact, process.env.TEST_TOKEN_ADDRESS);
  AdjudicatorFactory = await setupContract(
    provider,
    AdjudicatorFactoryArtifact,
    process.env.ADJUDICATOR_FACTORY_ADDRESS
  );
  // Preload At and Bt with TOK
  await (await Token.transfer('0x' + addresses.At.slice(26), BigNumber.from(1))).wait();
  await (await Token.transfer('0x' + addresses.Bt.slice(26), BigNumber.from(1))).wait();
});

const accepts1 = '{ETH: {A: 1}}';
const accepts4 = '{ERC20: {A: 1}}';

const oneState = {
  whoSignedWhat: [0, 0, 0],
  appData: [ethers.constants.HashZero],
};
const turnNumRecord = 5;
let channelNonce = getRandomNonce('deployAndPayout');
describe('deployAndPayout', () => {
  beforeEach(() => (channelNonce += 1));
  it.each`
    description | outcomeShortHand   | heldBefore         | heldAfter          | newOutcome | payouts            | reasonString
    ${accepts1} | ${{ETH: {A: 1}}}   | ${{ETH: {c: 1}}}   | ${{ETH: {c: 0}}}   | ${{}}      | ${{ETH: {A: 1}}}   | ${undefined}
    ${accepts4} | ${{ERC20: {A: 1}}} | ${{ERC20: {c: 1}}} | ${{ERC20: {c: 0}}} | ${{}}      | ${{ERC20: {A: 1}}} | ${undefined}
  `(
    '$description', // For the purposes of this test, chainId and participants are fixed, making channelId 1-1 with channelNonce
    async ({
      outcomeShortHand,
      heldBefore,
      heldAfter,
      newOutcome,
      payouts,
      reasonString,
    }: {
      description: string;
      outcomeShortHand: OutcomeShortHand;
      initialFingerprint;
      heldBefore: OutcomeShortHand;
      heldAfter: OutcomeShortHand;
      newOutcome: OutcomeShortHand;
      payouts: OutcomeShortHand;
      reasonString;
    }) => {
      const channel: Channel = {chainId, participants, channelNonce};
      const channelId = getChannelId(channel);
      const adjudicatorAddress = await AdjudicatorFactory.getChannelAddress(channelId);
      const SingleChannelAdjudicator = await setupContract(
        provider,
        SingleChannelAdjudicatorArtifact,
        adjudicatorAddress
      );
      addresses.c = channelId;
      addresses.ETH = constants.AddressZero;
      addresses.ERC20 = Token.address; // this matches the changes made to the contract
      const support = oneState;
      const {appData, whoSignedWhat} = support;
      const numStates = appData.length;
      const largestTurnNum = turnNumRecord + 1;

      // Transfer some tokens into the relevant AssetHolder
      // Do this step before transforming input data (easier)
      if ('ERC20' in heldBefore) {
        const {gasUsed} = await (
          await Token.transfer(SingleChannelAdjudicator.address, heldBefore.ERC20.c)
        ).wait();
        console.log('spent gas depositing tokens: ' + gasUsed);
      }
      if ('ETH' in heldBefore) {
        const {gasUsed} = await (
          await provider.getSigner().sendTransaction({
            to: SingleChannelAdjudicator.address,
            value: heldBefore.ETH.c,
          })
        ).wait();
        console.log('spent gas depositing ETH: ' + gasUsed);
      }

      // Transform input data (unpack addresses and BigNumberify amounts)
      [heldBefore, outcomeShortHand, newOutcome, heldAfter, payouts] = [
        heldBefore,
        outcomeShortHand,
        newOutcome,
        heldAfter,
        payouts,
      ].map(object => replaceAddressesAndBigNumberify(object, addresses) as OutcomeShortHand);

      const balancesBefore: OutcomeShortHand = {};
      for (const asset in payouts) {
        balancesBefore[asset] = {};
        if (BigNumber.from(0).eq(asset)) {
          // Asset is ETH
          for (const payee in payouts[asset]) {
            balancesBefore[asset][payee] = await provider.getBalance(
              convertBytes32ToAddress(payee)
            );
          }
        } else {
          // Asset is ERC20
          for (const payee in payouts[asset]) {
            balancesBefore[asset][payee] = await Token.balanceOf(convertBytes32ToAddress(payee));
          }
        }
      }

      // Compute the outcome.
      const outcome: AllocationAssetOutcome[] = computeOutcome(outcomeShortHand);

      // Construct states
      const states: State[] = [];
      for (let i = 1; i <= numStates; i++) {
        states.push({
          isFinal: true,
          channel,
          outcome,
          appDefinition,
          appData: appData[i - 1],
          challengeDuration,
          turnNum: largestTurnNum + i - numStates,
        });
      }

      // Call public wrapper to set state (only works on test contract)
      //   await (await NitroAdjudicator.setStatus(channelId, initialFingerprint)).wait();
      //   expect(await NitroAdjudicator.statusOf(channelId)).toEqual(initialFingerprint);

      // Sign the states
      const sigs = await signStates(states, wallets, whoSignedWhat);

      // Form transaction

      const tx = AdjudicatorFactory.createAndPayout(
        channelId,
        ...concludePushOutcomeAndTransferAllArgs(states, sigs, whoSignedWhat),
        {gasLimit: 3000000}
      );

      // Switch on overall test expectation
      if (reasonString) {
        await expectRevert(() => tx, reasonString);
      } else {
        const receipt = await (await tx).wait();

        console.log('gas used: ' + receipt.gasUsed);
        expect(BigNumber.from(receipt.gasUsed).lt(BigNumber.from(NITRO_MAX_GAS))).toBe(true);

        // Check that the EOAs have the right balance
        for (const asset in payouts) {
          for (const payee in payouts[asset]) {
            const assetBeforeBalance: BigNumber = BigNumber.from(balancesBefore[asset][payee]);
            const expectedAssetBalance = assetBeforeBalance.add(payouts[asset][payee]);
            let finalBalance: BigNumber;

            if (BigNumber.from(0).eq(asset)) {
              // Asset is ETH
              finalBalance = await provider.getBalance(convertBytes32ToAddress(payee));
            } else {
              // Asset is an ERC20 Token
              finalBalance = await Token.balanceOf(convertBytes32ToAddress(payee));
            }

            expect(finalBalance.eq(expectedAssetBalance)).toBe(true);
          }
        }

        // Compute expected ChannelDataHash

        // Extract logs
        const {logs} = await (await tx).wait();

        // Compile events from logs
        const events = compileEventsFromLogs(logs, [SingleChannelAdjudicator]);

        // Compile event expectations

        const expectedEvents = [];

        // Add Conclude event to expectations
        expectedEvents.push({
          contract: SingleChannelAdjudicator.address,
          name: 'Concluded',
          args: {channelId},
        });

        // Check that each expectedEvent is contained as a subset of the properies of each *corresponding* event: i.e. the order matters!
        expect(events).toMatchObject(expectedEvents);

        // Check new holdings on each AssetHolder
        // checkMultipleHoldings(heldAfter, [EthAssetHolder1, EthAssetHolder2, ERC20AssetHolder]);

        // Check new assetOutcomeHash on each AssetHolder
        //     checkMultipleAssetOutcomeHashes(channelId, newOutcome, [
        //       EthAssetHolder1,
        //       EthAssetHolder2,
        //       ERC20AssetHolder,
        //     ]);
      }
    }
  );
});
