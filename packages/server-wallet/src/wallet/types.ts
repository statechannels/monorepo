import {ChannelResult, CreateChannelParams} from '@statechannels/client-api-schema';
import _ from 'lodash';

import {ObjectiveStatus, WalletObjective} from '../models/objective';

export type ObjectiveError = ObjectiveTimedOutError | InternalError;

export type CreateLedgerChannelParams = Pick<
  CreateChannelParams,
  'participants' | 'allocations' | 'challengeDuration' | 'fundingStrategy'
> & {fundingStrategy: 'Direct' | 'Fake'};

/**
 * The objective timed out without being completed.
 */
export type ObjectiveTimedOutError = {
  lastProgressMadeAt: Date;
  objectiveId: string;
  type: 'ObjectiveTimedOutError';
};
/**
 * This is the catch-all error that will be returned if some error is thrown and not handled.
 */
export type InternalError = {
  type: 'InternalError';
  error: Error;
};

/**
 * The objective suceeded.
 */
export type ObjectiveSuccess = {channelId: string; type: 'Success'};

export type ObjectiveDoneResult = ObjectiveSuccess | ObjectiveError;

/**
 * This is what is returned for any objective related API call
 *
 */
export type ObjectiveResult = {
  /**
   * A promise that resolves when the objective is fully completed.
   * This promise will never reject, if an error occurs the promise will return an ObjectiveError
   */
  done: Promise<ObjectiveDoneResult>;
  /**
   * The current status of the objective.
   */
  currentStatus: ObjectiveStatus;
  /**
   * The id of the objective.
   */
  objectiveId: string;

  // The channelId for the objective
  channelId: string;
};

/**
 * This is returned when an unhandled error occurs when trying to update a channel
 */
export type UpdateChannelError = {type: 'InternalError'; channelId: string; error: Error};

/**
 * This is returned when a channel is sucessfully updated
 */
export type UpdateChannelSuccess = {
  type: 'Success';
  channelId: string;
  result: ChannelResult;
};

export type UpdateChannelResult = UpdateChannelSuccess | UpdateChannelError;

export interface WalletEvents {
  ObjectiveCompleted: (o: WalletObjective) => void;
  ObjectiveProposed: (o: WalletObjective) => void;
  ObjectiveTimedOut: (o: WalletObjective) => void;
  ChannelUpdated: (c: ChannelResult) => void;
}
