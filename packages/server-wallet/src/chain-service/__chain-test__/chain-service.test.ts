import {TEST_ACCOUNTS} from '@statechannels/devtools';
import {
  channelDataToStatus,
  getChannelId,
  randomChannelId,
  TestContractArtifacts,
} from '@statechannels/nitro-protocol';
import {
  Address,
  BN,
  makeAddress,
  makeDestination,
  simpleEthAllocation,
  simpleTokenAllocation,
  State,
  Uint256,
} from '@statechannels/wallet-core';
import {BigNumber, constants, Contract, providers, Wallet} from 'ethers';
import _ from 'lodash';

import {
  alice,
  alice as aliceParticipant,
  bob,
  bob as bobParticipant,
} from '../../engine/__test__/fixtures/participants';
import {alice as aWallet, bob as bWallet} from '../../engine/__test__/fixtures/signing-wallets';
import {stateSignedBy} from '../../engine/__test__/fixtures/states';
import {ChainService} from '../chain-service';
import {AllocationUpdatedArg, ChallengeRegisteredArg, HoldingUpdatedArg} from '../types';

const zeroAddress = makeAddress(constants.AddressZero);
/* eslint-disable no-process-env, @typescript-eslint/no-non-null-assertion */
const erc20Address = makeAddress(process.env.ERC20_ADDRESS!);
const testAdjudicatorAddress = makeAddress(process.env.NITRO_ADJUDICATOR_ADDRESS!);

if (!process.env.RPC_ENDPOINT) throw new Error('RPC_ENDPOINT must be defined');
const rpcEndpoint = process.env.RPC_ENDPOINT;
const chainId = process.env.CHAIN_NETWORK_ID || '9002';
/* eslint-enable no-process-env, @typescript-eslint/no-non-null-assertion */
const provider: providers.JsonRpcProvider = new providers.JsonRpcProvider(rpcEndpoint);

const defaultNoopListeners = {
  holdingUpdated: _.noop,
  allocationUpdated: _.noop,
  channelFinalized: _.noop,
  challengeRegistered: _.noop,
};
let chainService: ChainService;
let channelNonce = 0;
async function mineBlock(timestamp?: number) {
  const param = timestamp ? [timestamp] : [];
  await provider.send('evm_mine', param);
}
async function mineBlocks() {
  for (const _i of _.range(5)) {
    await mineBlock();
  }
}

jest.setTimeout(20_000);
// The test nitro adjudicator allows us to set channel storage
const testAdjudicator = new Contract(
  testAdjudicatorAddress,
  TestContractArtifacts.TestNitroAdjudicatorArtifact.abi,
  // We use a separate signer address to avoid nonce issues
  new providers.JsonRpcProvider(rpcEndpoint).getSigner(1)
);

beforeAll(() => {
  // Try to use a different private key for every chain service instantiation to avoid nonce errors
  // Using the first account here as that is the one that:
  // - Deploys the token contract.
  // - And therefore has tokens allocated to it.
  /* eslint-disable no-process-env */
  chainService = new ChainService({
    provider: rpcEndpoint,
    pk: process.env.CHAIN_SERVICE_PK ?? TEST_ACCOUNTS[0].privateKey,
    allowanceMode: 'MaxUint',
  });
  /* eslint-enable no-process-env, @typescript-eslint/no-non-null-assertion */
});

afterAll(() => {
  chainService.destructor();
  testAdjudicator.provider.removeAllListeners();
  provider.removeAllListeners();
});

function getChannelNonce() {
  return channelNonce++;
}

function fundChannel(
  expectedHeld: number,
  amount: number,
  channelId: string = randomChannelId(),
  asset: Address = zeroAddress
): {
  channelId: string;
  requestPromise: Promise<providers.TransactionResponse>;
} {
  const requestPromise = chainService.fundChannel({
    channelId,
    asset,
    expectedHeld: BN.from(expectedHeld),
    amount: BN.from(amount),
  });
  return {channelId, requestPromise};
}

function fundChannelAndMineBlocks(
  expectedHeld: number,
  amount: number,
  channelId: string = randomChannelId(),
  asset: Address = zeroAddress
): {
  channelId: string;
  requestPromise: Promise<providers.TransactionResponse>;
} {
  const retVal = fundChannel(expectedHeld, amount, channelId, asset);
  retVal.requestPromise.then(async response => {
    await response.wait();
    mineBlocks();
  });
  return retVal;
}

async function waitForChannelFunding(
  expectedHeld: number,
  amount: number,
  channelId: string = randomChannelId(),
  asset: Address = zeroAddress
): Promise<string> {
  const request = await fundChannel(expectedHeld, amount, channelId, asset).requestPromise;
  await request.wait();
  return channelId;
}

