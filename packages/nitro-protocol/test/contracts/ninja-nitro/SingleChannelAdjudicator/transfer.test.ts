import {expectRevert} from '@statechannels/devtools';
import {Contract, BigNumber, utils, Wallet, constants} from 'ethers';

import {getFixedPart, hashAppPart, State} from '../../../../src/contract/state';

import SingleChannelAdjudicatorArtifact from '../../../../artifacts/contracts/ninja-nitro/SingleChannelAdjudicator.sol/SingleChannelAdjudicator.json';
import AdjudicatorFactoryArtifact from '../../../../artifacts/contracts/ninja-nitro/AdjudicatorFactory.sol/AdjudicatorFactory.json';
import {
  allocationToParams,
  getRandomNonce,
  getTestProvider,
  randomChannelId,
  randomExternalDestination,
  replaceAddressesAndBigNumberify,
  setupContracts,
  writeGasConsumption,
} from '../../../test-helpers';

import {
  Channel,
  convertBytes32ToAddress,
  encodeOutcome,
  getChannelId,
  hashOutcome,
  Outcome,
  signState,
  signStates,
} from '../../../../src';
import {getPlaceHolderContractAddress} from '../../../test-helpers';

const provider = getTestProvider();

let AdjudicatorFactory: Contract;

const chainId = process.env.CHAIN_NETWORK_ID;
const participants = ['', ''];
const wallets = new Array<Wallet>(2);
for (let i = 0; i < 2; i++) {
  wallets[i] = Wallet.createRandom();
  participants[i] = wallets[i].address;
}

const addresses = {
  // Channels
  c: undefined,
  C: randomExternalDestination(),
  X: randomExternalDestination(),
  // Externals
  A: randomExternalDestination(),
  B: randomExternalDestination(),
};

beforeAll(async () => {
  AdjudicatorFactory = await setupContracts(
    provider,
    AdjudicatorFactoryArtifact,
    process.env.ADJUDICATOR_FACTORY_ADDRESS
  );
});

const reason0 = 'h(outcome)!=outcomeHash';
const reason1 = 'Indices must be sorted';

