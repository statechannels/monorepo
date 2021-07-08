import path from 'path';

import {CreateChannelParams, Participant, Allocation} from '@statechannels/client-api-schema';
import {TEST_ACCOUNTS} from '@statechannels/devtools';
import {ContractArtifacts} from '@statechannels/nitro-protocol';
import {BN, makeAddress, makeDestination} from '@statechannels/wallet-core';
import {BigNumber, BigNumberish, Contract, ethers, providers, utils} from 'ethers';
import _ from 'lodash';
import {hexZeroPad} from '@ethersproject/bytes';

import {
  defaultTestWalletConfig,
  overwriteConfigWithDatabaseConnection,
  WalletConfig,
} from '../config';
import {DBAdmin} from '../db-admin/db-admin';
import {LatencyOptions, TestMessageService} from '../message-service/test-message-service';
import {Wallet} from '../wallet';
import {ONE_DAY} from '../__test__/test-helpers';
import {waitForObjectiveProposals} from '../__test-with-peers__/utils';
import {ARTIFACTS_DIR} from '../../jest/chain-setup';
import {COUNTING_APP_DEFINITION} from '../models/__test__/fixtures/app-bytecode';
import {createLogger} from '../logger';

jest.setTimeout(60_000);

// eslint-disable-next-line no-process-env, @typescript-eslint/no-non-null-assertion
const nitroAdjudicatorAddress = makeAddress(process.env.NITRO_ADJUDICATOR_ADDRESS!);

// eslint-disable-next-line no-process-env, @typescript-eslint/no-non-null-assertion
if (!process.env.RPC_ENDPOINT) throw new Error('RPC_ENDPOINT must be defined');
// eslint-disable-next-line no-process-env, @typescript-eslint/no-non-null-assertion
const rpcEndpoint = process.env.RPC_ENDPOINT;

const config = {
  ...defaultTestWalletConfig(),
  networkConfiguration: {
    ...defaultTestWalletConfig().networkConfiguration,
    // eslint-disable-next-line no-process-env
    chainNetworkID: parseInt(process.env.CHAIN_NETWORK_ID || '0'),
  },
};

let provider: providers.JsonRpcProvider;
let a: Wallet;
let b: Wallet;

const bWalletConfig: WalletConfig = {
  ...overwriteConfigWithDatabaseConnection(config, {database: 'server_wallet_test_b'}),
  loggingConfiguration: {
    logDestination: path.join(ARTIFACTS_DIR, 'direct-funding.log'),
    logLevel: 'trace',
  },
  chainServiceConfiguration: {
    attachChainService: true,
    provider: rpcEndpoint,
    /* eslint-disable-next-line no-process-env */
    pk: process.env.CHAIN_SERVICE_PK ?? TEST_ACCOUNTS[1].privateKey,
    allowanceMode: 'MaxUint',
  },
  syncConfiguration: {pollInterval: 1_000, timeOutThreshold: 60_000, staleThreshold: 10_000},
};
const aWalletConfig: WalletConfig = {
  ...overwriteConfigWithDatabaseConnection(config, {database: 'server_wallet_test_a'}),
  loggingConfiguration: {
    logDestination: path.join(ARTIFACTS_DIR, 'direct-funding.log'),
    logLevel: 'trace',
  },
  chainServiceConfiguration: {
    attachChainService: true,
    provider: rpcEndpoint,
    /* eslint-disable-next-line no-process-env */
    pk: process.env.CHAIN_SERVICE_PK2 ?? TEST_ACCOUNTS[2].privateKey,
    allowanceMode: 'MaxUint',
  },
  syncConfiguration: {pollInterval: 1_000, timeOutThreshold: 60_000, staleThreshold: 10_000},
};

const aAddress = '0x50Bcf60D1d63B7DD3DAF6331a688749dCBD65d96';
const bAddress = '0x632d0b05c78A83cEd439D3bd6C710c4814D3a6db';

async function getBalance(address: string): Promise<BigNumber> {
  return await provider.getBalance(address);
}

async function mineBlocks(confirmations = 5) {
  for (const _i in _.range(confirmations)) {
    await provider.send('evm_mine', []);
  }
}

const mineBlocksForEvent = () => mineBlocks();

function mineOnEvent(contract: Contract) {
  contract.on('Deposited', mineBlocksForEvent);
  contract.on('AllocationUpdated', mineBlocksForEvent);
}