async function setUpConclude(isEth = true) {
  const aEthWallet = Wallet.createRandom();
  const bEthWallet = Wallet.createRandom();

  const alice = aliceParticipant({destination: makeDestination(aEthWallet.address)});
  const bob = bobParticipant({destination: makeDestination(bEthWallet.address)});
  const outcome = isEth
    ? simpleEthAllocation([
        {destination: alice.destination, amount: BN.from(1)},
        {destination: bob.destination, amount: BN.from(3)},
      ])
    : simpleTokenAllocation(erc20Address, [
        {destination: alice.destination, amount: BN.from(1)},
        {destination: bob.destination, amount: BN.from(3)},
      ]);
  const newAssetOutcome = isEth
    ? simpleEthAllocation([
        {destination: alice.destination, amount: BN.from(0)},
        {destination: bob.destination, amount: BN.from(0)},
      ])
    : simpleTokenAllocation(erc20Address, [
        {destination: alice.destination, amount: BN.from(0)},
        {destination: bob.destination, amount: BN.from(0)},
      ]);
  const state1: State = {
    appData: constants.HashZero,
    appDefinition: makeAddress(constants.AddressZero),
    isFinal: true,
    turnNum: 4,
    outcome,
    participants: [alice, bob],
    channelNonce: getChannelNonce(),
    chainId,
    challengeDuration: 9001,
  };
  const channelId = getChannelId({
    channelNonce: state1.channelNonce,
    chainId: state1.chainId,
    participants: [alice, bob].map(p => p.signingAddress),
  });
  const signatures = [aWallet(), bWallet()].map(sw => sw.signState(state1));

  await waitForChannelFunding(0, 4, channelId, isEth ? zeroAddress : erc20Address);
  return {
    channelId,
    aAddress: aEthWallet.address,
    bAddress: bEthWallet.address,
    state: state1,
    signatures,
    newAssetOutcome,
  };
}

describe('chainid mismatch detection', () => {
  it('throws an error when the chainid is wrong', async () => {
    await expect(chainService.checkChainId(987654321)).rejects.toThrow('ChainId mismatch');
  });
});

describe('fundChannel', () => {
  it('Successfully funds channel with 2 participants, rejects invalid 3rd', async () => {
    const channelId = await waitForChannelFunding(0, 5);
    await waitForChannelFunding(5, 5, channelId);

    const {requestPromise: fundChannelPromise} = fundChannel(5, 5, channelId);
    await expect(fundChannelPromise).rejects.toThrow(
      'cannot estimate gas; transaction may fail or may require manual gas limit'
    );
  });

  it('Fund erc20', async () => {
    const channelId = randomChannelId();

    await waitForChannelFunding(0, 5, channelId, erc20Address);
    expect(await testAdjudicator.holdings(erc20Address, channelId)).toEqual(BigNumber.from(5));
  });
});