// c is the channel we are transferring from.
describe('transfer', () => {
  it.each`
    name                               | heldBefore | setOutcome            | indices      | newOutcome      | heldAfter       | payouts         | reason
    ${' 0. outcome not set         '}  | ${{c: 1}}  | ${{}}                 | ${[0]}       | ${{}}           | ${{}}           | ${{A: 1}}       | ${reason0}
    ${' 1. funded          -> 1 EOA'}  | ${{c: 1}}  | ${{A: 1}}             | ${[0]}       | ${{}}           | ${{}}           | ${{A: 1}}       | ${undefined}
    ${' 2. overfunded      -> 1 EOA'}  | ${{c: 2}}  | ${{A: 1}}             | ${[0]}       | ${{}}           | ${{c: 1}}       | ${{A: 1}}       | ${undefined}
    ${' 3. underfunded     -> 1 EOA'}  | ${{c: 1}}  | ${{A: 2}}             | ${[0]}       | ${{A: 1}}       | ${{}}           | ${{A: 1}}       | ${undefined}
    ${' 4. funded      -> 1 channel'}  | ${{c: 1}}  | ${{C: 1}}             | ${[0]}       | ${{}}           | ${{c: 0, C: 1}} | ${{}}           | ${undefined}
    ${' 5. overfunded  -> 1 channel'}  | ${{c: 2}}  | ${{C: 1}}             | ${[0]}       | ${{}}           | ${{c: 1, C: 1}} | ${{}}           | ${undefined}
    ${' 6. underfunded -> 1 channel'}  | ${{c: 1}}  | ${{C: 2}}             | ${[0]}       | ${{C: 1}}       | ${{c: 0, C: 1}} | ${{}}           | ${undefined}
    ${' 7. -> 2 EOA         1 index'}  | ${{c: 2}}  | ${{A: 1, B: 1}}       | ${[0]}       | ${{A: 0, B: 1}} | ${{c: 1}}       | ${{A: 1}}       | ${undefined}
    ${' 8. -> 2 EOA         1 index'}  | ${{c: 1}}  | ${{A: 1, B: 1}}       | ${[0]}       | ${{A: 0, B: 1}} | ${{c: 0}}       | ${{A: 1}}       | ${undefined}
    ${' 9. -> 2 EOA         partial'}  | ${{c: 3}}  | ${{A: 2, B: 2}}       | ${[1]}       | ${{A: 2, B: 1}} | ${{c: 2}}       | ${{B: 1}}       | ${undefined}
    ${'10. -> 2 chan             no'}  | ${{c: 1}}  | ${{C: 1, X: 1}}       | ${[1]}       | ${{C: 1, X: 1}} | ${{c: 1}}       | ${{}}           | ${undefined}
    ${'11. -> 2 chan           full'}  | ${{c: 1}}  | ${{C: 1, X: 1}}       | ${[0]}       | ${{C: 0, X: 1}} | ${{c: 0, C: 1}} | ${{}}           | ${undefined}
    ${'12. -> 2 chan        partial'}  | ${{c: 3}}  | ${{C: 2, X: 2}}       | ${[1]}       | ${{C: 2, X: 1}} | ${{c: 2, X: 1}} | ${{}}           | ${undefined}
    ${'13. -> 2 indices'}              | ${{c: 3}}  | ${{C: 2, X: 2}}       | ${[0, 1]}    | ${{C: 0, X: 1}} | ${{c: 0, X: 1}} | ${{C: 2}}       | ${undefined}
    ${'14. -> 3 indices'}              | ${{c: 5}}  | ${{A: 1, C: 2, X: 2}} | ${[0, 1, 2]} | ${{}}           | ${{c: 0, X: 2}} | ${{A: 1, C: 2}} | ${undefined}
    ${'15. -> reverse order (see 13)'} | ${{c: 3}}  | ${{C: 2, X: 2}}       | ${[1, 0]}    | ${{C: 2, X: 1}} | ${{c: 2, X: 1}} | ${{}}           | ${reason1}
  `(
    `$name: heldBefore: $heldBefore, setOutcome: $setOutcome, newOutcome: $newOutcome, heldAfter: $heldAfter, payouts: $payouts`,
    async ({name, heldBefore, setOutcome, indices, newOutcome, heldAfter, payouts, reason}) => {
      // Compute channelId
      const channelNonce = getRandomNonce(name);
      const channel: Channel = {chainId, participants, channelNonce};
      const channelId = getChannelId(channel);
      addresses.c = channelId;

      const adjudicatorAddress = await AdjudicatorFactory.getChannelAddress(channelId);
      const SingleChannelAdjudicator = await setupContracts(
        provider,
        SingleChannelAdjudicatorArtifact,
        adjudicatorAddress
      );

      // Transform input data (unpack addresses and BigNumberify amounts)
      heldBefore = replaceAddressesAndBigNumberify(heldBefore, addresses);
      setOutcome = replaceAddressesAndBigNumberify(setOutcome, addresses);
      newOutcome = replaceAddressesAndBigNumberify(newOutcome, addresses);
      heldAfter = replaceAddressesAndBigNumberify(heldAfter, addresses);
      payouts = replaceAddressesAndBigNumberify(payouts, addresses);

      // Fund the channel
      new Set([...Object.keys(heldAfter), ...Object.keys(heldBefore)]).forEach(async key => {
        // Key must be either in heldBefore or heldAfter or both
        const amount = heldBefore[key] ? heldBefore[key] : BigNumber.from(0);
        await (
          await provider.getSigner().sendTransaction({
            to: SingleChannelAdjudicator.address,
            value: amount,
          })
        ).wait();
      });

      // Compute an appropriate allocation.
      const allocation = [];
      Object.keys(setOutcome).forEach(key =>
        allocation.push({destination: key, amount: setOutcome[key]})
      );

      const outcome: Outcome = [
        {assetHolderAddress: constants.AddressZero, allocationItems: allocation},
      ];
      const [, assetOutcomeHash] = allocationToParams(allocation);

      // DEPLOY CHANNEL

      await (await AdjudicatorFactory.createChannel(channelId)).wait();

      console.log('created channel ');
      // CONCLUDE CHANNEL
      const states: State[] = [
        {
          isFinal: true,
          channel,
          outcome,
          appDefinition: constants.AddressZero,
          appData: '0x',
          challengeDuration: 0x1000,
          turnNum: 5,
        },
      ];
      const sigs = [
        signState(states[0], wallets[0].privateKey).signature,
        signState(states[0], wallets[1].privateKey).signature,
      ];
      console.log('signed states');
      await (
        await SingleChannelAdjudicator.conclude(
          5,
          getFixedPart(states[0]),
          hashAppPart(states[0]),
          hashOutcome(outcome),
          1,
          [0, 0],
          sigs
        )
      ).wait();

      console.log('concluded');

      const balancesBefore: Record<string, BigNumber> = {};
      Object.keys(payouts).forEach(async key => {
        balancesBefore[key] = await provider.getBalance(convertBytes32ToAddress(key));
      });

      // TRANSFER FROM CHANNEl

      const tx = SingleChannelAdjudicator.transfer(channelId, encodeOutcome(outcome), indices);
      // Call method in a slightly different way if expecting a revert
      if (reason) {
        await expectRevert(() => tx, reason);
      } else {
        const expectedEvents = [
          {
            event: 'AllocationUpdated',
            args: {channelId, initialHoldings: heldBefore[channelId]},
          },
        ];

        const {events: eventsFromTx, gasUsed} = await (await tx).wait();
        // NOTE: _transferAsset is a NOOP in TESTAssetHolder, so gas costs will be much lower than for a real Asset Holder
        await writeGasConsumption('transfer.gas.md', name, gasUsed);
        // expect(eventsFromTx).toMatchObject(expectedEvents);
        // TODO check EOAs have the right balance
        Object.keys(payouts).forEach(async key => {
          expect(
            (await provider.getBalance(convertBytes32ToAddress(key))).eq(
              balancesBefore[key].add(payouts[key])
            )
          ).toBe(true);
        });
        // TODO Check new assetOutcomeHash
      }
    }
  );
});
