import {expectRevert} from '@statechannels/devtools';
import {Contract, BigNumber, Wallet, constants, BigNumberish} from 'ethers';

import {getFixedPart, hashAppPart, State} from '../../../../src/contract/state';
import SingleChannelAdjudicatorArtifact from '../../../../artifacts/contracts/ninja-nitro/SingleChannelAdjudicator.sol/SingleChannelAdjudicator.json';
import AdjudicatorFactoryArtifact from '../../../../artifacts/contracts/ninja-nitro/AdjudicatorFactory.sol/AdjudicatorFactory.json';
import {
  AssetOutcomeShortHand,
  finalizedFingerprint,
  getRandomNonce,
  getTestProvider,
  randomExternalDestination,
  replaceAddressesAndBigNumberify,
  setupContracts,
  writeGasConsumption,
} from '../../../test-helpers';
import {
  Channel,
  channelDataToStatus,
  convertBytes32ToAddress,
  encodeOutcome,
  getChannelId,
  hashOutcome,
  Outcome,
  signState,
} from '../../../../src';
import {ChannelDataLite} from '../../../../src/contract/channel-storage';

const provider = getTestProvider();
const addresses = {
  // Channels
  t: undefined, // Target
  g: undefined, // Guarantor
  // Externals
  I: randomExternalDestination(),
  A: randomExternalDestination(),
  B: randomExternalDestination(),
};

let AdjudicatorFactory: Contract;
const chainId = process.env.CHAIN_NETWORK_ID;
const participants = ['', ''];
const wallets = new Array<Wallet>(2);
for (let i = 0; i < 2; i++) {
  wallets[i] = Wallet.createRandom();
  participants[i] = wallets[i].address;
}

beforeAll(async () => {
  AdjudicatorFactory = await setupContracts(
    provider,
    AdjudicatorFactoryArtifact,
    process.env.ADJUDICATOR_FACTORY_ADDRESS
  );
});

const reason5 = 'status(ChannelData)!=storage';
const reason6 = 'status(ChannelData)!=storage';