describe('registerChannel', () => {
  it('registers a channel in the finalizing channel list and fires an event when that channel is finalized', async () => {
    const channelId = randomChannelId();
    const currentTime = (await provider.getBlock(provider.getBlockNumber())).timestamp;

    const tx = await testAdjudicator.setStatus(
      channelId,
      channelDataToStatus({
        turnNumRecord: 0,
        finalizesAt: currentTime + 2,
      })
    );
    await tx.wait();

    const channelFinalizedHandler = jest.fn();
    const channelFinalizedPromise = new Promise<void>(resolve =>
      chainService.registerChannel(channelId, [testAdjudicatorAddress], {
        ...defaultNoopListeners,
        channelFinalized: arg => {
          channelFinalizedHandler(arg);
          resolve();
        },
      })
    );

    await mineBlock(currentTime + 1);
    await mineBlock(currentTime + 2);
    await channelFinalizedPromise;
    expect(channelFinalizedHandler).toHaveBeenCalledWith(expect.objectContaining({channelId}));
  });

  it('Successfully registers channel and receives follow on funding event', async () => {
    const channelId = randomChannelId();
    const wrongChannelId = randomChannelId();
    let counter = 0;
    let resolve: (value: unknown) => void;
    const p = new Promise(r => (resolve = r));

    const holdingUpdated = async (arg: HoldingUpdatedArg): Promise<void> => {
      switch (counter) {
        case 0:
          expect(arg).toMatchObject({
            channelId,
            asset: zeroAddress,
            amount: BN.from(0),
          });
          counter++;
          // wait for the transaction to be mined.
          // Otherwise, it is possible for the correct channel funding transaction to be mined first.
          // In which case, this test might pass even if the holdingUpdated callback is fired for the wrongChannelId.
          await (await fundChannel(0, 5, wrongChannelId).requestPromise).wait();
          fundChannelAndMineBlocks(0, 5, channelId);
          break;
        case 1:
          expect(arg).toMatchObject({
            channelId,
            asset: zeroAddress,
            amount: BN.from(5),
          });
          counter++;
          chainService.unregisterChannel(channelId);
          resolve(undefined);
          break;
        default:
          throw new Error('Should not reach here');
      }
    };

    chainService.registerChannel(channelId, [zeroAddress], {
      ...defaultNoopListeners,
      holdingUpdated,
    });
    await p;
  });

  it('Receives correct initial holding when holdings are confirmed', async () => {
    const channelId = randomChannelId();
    await waitForChannelFunding(0, 5, channelId);
    await mineBlocks(); // wait for deposit to be confirmed then register channel

    await new Promise(resolve =>
      chainService.registerChannel(channelId, [zeroAddress], {
        ...defaultNoopListeners,
        holdingUpdated: arg => {
          expect(arg).toMatchObject({
            channelId,
            asset: zeroAddress,
            amount: BN.from(5),
          });
          resolve(true);
        },
      })
    );
  });

  it('Channel with multiple assets', async () => {
    const channelId = randomChannelId();
    let resolve: (value: unknown) => void;
    const p = new Promise(r => (resolve = r));
    const objectsToMatch = _.flatten(
      [0, 5].map(amount =>
        [zeroAddress, erc20Address].map(address => ({
          channelId,
          asset: address,
          amount: BN.from(amount),
        }))
      )
    );

    const holdingUpdated = (arg: HoldingUpdatedArg): void => {
      const index = objectsToMatch.findIndex(
        predicate =>
          predicate.channelId === arg.channelId &&
          predicate.amount === arg.amount &&
          predicate.asset === arg.asset
      );
      expect(index).toBeGreaterThan(-1);
      // Note, splice mutates the array on which it is called
      objectsToMatch.splice(index, 1);
      if (!objectsToMatch.length) resolve(true);
    };
    chainService.registerChannel(channelId, [erc20Address, zeroAddress], {
      ...defaultNoopListeners,
      holdingUpdated,
    });

    await waitForChannelFunding(0, 5, channelId, zeroAddress);
    await waitForChannelFunding(0, 5, channelId, erc20Address);
    // No need to wait for block mining. The promise below will not resolve until after the 5th block is mined
    mineBlocks();
    await p;
  });
});

describe('unconfirmedEvents', () => {
  it('Unconfirmed deposits are not missed', async () => {
    const channelId = randomChannelId();
    for (const expectedHeld of _.range(10)) {
      await waitForChannelFunding(expectedHeld, 1, channelId);
    }

    // Some deposited events are unconfirmed when we register channel,
    // make sure they're not missed
    let lastObservedAmount = -1;
    let numberOfEventsObserved = 0;
    const p = new Promise(resolve => {
      chainService.registerChannel(channelId, [zeroAddress], {
        ...defaultNoopListeners,
        holdingUpdated: arg => {
          const received = parseInt(arg.amount);

          if (lastObservedAmount >= 0 && numberOfEventsObserved !== 1) {
            // To understand why duplicate events are possible, consult chain-service getInitialHoldings
            if (numberOfEventsObserved === 1) {
              expect([lastObservedAmount, lastObservedAmount + 1]).toContain(received);
            } else {
              expect(received).toEqual(lastObservedAmount + 1);
            }
          }
          if (received === 10) {
            resolve(true);
            return;
          }
          lastObservedAmount = received;
          numberOfEventsObserved++;
          mineBlock();
        },
      });
    });

    await p;
  });
});

