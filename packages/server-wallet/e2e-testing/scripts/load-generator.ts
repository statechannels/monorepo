import util from 'util';

import {CreateChannelParams, Participant} from '@statechannels/client-api-schema';
import {hexZeroPad} from 'ethers/lib/utils';
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
    createRate,
    prettyOutput,
    roleFile,
    outputFile,
    createWait,
    closeRate,
    duration,
  } = await yargs(hideBin(process.argv))
    .option('prettyOutput', {
      default: true,
      type: 'boolean',
      describe: 'Whether the output is formatted nicely with spaces.',
    })
    .option('outputFile', {
      alias: 'o',
      description: 'The file to write the generated load to.',
      default: 'temp/test_load.json',
    })
    .option('roleFile', {
      alias: 'f',
      describe: 'The path to a file containing the role information.',
      default: './e2e-testing/test-data/roles.json',
    })
    .option('duration', {
      alias: 'd',
      min: 10,
      default: 30,
      describe: `The amount of time (in seconds) that the load should run for.
      This dictactes the max timestamp a step can have.`,
    })
    .option('createRate', {
      alias: 'cr',
      min: 1,
      default: 5,
      describe: 'The number of channels that should be created per a second.',
    })
    .option('createWait', {
      default: 5,
      min: 0,
      describe: `The minumum amount of time (in seconds) to wait for a channel be fully open, before another step is scheduled.`,
    })
    .option('closeRate', {
      default: 5,
      min: 0,
      describe:
        'The amount of channels to be closed per a second. If this is larger than the createRate then all channels will eventually get closed. Otherwise, some channels will remain open.',
    }).argv;

  const roles = (await jsonfile.readFile(roleFile)) as Record<string, RoleConfig>;

  console.log(chalk.whiteBright(`Generating a test load file to  ${outputFile}`));
  console.log(
    chalk.whiteBright(
      `Using the following options ${util.inspect({
        outputFile,
        roleFile,
        duration,
        createRate,
        closeRate,
        createWait,
      })}`
    )
  );

  console.log(chalk.whiteBright(`${createRate * duration} will be created.`));
  console.log(
    chalk.whiteBright(
      `${
        closeRate * duration > 0 ? closeRate * duration : 'None'
      } of those channels will be closed.`
    )
  );
  if (closeRate >= createRate) {
    console.log(
      chalk.yellow('The close rate is larger than the create rate! All channels will end up closed')
    );
  }

  const createSteps = generateCreateSteps(createRate, duration, roles);
  const steps = generateCloseSteps(closeRate, duration, createWait, createSteps);

  await jsonfile.writeFile(outputFile, steps, {spaces: prettyOutput ? 1 : 0});

  console.log(chalk.greenBright(`Complete!`));
}

function generateCloseSteps(
  closeRate: number,
  duration: number,
  createWait: number,
  previousSteps: Readonly<Step[]>
): Step[] {
  // TODO: We cast this so we can mutate the cloned array
  const steps = _.clone(previousSteps) as Step[];

  if (closeRate > 0) {
    _.times(closeRate * duration, () => {
      const createStep = getRandomJobToClose(previousSteps);

      if (createStep) {
        // We want a close timestamp that occurs at least createWait time after the create time
        const timestamp = Math.max(
          generateRandomNumber(createStep.timestamp, toMilliseconds(duration)),
          createStep.timestamp + toMilliseconds(createWait)
        );

        steps.push({
          type: 'CloseChannel',
          jobId: createStep.jobId,
          serverId: createStep.serverId,
          timestamp,
        });
      }
    });
  }
  return steps;
}

function generateCreateSteps(
  createRate: number,
  duration: number,
  roles: Record<string, RoleConfig>
): Step[] {
  const steps: Step[] = [];
  _.times(createRate * duration, () => {
    const timestamp = generateRandomNumber(0, toMilliseconds(duration));

    const startIndex = generateRandomNumber(0, Object.keys(roles).length - 1);

    // Due to https://github.com/statechannels/statechannels/issues/3652 we'll run into duplicate channelIds if we use the same constants.
    // For now we re-order the participants based on who is creating the channel.
    const participants = generateParticipants(roles, startIndex);

    // Generate a jobId that is 4 random words
    const jobId = generateSlug(4);

    steps.push({
      type: 'CreateChannel',
      jobId,
      serverId: participants[0].participantId,
      timestamp,
      channelParams: generateChannelParams(roles, participants),
    });
  });
  return steps;
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
 * @param roles
 * @param participants
 * @returns A CreateChannelParams object that can be passed into createChannel
 */
function generateChannelParams(
  roles: Record<string, RoleConfig>,
  participants: Participant[]
): CreateChannelParams {
  // Eventually these should vary
  const allocationItems = participants.map(p => ({
    destination: p.destination,
    amount: BigNumber.from(5).toHexString(),
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
    fundingStrategy: 'Direct',
    challengeDuration: ms('1d') / 1000, // This is 1 day in seconds,
  };
}

/**
 * Converts seconds to milliseconds
 */
function toMilliseconds(seconds: number): number {
  return seconds * 1000;
}

/**
 * Gets a random job that doesn't already have a close step scheduled
 */
function getRandomJobToClose(
  steps: readonly Step[]
): Pick<Step, 'jobId' | 'timestamp' | 'serverId'> | undefined {
  const jobsAlreadyWithClose = steps.filter(s => s.type === 'CloseChannel').map(s => s.jobId);

  // We only want jobs that don't have a close channel step yet
  const filtered = steps.filter(
    s => s.type === 'CreateChannel' && !jobsAlreadyWithClose.includes(s.jobId)
  );

  const index = generateRandomNumber(0, filtered.length - 1);
  return filtered[index];
}
