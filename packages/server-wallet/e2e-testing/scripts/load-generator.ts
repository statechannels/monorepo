import util from 'util';

import {CreateChannelParams, Participant} from '@statechannels/client-api-schema';
import {hexlify, hexZeroPad} from 'ethers/lib/utils';
import yargs from 'yargs';
import {hideBin} from 'yargs/helpers';
import * as jsonfile from 'jsonfile';
import chalk from 'chalk';
import {generateSlug} from 'random-word-slugs';
import _ from 'lodash';
import {BigNumber, ethers, utils} from 'ethers';
import ms from 'ms';

import {COUNTING_APP_DEFINITION} from '../../src/models/__test__/fixtures/app-bytecode';
import {RoleConfig, Step} from '../types';
import {setupUnhandledErrorListeners} from '../utils';

setupUnhandledErrorListeners();

createLoad();

// TODO: This should probably be ready from the contract artifacts file
const ETH_ASSET_HOLDER_ADDRESS = '0x9eD274314f0fB37837346C425D3cF28d89ca9599';

async function createLoad() {
  const {
    closeChannels,
    amountOfUpdates,
    numberOfChannels,
    prettyOutput,
    roleFile,
    closeTime,
    createTime,
    updateTime,
    outputFile,
    fundingStrategy,
    numberOfLedgerChannels,
    ledgerTime,
  } = await yargs(hideBin(process.argv))
    .option('fundingStrategy', {choices: ['direct', 'ledger'], default: 'ledger'})
    .option('closeChannels', {
      alias: 'c',
      default: true,
      type: 'boolean',
      describe: 'Whether channels are closed',
    })
    .option('prettyOutput', {
      default: true,
      type: 'boolean',
      describe: 'Whether the output is formatted nicely with spaces',
    })
    .option('numberOfLedgerChannels', {
      default: 5,
      describe: 'The amount of channels that should be created.',
    })
    .option('numberOfChannels', {
      alias: 'n',
      default: 10,
      describe: 'The amount of channels that should be created.',
    })
    .option('createTime', {
      type: 'number',
      description: `The range of time for a CreateChannelStep.
      CreateChannelSteps will be assigned a timestamp randomly from 0 to createTime`,
      default: ms('10s'),
    })
    .option('ledgerTime', {
      type: 'number',
      description: `The range of time for a CreateLedgerChannelStep.
      Each CreateLedgerChannelStep will be incremented by a random value from 0 to updateTime `,
      default: ms('10s'),
    })
    .option('updateTime', {
      type: 'number',
      description: `The range of time for a UpdateChannelStep.
      Each UpdateChannelStep will be incremented by a random value from 0 to updateTime `,
      default: ms('10s'),
    })
    .option('closeTime', {
      type: 'number',
      description: `The range of time for a CloseChannelStep.
      CloseChannelSteps will be assigned a timestamp randomly from updateTime to CloseTime`,
      default: ms('10s'),
    })
    .option('amountOfUpdates', {
      alias: 'u',
      description:
        'The amount of updates that should be done per channel. If 0 no updates are made.',
      default: 0,
    })
    .option('roleFile', {
      alias: 'f',
      describe: 'The path to a file containing the role information',
      default: './e2e-testing/test-data/roles.json',
    })
    .option('outputFile', {
      alias: 'o',
      description: 'The file to write the generated load to',
      default: 'temp/test_load.json',
    }).argv;

  const roles = (await jsonfile.readFile(roleFile)) as Record<string, RoleConfig>;

  const jobIds = new Array<string>(numberOfChannels);
  const steps: Step[] = [];

  console.log(chalk.whiteBright(`Generating a test load file to  ${outputFile}`));
  console.log(
    chalk.whiteBright(
      `Using the following options ${util.inspect({
        amountOfUpdates,
        numberOfChannels,
        prettyOutput,
        closeChannels,
        createTime,
        updateTime,
        closeTime,
        fundingStrategy,
        numberOfLedgerChannels,
        ledgerTime,
      })}`
    )
  );
  let timestamp = 0;
  const ledgerJobIds: string[] = [];
  const ledgerParticipants = generateParticipants(roles, 0);
  // If we're ledger funding we want to create a couple funded ledger channels
  if (fundingStrategy === 'ledger') {
    _.times(numberOfLedgerChannels, () => {
      timestamp += generateRandomNumber(0, ledgerTime);
      const ledgerJobId = generateSlug(4);

      steps.push({
        type: 'CreateLedgerChannel',
        jobId: ledgerJobId,
        serverId: ledgerParticipants[0].participantId,
        timestamp,
        // We want the ledger channel to have plent of funds
        ledgerChannelParams: {
          ...generateChannelParams(ledgerParticipants, 1_000_000),
          fundingStrategy: 'Direct',
        },
      });
      ledgerJobIds.push(ledgerJobId);
    });
  }
  _.times(numberOfChannels, () => {
    // The timestamp represents when these steps should occur
    // As we add steps we keep increasing the timestamp
    timestamp += generateRandomNumber(0, createTime);
    const startIndex = generateRandomNumber(0, Object.keys(roles).length - 1);

    // Due to https://github.com/statechannels/statechannels/issues/3652 we'll run into duplicate channelIds if we use the same constants.
    // For now we re-order the participants based on who is creating the channel.
    const participants = generateParticipants(roles, startIndex);

    // Generate a jobId that is 4 random words
    const jobId = generateSlug(4);
    jobIds.push(jobId);

    if (fundingStrategy === 'ledger') {
      steps.push({
        type: 'CreateLedgerFundedChannel',
        serverId: participants[0].participantId,
        timestamp,
        channelParams: generateChannelParams(participants),
        fundingLedgerJobId: getRandomJob(ledgerJobIds),
        jobId,
      });
    } else {
      steps.push({
        type: 'CreateDirectlyFundedChannel',
        serverId: participants[0].participantId,
        timestamp,
        channelParams: generateChannelParams(participants),

        jobId,
      });
    }
    _.times(amountOfUpdates, async updateIndex => {
      timestamp += generateRandomNumber(0, updateTime);
      steps.push({
        type: 'UpdateChannel',
        serverId: participants[updateIndex % participants.length].participantId,
        jobId,
        timestamp,
        updateParams: {
          appData: hexZeroPad(hexlify(updateIndex), 32),
          allocations: generateChannelParams(participants).allocations,
        },
      });
    });
    if (closeChannels) {
      // Allow some time for updates or channel creation to be done before closing
      timestamp += generateRandomNumber(ms('1s'), closeTime);

      steps.push({
        type: 'CloseChannel',
        jobId,
        serverId: participants[0].participantId,
        timestamp,
      });
    }
  });

  await jsonfile.writeFile(outputFile, steps, {spaces: prettyOutput ? 1 : 0});
  console.log(chalk.greenBright(`Complete!`));
}