describe('concludeAndWithdraw', () => {
  it('triggers a channel finalized event', async () => {
    const {channelId, state, signatures} = await setUpConclude();

    const p = new Promise<void>(resolve =>
      chainService.registerChannel(channelId, [zeroAddress], {
        ...defaultNoopListeners,
        channelFinalized: arg => {
          expect(arg.channelId).toEqual(channelId);
          resolve();
        },
      })
    );

    const transactionResponse = await chainService.concludeAndWithdraw([{...state, signatures}]);
    if (!transactionResponse) throw 'Expected transaction response';
    await transactionResponse.wait();

    mineBlocks();
    await p;
  });

  it('Successful concludeAndWithdraw with eth allocation', async () => {
    const {
      channelId,
      aAddress,
      bAddress,
      state,
      signatures,
      newAssetOutcome,
    } = await setUpConclude();

    const AllocationUpdated: AllocationUpdatedArg = {
      channelId,
      asset: zeroAddress,
      newHoldings: '0x00' as Uint256,
      externalPayouts: [
        {
          amount: BN.from(1),
          destination: makeDestination(aAddress).toLowerCase(),
        },
        {
          amount: BN.from(3),
          destination: makeDestination(bAddress).toLowerCase(),
        },
      ],
      internalPayouts: [],
      newAssetOutcome,
    };

    const p = new Promise<void>(resolve =>
      chainService.registerChannel(channelId, [zeroAddress], {
        ...defaultNoopListeners,
        allocationUpdated: arg => {
          expect(arg).toMatchObject(AllocationUpdated);
          resolve();
        },
      })
    );

    const transactionResponse = await chainService.concludeAndWithdraw([{...state, signatures}]);
    if (!transactionResponse) throw 'Expected transaction response';
    await transactionResponse.wait();

    expect(await provider.getBalance(aAddress)).toEqual(BigNumber.from(1));
    expect(await provider.getBalance(bAddress)).toEqual(BigNumber.from(3));
    mineBlocks();
    await p;
  });

  it('Register channel -> concludeAndWithdraw -> mine confirmation blocks for erc20', async () => {
    const {channelId, aAddress, bAddress, state, signatures, newAssetOutcome} = await setUpConclude(
      false
    );

    const AllocationUpdated: AllocationUpdatedArg = {
      channelId,
      asset: erc20Address,
      newHoldings: '0x00' as Uint256,
      externalPayouts: [
        {
          amount: BN.from(1),
          destination: makeDestination(aAddress).toLowerCase(),
        },
        {
          amount: BN.from(3),
          destination: makeDestination(bAddress).toLowerCase(),
        },
      ],
      internalPayouts: [],
      newAssetOutcome,
    };

    const p = new Promise<void>(resolve =>
      chainService.registerChannel(channelId, [erc20Address], {
        ...defaultNoopListeners,
        allocationUpdated: arg => {
          expect(arg).toMatchObject(AllocationUpdated);
          resolve();
        },
      })
    );

    const transactionResponse = await chainService.concludeAndWithdraw([{...state, signatures}]);
    if (!transactionResponse) throw 'Expected transaction response';
    await transactionResponse.wait();

    const erc20Contract: Contract = new Contract(
      erc20Address,
      TestContractArtifacts.TokenArtifact.abi,
      provider
    );
    expect(await erc20Contract.balanceOf(aAddress)).toEqual(BigNumber.from(1));
    expect(await erc20Contract.balanceOf(bAddress)).toEqual(BigNumber.from(3));

    mineBlocks();
    await p;
  });

  it('concludeAndWithdraw -> register channel -> mine confirmation blocks for erc20', async () => {
    const {channelId, aAddress, bAddress, state, signatures, newAssetOutcome} = await setUpConclude(
      false
    );

    const AllocationUpdated: AllocationUpdatedArg = {
      channelId,
      asset: erc20Address,
      newHoldings: '0x00' as Uint256,
      externalPayouts: [
        {
          amount: BN.from(1),
          destination: makeDestination(aAddress).toLowerCase(),
        },
        {
          amount: BN.from(3),
          destination: makeDestination(bAddress).toLowerCase(),
        },
      ],
      internalPayouts: [],
      newAssetOutcome,
    };

    const p = new Promise<void>(resolve =>
      chainService.registerChannel(channelId, [erc20Address], {
        ...defaultNoopListeners,
        allocationUpdated: arg => {
          expect(arg).toMatchObject(AllocationUpdated);
          resolve();
        },
      })
    );

    const transactionResponse = await chainService.concludeAndWithdraw([{...state, signatures}]);
    if (!transactionResponse) throw 'Expected transaction response';
    await transactionResponse.wait();

    const erc20Contract: Contract = new Contract(
      erc20Address,
      TestContractArtifacts.TokenArtifact.abi,
      provider
    );
    expect(await erc20Contract.balanceOf(aAddress)).toEqual(BigNumber.from(1));
    expect(await erc20Contract.balanceOf(bAddress)).toEqual(BigNumber.from(3));

    mineBlocks();
    await p;
  });
});

