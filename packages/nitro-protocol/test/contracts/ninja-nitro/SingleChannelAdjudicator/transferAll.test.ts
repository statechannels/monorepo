import {expectRevert} from '@statechannels/devtools';
import {Contract, BigNumber, constants, Wallet} from 'ethers';

import SingleChannelAdjudicatorArtifact from '../../../../artifacts/contracts/ninja-nitro/SingleChannelAdjudicator.sol/SingleChannelAdjudicator.json';
import AdjudicatorFactoryArtifact from '../../../../artifacts/contracts/ninja-nitro/AdjudicatorFactory.sol/AdjudicatorFactory.json';
import {
  getRandomNonce,
  getTestProvider,
  randomChannelId,
  randomExternalDestination,
  replaceAddressesAndBigNumberify,
  setupContract,
} from '../../../test-helpers';
import {encodeOutcome} from '../../../../src/contract/outcome';
import {
  Channel,
  channelDataToStatus,
  convertBytes32ToAddress,
  getChannelId,
  getFixedPart,
  hashAppPart,
  hashOutcome,
  Outcome,
  signState,
  State,
} from '../../../../src';

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
  C: randomChannelId(),
  X: randomChannelId(),
  // Externals
  A: randomExternalDestination(),
  B: randomExternalDestination(),
};

beforeAll(async () => {
  AdjudicatorFactory = await setupContract(
    provider,
    AdjudicatorFactoryArtifact,
    process.env.ADJUDICATOR_FACTORY_ADDRESS
  );
});

const reason0 = 'status(ChannelData)!=storage';