// NOTES
// Amounts are valueString representations of wei
// This test constructs Outcomes with length 1, with the AssetHolderAddress set to indicate ETH
// (namely, the zero address)
describe('claim (ETH only)', () => {
  it.each`
    name                                               | heldBefore | guaranteeDestinations | tOutcomeBefore        | indices | tOutcomeAfter         | heldAfter | payouts   | reason
    ${'1. straight-through guarantee, 3 destinations'} | ${{g: 5}}  | ${['I', 'A', 'B']}    | ${{I: 5, A: 5, B: 5}} | ${[0]}  | ${{I: 0, A: 5, B: 5}} | ${{g: 0}} | ${{I: 5}} | ${undefined}
    ${'2. swap guarantee,             2 destinations'} | ${{g: 5}}  | ${['B', 'A']}         | ${{A: 5, B: 5}}       | ${[1]}  | ${{A: 5, B: 0}}       | ${{g: 0}} | ${{B: 5}} | ${undefined}
    ${'3. swap guarantee,             3 destinations'} | ${{g: 5}}  | ${['I', 'B', 'A']}    | ${{I: 5, A: 5, B: 5}} | ${[0]}  | ${{I: 0, A: 5, B: 5}} | ${{g: 0}} | ${{I: 5}} | ${undefined}
    ${'4. straight-through guarantee, 2 destinations'} | ${{g: 5}}  | ${['A', 'B']}         | ${{A: 5, B: 5}}       | ${[0]}  | ${{A: 0, B: 5}}       | ${{g: 0}} | ${{A: 5}} | ${undefined}
    ${'5. target channel not finalized'}               | ${{g: 5}}  | ${['B', 'A']}         | ${{}}                 | ${[0]}  | ${{A: 5}}             | ${{g: 0}} | ${{B: 5}} | ${reason5}
    ${'6. guarantor channel not finalized'}            | ${{g: 5}}  | ${[]}                 | ${{A: 5, B: 5}}       | ${[1]}  | ${{A: 5}}             | ${{g: 0}} | ${{B: 5}} | ${reason6}
    ${'7. swap guarantee, overfunded, 2 destinations'} | ${{g: 12}} | ${['B', 'A']}         | ${{A: 5, B: 5}}       | ${[1]}  | ${{A: 5, B: 0}}       | ${{g: 7}} | ${{B: 5}} | ${undefined}
    ${'8. underspecified guarantee, overfunded      '} | ${{g: 12}} | ${['B']}              | ${{A: 5, B: 5}}       | ${[1]}  | ${{A: 5, B: 0}}       | ${{g: 7}} | ${{B: 5}} | ${undefined}
  `(
    '$name',
    async ({
      name,
      heldBefore,
      guaranteeDestinations,
      tOutcomeBefore,
      indices,
      tOutcomeAfter,
      heldAfter,
      payouts,
      reason,
    }: {
      name;
      heldBefore: AssetOutcomeShortHand;
      guaranteeDestinations;
      tOutcomeBefore: AssetOutcomeShortHand;
      indices: number[];
      tOutcomeAfter: AssetOutcomeShortHand;
      heldAfter: AssetOutcomeShortHand;
      payouts: AssetOutcomeShortHand;
      reason;
    }) => {
      const target = new TestChannel(getRandomNonce(name));
      const guarantor = new TestChannel(getRandomNonce(name + 'g'));
      addresses.t = target.id;
      addresses.g = guarantor.id;
      // Transform input data (unpack addresses and BigNumber amounts)
      [heldBefore, tOutcomeBefore, tOutcomeAfter, heldAfter, payouts] = [
        heldBefore,
        tOutcomeBefore,
        tOutcomeAfter,
        heldAfter,
        payouts,
      ].map(object => replaceAddressesAndBigNumberify(object, addresses) as AssetOutcomeShortHand);
      guaranteeDestinations = guaranteeDestinations.map(x => addresses[x]);
      // Fund the guarantor channel
      await guarantor.depositETH(heldBefore[guarantor.id]);
      // DEPLOY GUARANTOR CHANNEL
      await guarantor.deploy();
      // Compute an appropriate guarantee for the guarantor (using only ETH)
      const guarantee = {
        destinations: guaranteeDestinations,
        targetChannelId: target.id,
      };
      const guarantorOutcome: Outcome = [{assetHolderAddress: constants.AddressZero, guarantee}];
      if (guaranteeDestinations.length > 0) {
        // CONCLUDE GUARANTOR CHANNEL
        await guarantor.conclude(guarantorOutcome);
      }
      // Compute an appropriate allocation outcome for the target (using only ETH)
      const allocation = [];
      Object.keys(tOutcomeBefore).forEach(key =>
        allocation.push({destination: key, amount: tOutcomeBefore[key]})
      );
      const targetOutcome: Outcome = [
        {assetHolderAddress: constants.AddressZero, allocationItems: allocation},
      ];

      // DEPLOY TARGET CHANNEL
      await target.deploy();
      // CONCLUDE TARGET CHANNEL
      if (Object.keys(tOutcomeBefore).length > 0) {
        await target.conclude(targetOutcome);
      }

      const tx = target.claimTx(guarantor, indices);
      // Call method in a slightly different way if expecting a revert
      if (reason) {
        await expectRevert(() => tx, reason);
      } else {
        const balancesBefore = await getBalances(payouts);
        // Extract logs
        const {events: eventsFromTx, gasUsed} = await (await tx).wait();
        await writeGasConsumption('SingleChannelAdjudicator.claim.gas.md', name, gasUsed);

        // Check new outcomeHash
        const newAllocation = [];
        Object.keys(tOutcomeAfter).forEach(key =>
          newAllocation.push({destination: key, amount: tOutcomeAfter[key]})
        );
        const outcome: Outcome = [
          {assetHolderAddress: constants.AddressZero, allocationItems: newAllocation},
        ];
        const expectedFingerprint = channelDataToStatus({
          turnNumRecord: 0,
          finalizesAt: target.finalizesAt,
          outcome,
        });
        // Check fingerprint against the expected value
        // NOTE that allocations for zero amounts are left in place
        expect(await target.statusOf()).toEqual(expectedFingerprint);

        const balancesAfter = await getBalances(payouts);
        Object.keys(payouts).forEach(key =>
          expect(BigNumber.from(balancesAfter[key])).toEqual(
            BigNumber.from(balancesBefore[key]).add(BigNumber.from(payouts[key]))
          )
        );
      }
    }
  );
});