function getRandomJob(jobIds: string[]): string {
  const index = generateRandomNumber(0, jobIds.length - 1);
  return jobIds[index];
}
function generateRandomNumber(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1) + min);
}

/**
 * Generates participants based on roles. Uses the startIndex to determine the order of the participants.
 * This may no longer be needed after https://github.com/statechannels/statechannels/issues/3652
 * @param roles The record containing role configs
 * @param startIndex The index of the role we should start at
 * @returns A collection of participants
 */
function generateParticipants(roles: Record<string, RoleConfig>, startIndex: number) {
  // Flatten out the Record into a simple array
  const roleArray = Object.keys(roles).map(rId => ({roleId: rId, ...roles[rId]}));

  const participants: Participant[] = [];

  // We iterate through the role  array starting at start index and add the role to the participants
  for (let i = 0; i < roleArray.length; i++) {
    const role = roleArray[(i + startIndex) % roleArray.length];

    const {address: signingAddress} = new ethers.Wallet(role.privateKey);
    const {address: destinationAddress} = new ethers.Wallet(role.chainPrivateKey);
    const destination = hexZeroPad(destinationAddress, 32);

    participants.push({signingAddress, participantId: role.roleId, destination});
  }

  return participants;
}

/**
 * Creates channel parameters based on the provided roles and participants.
 * @returns A CreateChannelParams object that can be passed into createChannel
 */
function generateChannelParams(
  participants: Participant[],
  initialAmount = 5
): Omit<CreateChannelParams, 'fundingStrategy'> {
  // Eventually these should vary
  const allocationItems = participants.map(p => ({
    destination: p.destination,
    amount: BigNumber.from(initialAmount).toHexString(),
  }));

  return {
    participants,
    allocations: [
      {
        allocationItems,
        assetHolderAddress: ETH_ASSET_HOLDER_ADDRESS,
      },
    ],
    appDefinition: COUNTING_APP_DEFINITION,
    appData: utils.hexZeroPad('0x0', 32),

    challengeDuration: ms('1d') / 1000, // This is 1 day in seconds,
  };
}
