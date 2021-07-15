import {CreateChannelParams, UpdateChannelParams} from '@statechannels/client-api-schema';

import {CreateLedgerChannelParams} from '../wallet';

export type CreateDirectlyFundedChannelStep = {
  type: 'CreateDirectlyFundedChannel';
  serverId: string;
  jobId: string;
  timestamp: number;
  channelParams: Omit<CreateChannelParams, 'fundingLedgerChannelId' | 'fundingStrategy'>;
};

export type CreateLedgerFundedChannelStep = {
  type: 'CreateLedgerFundedChannel';
  serverId: string;
  jobId: string;
  timestamp: number;
  fundingLedgerJobId: string;
  channelParams: Omit<CreateChannelParams, 'fundingLedgerChannelId' | 'fundingStrategy'>;
};

export type CreateLedgerChannelStep = {
  serverId: string;
  type: 'CreateLedgerChannel';
  jobId: string;
  timestamp: number;
  ledgerChannelParams: CreateLedgerChannelParams;
};
export type CloseChannelStep = {
  serverId: string;
  type: 'CloseChannel';
  jobId: string;
  timestamp: number;
};

export type UpdateChannelStep = {
  serverId: string;
  type: 'UpdateChannel';
  jobId: string;
  timestamp: number;
  updateParams: Omit<UpdateChannelParams, 'channelId'>;
};

export type Step =
  | CreateLedgerChannelStep
  | CreateLedgerFundedChannelStep
  | CreateDirectlyFundedChannelStep
  | CloseChannelStep
  | UpdateChannelStep;

/**
 * A job is just a collection of steps all with the same job id
 */
export type Job = Step[];

export type Peer = {serverId: string; messagePort: number; loadServerPort: number};
export type Peers = Peer[];

/**
 *  These are the basic options the load node needs to start running
 */
export type LoadNodeConfig = {messagePort: number; loadServerPort: number; serverId: string};

/**
 * A simple object that represents a link between a jobId and a channelId
 */
export type JobChannelLink = {jobId: string; channelId: string};

/**
 * This is the data expected to be defined for a role.
 * Each role represents a different wallet.
 */
export type RoleConfig = {
  databaseName: string;
  messagePort: number;
  loadServerPort: number;
  ganachePort: number;
  chainId: number;
  artifactFile: string;
  privateKey: string;
  chainPrivateKey: string;
};