describe('challenge', () => {
  it('two channels are challenged, funds are withdrawn -> final balances are correct', async () => {
    const aDestinationAddress = Wallet.createRandom().address;
    const bDestinationAddress = Wallet.createRandom().address;
    const aDestination = makeDestination(aDestinationAddress);
    const bDestination = makeDestination(bDestinationAddress);
    const channelNonces = [0, 1].map(getChannelNonce);

    const outcome = simpleEthAllocation([
      {
        destination: aDestination,
        amount: BN.from(1),
      },
      {
        destination: bDestination,
        amount: BN.from(3),
      },
    ]);
    const state0s = channelNonces.map((channelNonce, index) =>
      stateSignedBy()({
        chainId,
        challengeDuration: index + 2,
        outcome,
        channelNonce,
      })
    );
    const state1s = channelNonces.map((channelNonce, index) =>
      stateSignedBy([bWallet()])({
        chainId,
        turnNum: 1,
        challengeDuration: index + 2,
        outcome,
        channelNonce: channelNonce,
      })
    );
    const channelIds = channelNonces.map(channelNonce =>
      getChannelId({
        channelNonce: channelNonce,
        chainId: chainId,
        participants: state0s[0].participants.map(p => p.signingAddress),
      })
    );

    const channelsFinalized = channelIds.map(
      channelId =>
        new Promise(resolve =>
          chainService.registerChannel(channelId, [zeroAddress], {
            ...defaultNoopListeners,
            channelFinalized: resolve,
          })
        )
    );
    await Promise.all(
      channelIds.map(channelId => waitForChannelFunding(0, 4, channelId, zeroAddress))
    );

    await (await chainService.challenge([state0s[0], state1s[0]], aWallet().privateKey)).wait();
    await (await chainService.challenge([state0s[1], state1s[1]], aWallet().privateKey)).wait();

    const currentTime = (await provider.getBlock(provider.getBlockNumber())).timestamp;
    // The longest challenge duration is 3 seconds.
    // Lets mine a few blocks up to challenge expiration
    const blockDeltas = [0, 1, 2, 3];
    for (const blockDelta of blockDeltas) {
      await mineBlock(currentTime + blockDelta);
    }

    await Promise.all(channelsFinalized);
    await Promise.all(
      state1s.map(
        async state1 => await (await chainService.withdraw(state1, aWallet().address)).wait()
      )
    );

    expect(await provider.getBalance(aDestinationAddress)).toEqual(BigNumber.from(2));
    expect(await provider.getBalance(bDestinationAddress)).toEqual(BigNumber.from(6));
  });

  it('triggers challenge registered when a challenge is raised', async () => {
    const aDestinationAddress = Wallet.createRandom().address;
    const bDestinationAddress = Wallet.createRandom().address;
    const aDestination = makeDestination(aDestinationAddress);
    const bDestination = makeDestination(bDestinationAddress);
    const channelNonce = getChannelNonce();

    const outcome = simpleEthAllocation([
      {
        destination: aDestination,
        amount: BN.from(1),
      },
      {
        destination: bDestination,
        amount: BN.from(3),
      },
    ]);
    const state0 = stateSignedBy()({
      chainId,
      challengeDuration: 2,
      outcome,
      channelNonce,
    });

    const state1 = stateSignedBy([bWallet()])({
      chainId,
      turnNum: 1,
      challengeDuration: 2,
      outcome,
      channelNonce: channelNonce,
    });

    const channelId = getChannelId({
      channelNonce: state1.channelNonce,
      chainId: state1.chainId,
      participants: [alice(), bob()].map(p => p.signingAddress),
    });
    const challengeRegistered: Promise<ChallengeRegisteredArg> = new Promise(challengeRegistered =>
      chainService.registerChannel(channelId, [zeroAddress], {
        ...defaultNoopListeners,
        challengeRegistered,
      })
    );

    await waitForChannelFunding(0, 4, channelId, zeroAddress);

    await (await chainService.challenge([state0, state1], aWallet().privateKey)).wait();

    const result = await challengeRegistered;
    // TODO: Sort out these inconsistencies
    // Currently the participants come back slightly different (since the chain only knows the participant's address)
    // The chainId is returned as hex
    // We don't care about the signatures
    expect(result.challengeStates[0]).toMatchObject(
      _.omit(state0, ['participants', 'chainId', 'signatures'])
    );
    expect(result.challengeStates[1]).toMatchObject(
      _.omit(state1, ['participants', 'chainId', 'signatures'])
    );

    expect(result.channelId).toEqual(channelId);
  });
});

describe('getBytecode', () => {
  it('returns the bytecode for an app definition', async () => {
    const bytecode = await chainService.fetchBytecode(testAdjudicatorAddress);
    expect(bytecode).toMatch(/^0x[A-Fa-f0-9]{64,}$/);
  });

  it('rejects when there is no bytecode deployed at the address', async () => {
    await expect(chainService.fetchBytecode(constants.AddressZero)).rejects.toThrow(
      'Bytecode missing'
    );
  });
});