// c is the channel we are transferring from.
describe('transferAll (using transfer and empty indices array)', () => {
  it.each`
    name                              | heldBefore | setOutcome      | newOutcome      | heldAfter             | payouts         | reason
    ${' 0. outcome not set         '} | ${{c: 1}}  | ${{}}           | ${{}}           | ${{}}                 | ${{A: 1}}       | ${reason0}
    ${' 1. funded          -> 1 EOA'} | ${{c: 1}}  | ${{A: 1}}       | ${{A: 0}}       | ${{}}                 | ${{A: 1}}       | ${undefined}
    ${' 2. overfunded      -> 1 EOA'} | ${{c: 2}}  | ${{A: 1}}       | ${{A: 0}}       | ${{c: 1}}             | ${{A: 1}}       | ${undefined}
    ${' 3. underfunded     -> 1 EOA'} | ${{c: 1}}  | ${{A: 2}}       | ${{A: 1}}       | ${{}}                 | ${{A: 1}}       | ${undefined}
    ${' 4. funded      -> 1 channel'} | ${{c: 1}}  | ${{C: 1}}       | ${{C: 0}}       | ${{c: 0, C: 1}}       | ${{}}           | ${undefined}
    ${' 5. overfunded  -> 1 channel'} | ${{c: 2}}  | ${{C: 1}}       | ${{C: 0}}       | ${{c: 1, C: 1}}       | ${{}}           | ${undefined}
    ${' 6. underfunded -> 1 channel'} | ${{c: 1}}  | ${{C: 2}}       | ${{C: 1}}       | ${{c: 0, C: 1}}       | ${{}}           | ${undefined}
    ${' 7. -> 2 EOA       full/full'} | ${{c: 2}}  | ${{A: 1, B: 1}} | ${{A: 0, B: 0}} | ${{c: 0}}             | ${{A: 1, B: 1}} | ${undefined}
    ${' 8. -> 2 EOA         full/no'} | ${{c: 1}}  | ${{A: 1, B: 1}} | ${{A: 0, B: 1}} | ${{c: 0}}             | ${{A: 1}}       | ${undefined}
    ${' 9. -> 2 EOA    full/partial'} | ${{c: 3}}  | ${{A: 2, B: 2}} | ${{A: 0, B: 1}} | ${{c: 0}}             | ${{A: 2, B: 1}} | ${undefined}
    ${'10. -> 2 chan      full/full'} | ${{c: 2}}  | ${{C: 1, X: 1}} | ${{C: 0, X: 0}} | ${{c: 0, C: 1, X: 1}} | ${{}}           | ${undefined}
    ${'11. -> 2 chan        full/no'} | ${{c: 1}}  | ${{C: 1, X: 1}} | ${{C: 0, X: 1}} | ${{c: 0, C: 1, X: 0}} | ${{}}           | ${undefined}
    ${'12. -> 2 chan   full/partial'} | ${{c: 3}}  | ${{C: 2, X: 2}} | ${{C: 0, X: 1}} | ${{c: 0, C: 2, X: 1}} | ${{}}           | ${undefined}
  `(
    `$name: heldBefore: $heldBefore, setOutcome: $setOutcome, newOutcome: $newOutcome, heldAfter: $heldAfter, payouts: $payouts`,
    async ({name, heldBefore, setOutcome, newOutcome, heldAfter, payouts, reason}) => {
      // Compute channelId
      const channelNonce = getRandomNonce(name);
      const channel: Channel = {chainId, participants, channelNonce};
      const channelId = getChannelId(channel);
      addresses.c = channelId;
      const adjudicatorAddress = await AdjudicatorFactory.getChannelAddress(channelId);
      const SingleChannelAdjudicator = await setupContract(
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

      // DEPLOY CHANNEL

      await (await AdjudicatorFactory.createChannel(channelId)).wait();

      const turnNumRecord = 5;

      // CONCLUDE CHANNEL
      const outcome: Outcome = [
        {assetHolderAddress: constants.AddressZero, allocationItems: allocation},
      ];
      const states: State[] = [
        {
          isFinal: true,
          channel,
          outcome,
          appDefinition: constants.AddressZero,
          appData: '0x',
          challengeDuration: 0x1000,
          turnNum: turnNumRecord,
        },
      ];

      const sigs = [
        signState(states[0], wallets[0].privateKey).signature,
        signState(states[0], wallets[1].privateKey).signature,
      ];

      let blockNumber = 0;
      if (Object.keys(setOutcome).length > 0) {
        ({blockNumber} = await (
          await SingleChannelAdjudicator.conclude(
            turnNumRecord,
            getFixedPart(states[0]),
            hashAppPart(states[0]),
            hashOutcome(outcome),
            1,
            [0, 0],
            sigs
          )
        ).wait());
      }

      const finalizesAt = (await provider.getBlock(blockNumber)).timestamp;

      const balancesBefore: Record<string, BigNumber> = {};
      Object.keys(payouts).forEach(async key => {
        balancesBefore[key] = await provider.getBalance(convertBytes32ToAddress(key));
      });
      const emptyArray = [];
      const tx = SingleChannelAdjudicator.transfer(
        channelId,
        0, // when collaboratively concluding, turnNumRecord is set to zero
        finalizesAt,
        constants.HashZero, // when collaboratively concluding, stateHash is set to zero
        constants.AddressZero, // when collaboratively concluding, challengerAddress is set to zero
        encodeOutcome(outcome),
        emptyArray
      );

      // Call method in a slightly different way if expecting a revert
      if (reason) {
        await expectRevert(() => tx, reason);
      } else {
        await (await tx).wait();
        // TODO expect an 'OutcomeHashUpdated' event
        // const expectedEvents = [
        //   {
        //     event: 'OutcomeHashUpdated',
        //     args: {channelId, initialHoldings: heldBefore[channelId]},
        //   },
        // ];
        // expect(eventsFromLogs).toMatchObject(expectedEvents);

        // Check new outcomeHash
        const newAllocation = [];
        Object.keys(newOutcome).forEach(key =>
          newAllocation.push({destination: key, amount: newOutcome[key]})
        );
        const outcome: Outcome = [
          {assetHolderAddress: constants.AddressZero, allocationItems: newAllocation},
        ];

        const expectedFingerprint = channelDataToStatus({
          turnNumRecord: 0,
          finalizesAt,
          outcome,
        });

        // Check fingerprint against the expected value
        // NOTE that allocations for zero amounts are left in place
        expect(await SingleChannelAdjudicator.statusOf(channelId)).toEqual(expectedFingerprint);
      }
    }
  );
});