async function getBalances(payouts: AssetOutcomeShortHand) {
  const balances: Record<string, BigNumber> = {};
  await Promise.all(
    Object.keys(payouts).map(async key => {
      balances[key] = await provider.getBalance(convertBytes32ToAddress(key));
    })
  );
  return balances;
}
/**
 * Combines off chain and on chain channel properties and operations
 */
class TestChannel {
  channel: Channel;
  id: string;
  address: string = undefined;
  factory: Contract;
  adjudicator?: Contract = undefined;
  turnNumRecord = 5;
  finalizesAt = 0;
  outcome: Outcome = [];
  constructor(channelNonce: number) {
    this.channel = {chainId, participants, channelNonce};
    this.id = getChannelId(this.channel);
    this.factory = setupContracts(
      provider,
      AdjudicatorFactoryArtifact,
      process.env.ADJUDICATOR_FACTORY_ADDRESS
    );
  }

  async getAddress() {
    this.address = this.address ?? (await AdjudicatorFactory.getChannelAddress(this.id));
    return this.address;
  }

  /**
   * Deploys an instance of a SingleChannelAdjudicator for this channel
   */
  async deploy() {
    await (await this.factory.createChannel(this.id)).wait();
    this.adjudicator = setupContracts(
      provider,
      SingleChannelAdjudicatorArtifact,
      await this.getAddress()
    );
  }

  /**
   * Deposits wei
   * @param amount number of wei
   */
  async depositETH(amount: BigNumberish) {
    await (
      await provider.getSigner().sendTransaction({
        to: await this.getAddress(),
        value: amount,
      })
    ).wait();
  }
  async conclude(outcome: Outcome) {
    const states: State[] = [
      {
        isFinal: true,
        channel: this.channel,
        outcome: outcome,
        appDefinition: constants.AddressZero,
        appData: '0x',
        challengeDuration: 0x1000,
        turnNum: this.turnNumRecord,
      },
    ];
    const sigs = [
      signState(states[0], wallets[0].privateKey).signature,
      signState(states[0], wallets[1].privateKey).signature,
    ];
    const {blockNumber} = await (
      await this.adjudicator.conclude(
        this.turnNumRecord,
        getFixedPart(states[0]),
        hashAppPart(states[0]),
        hashOutcome(outcome),
        1,
        [0, 0],
        sigs
      )
    ).wait();
    this.finalizesAt = (await provider.getBlock(blockNumber)).timestamp;
    this.outcome = outcome;
  }
  claimTx(guarantor: TestChannel, indices: number[]) {
    const guaranteeCDL: ChannelDataLite = {
      turnNumRecord: 0, // when collaboratively concluding, turnNumRecord is set to zero
      finalizesAt: guarantor.finalizesAt,
      stateHash: constants.HashZero, // when collaboratively concluding, stateHash is set to zero,
      challengerAddress: constants.AddressZero, // when collaboratively concluding, challengerAddress is set to zero,
      outcomeBytes: encodeOutcome(guarantor.outcome),
    };
    const targetCDL: ChannelDataLite = {
      turnNumRecord: 0, // when collaboratively concluding, turnNumRecord is set to zero
      finalizesAt: this.finalizesAt,
      stateHash: constants.HashZero, // when collaboratively concluding, stateHash is set to zero,
      challengerAddress: constants.AddressZero, // when collaboratively concluding, challengerAddress is set to zero,
      outcomeBytes: encodeOutcome(this.outcome),
    };
    console.log(guaranteeCDL, targetCDL);
    return this.adjudicator.claim(guarantor.id, this.id, guaranteeCDL, targetCDL, [indices]);
  }
  async statusOf() {
    return this.adjudicator.statusOf(this.id);
  }
}