beforeAll(async () => {
  provider = new providers.JsonRpcProvider(rpcEndpoint);

  await Promise.all(
    [aWalletConfig, bWalletConfig].map(async config => {
      await DBAdmin.dropDatabase(config);
      await DBAdmin.createDatabase(config);
      await DBAdmin.migrateDatabase(config);
    })
  );

  a = await Wallet.create(aWalletConfig, TestMessageService.create);
  b = await Wallet.create(bWalletConfig, TestMessageService.create);
  const logger = createLogger(defaultTestWalletConfig());

  TestMessageService.linkMessageServices(a.messageService, b.messageService, logger);
  const nitroAdjudicator = new Contract(
    nitroAdjudicatorAddress,
    ContractArtifacts.NitroAdjudicatorArtifact.abi,
    provider
  );
  mineOnEvent(nitroAdjudicator);
});

afterAll(async () => {
  await Promise.all([a.destroy(), b.destroy()]);
  await Promise.all([DBAdmin.dropDatabase(aWalletConfig), DBAdmin.dropDatabase(bWalletConfig)]);
  provider.polling = false;
  provider.removeAllListeners();
});

const testCases: Array<LatencyOptions & {closer: 'A' | 'B'}> = [
  {
    dropRate: 0,
    meanDelay: undefined,
    closer: 'A',
  },
  {
    dropRate: 0,
    meanDelay: undefined,
    closer: 'B',
  },
  {dropRate: 0.1, meanDelay: 50, closer: 'A'},
  {dropRate: 0.1, meanDelay: 50, closer: 'B'},
];
test.each(testCases)(
  `can successfully fund and defund a channel between two wallets with options %o`,
  async options => {
    TestMessageService.setLatencyOptions({a, b}, options);
    const participantA: Participant = {
      signingAddress: await a.getSigningAddress(),
      participantId: 'a',
      destination: makeDestination(aAddress),
    };
    const participantB: Participant = {
      signingAddress: await b.getSigningAddress(),
      participantId: 'b',
      destination: makeDestination(bAddress),
    };

    const startBalance = {aAmount: 3, bAmount: 2, participantA, participantB};
    const updatedBalance = {aAmount: 1, bAmount: 4, participantA, participantB};

    const channelParams: CreateChannelParams = {
      participants: [participantA, participantB],
      allocations: [createAllocation(startBalance)],
      appDefinition: COUNTING_APP_DEFINITION,
      appData: utils.defaultAbiCoder.encode(['uint256'], [1]),
      fundingStrategy: 'Direct',
      challengeDuration: ONE_DAY,
    };

    const aBalanceInit = await getBalance(aAddress);
    const bBalanceInit = await getBalance(bAddress);
    const assetHolderBalanceInit = await getBalance(nitroAdjudicatorAddress);

    const response = await a.createChannels([channelParams]);
    await waitForObjectiveProposals([response[0].objectiveId], b);
    const bResponse = await b.approveObjectives([response[0].objectiveId]);

    await expect(response).toBeObjectiveDoneType('Success');
    await expect(bResponse).toBeObjectiveDoneType('Success');

    const assetHolderBalanceUpdated = await getBalance(nitroAdjudicatorAddress);

    const totalDepositAmount = BN.add(startBalance.aAmount, startBalance.bAmount);
    expect(BN.sub(assetHolderBalanceUpdated, assetHolderBalanceInit)).toEqual(totalDepositAmount);

    const {channelId} = response[0];
    const updated = await a.updateChannel(
      channelId,
      [createAllocation(updatedBalance)],
      utils.defaultAbiCoder.encode(['uint256'], [2])
    );

    expect(updated).toMatchObject({
      type: 'Success',
      result: {
        turnNum: 4,
        allocations: [createAllocation(updatedBalance)],
      },
    });

    const closeResponse =
      options.closer === 'A'
        ? await a.closeChannels([channelId])
        : await b.closeChannels([channelId]);
    await expect(closeResponse).toBeObjectiveDoneType('Success');

    const aBalanceFinal = await getBalance(aAddress);
    const bBalanceFinal = await getBalance(bAddress);

    expect(BN.sub(aBalanceFinal, aBalanceInit)).toEqual(BN.from(updatedBalance.aAmount));
    expect(BN.sub(bBalanceFinal, bBalanceInit)).toEqual(BN.from(updatedBalance.bAmount));
  }
);

const createAllocation = ({
  aAmount,
  bAmount,
  participantA,
  participantB,
}: {
  aAmount: BigNumberish;
  bAmount: BigNumberish;
  participantA: Participant;
  participantB: Participant;
}): Allocation => ({
  allocationItems: [
    {
      destination: participantA.destination,
      amount: hexZeroPad(BigNumber.from(aAmount).toHexString(), 32),
    },
    {
      destination: participantB.destination,
      amount: hexZeroPad(BigNumber.from(bAmount).toHexString(), 32),
    },
  ],
  asset: ethers.constants.AddressZero,
});
