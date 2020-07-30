import {deserializeAllocations} from '@statechannels/wallet-core/lib/src/serde/app-messages/deserialize';
import {
  ChannelResult as ClientChannelResult,
  UpdateChannelParams,
  CreateChannelParams,
  Notification,
  JoinChannelParams,
  CloseChannelParams,
  ChannelResult,
  GetStateParams,
} from '@statechannels/client-api-schema';
import {
  ChannelConstants,
  Message,
  Outcome,
  SignedStateVarsWithHash,
  convertToParticipant,
} from '@statechannels/wallet-core';
import * as Either from 'fp-ts/lib/Either';
import * as Option from 'fp-ts/lib/Option';

import {Bytes32} from '../type-aliases';
import {Channel} from '../models/channel';
import {Nonce} from '../models/nonce';
import {Outgoing, ProtocolAction} from '../protocols/actions';
import {SigningWallet} from '../models/signing-wallet';
import {logger} from '../logger';
import * as Application from '../protocols/application';
import knex from '../db/connection';
import * as UpdateChannel from '../handlers/update-channel';
import * as JoinChannel from '../handlers/join-channel';

import {Store} from './store';

export {CreateChannelParams};

export type AddressedMessage = Message & {to: string; from: string};

// TODO: The client-api does not currently allow for outgoing messages to be
// declared as the result of a wallet API call.
// Nor does it allow for multiple channel results
type Result = Promise<{outbox: Outgoing[]; channelResults: ChannelResult[]}>;
export type WalletInterface = {
  // App channel management
  createChannel(args: CreateChannelParams): Result;
  joinChannel(args: JoinChannelParams): Result;
  updateChannel(args: UpdateChannelParams): Result;
  closeChannel(args: CloseChannelParams): Result;
  getChannels(): Result;
  getState(args: GetStateParams): Result;

  // Wallet <-> Wallet communication
  pushMessage(m: AddressedMessage): Promise<{response?: Message; outbox?: Outgoing[]}>;

  // Wallet -> App communication
  onNotification(cb: (notice: Notification) => void): {unsubscribe: () => void};
};

export class Wallet implements WalletInterface {
  async createChannel(args: CreateChannelParams): Result {
    return Channel.transaction(async tx => {
      const {participants, appDefinition, appData, allocations} = args;
      const outcome: Outcome = deserializeAllocations(allocations);
      // TODO: How do we pick a signing address?
      const signingAddress = (await SigningWallet.query().first())?.address;

      const channelConstants: ChannelConstants = {
        channelNonce: await Nonce.next(participants.map(p => p.signingAddress)),
        participants: participants.map(convertToParticipant),
        chainId: '0x01',
        challengeDuration: 9001,
        appDefinition,
      };

      const vars: SignedStateVarsWithHash[] = [];

      const cols = {...channelConstants, vars, signingAddress};

      const {channelId} = await Channel.query(tx).insert(cols);

      const {outgoing, channelResult} = await Store.signState(
        channelId,
        {...channelConstants, turnNum: 0, isFinal: false, appData, outcome},
        tx
      );

      return {outbox: outgoing.map(n => n.notice), channelResults: [channelResult]};
    });
  }

  async joinChannel({channelId}: JoinChannelParams): Result {
    const {outbox} = await knex.transaction(
      async (tx): Promise<{outbox: any}> => {
        const channel = await Store.getChannel(channelId, tx);

        if (!channel)
          throw new JoinChannel.JoinChannelError(JoinChannel.Errors.channelNotFound, {
            channelId,
          });

        const nextState = getOrThrow(JoinChannel.joinChannel({channelId}, channel));
        const {outgoing} = await Store.signState(channelId, nextState, tx);

        return {outbox: outgoing.map(n => n.notice)};
      }
    );

    const {channelResults, outbox: nextOutbox} = await takeActions([channelId]);

    return {outbox: outbox.concat(nextOutbox), channelResults};
  }

  async updateChannel({channelId, allocations, appData}: UpdateChannelParams): Result {
    return knex.transaction(async tx => {
      const channel = await Store.getChannel(channelId, tx);

      if (!channel)
        throw new UpdateChannel.UpdateChannelError(
          UpdateChannel.UpdateChannelError.reasons.channelNotFound,
          {
            channelId,
          }
        );

      const outcome = deserializeAllocations(allocations);

      const nextState = getOrThrow(
        UpdateChannel.updateChannel({channelId, appData, outcome}, channel)
      );
      const {outgoing, channelResult} = await Store.signState(channelId, nextState, tx);

      return {outbox: outgoing.map(n => n.notice), channelResults: [channelResult]};
    });
  }

  async closeChannel(_args: CloseChannelParams): Result {
    throw 'Unimplemented';
  }
  async getChannels(): Result {
    throw 'Unimplemented';
  }

  async getState({channelId}: GetStateParams): Result {
    try {
      const {channelResult} = await Channel.query()
        .where({channelId})
        .first();

      return {
        channelResults: [channelResult],
        outbox: [],
      };
    } catch (err) {
      logger.error({err}, 'Could not get channel');
      throw err; // FIXME: Wallet shoudl return ChannelNotFound
    }
  }

  async pushMessage(message: AddressedMessage): Result {
    const channelIds = await Channel.transaction(async tx => {
      return await Store.pushMessage(message, tx);
    });

    const {channelResults, outbox} = await takeActions(channelIds);

    return {outbox, channelResults};
  }
  onNotification(_cb: (notice: Notification) => void): {unsubscribe: () => void} {
    throw 'Unimplemented';
  }
}

type ExecutionResult = {
  outbox: Outgoing[];
  channelResults: ClientChannelResult[];
  error?: any;
};

const takeActions = async (channels: Bytes32[]): Promise<ExecutionResult> => {
  const outbox: Outgoing[] = [];
  const channelResults: ClientChannelResult[] = [];
  let error: Error | undefined = undefined;
  while (channels.length && !error) {
    await knex.transaction(async tx => {
      const setError = async (e: Error): Promise<void> => {
        error = e;
        await tx.rollback(error);
      };
      const markChannelAsDone = async (): Promise<any> => {
        channels.shift() as string;
      };

      const doAction = async (action: ProtocolAction): Promise<any> => {
        switch (action.type) {
          case 'SignState': {
            const {outgoing, channelResult} = await Store.signState(action.channelId, action, tx);
            outgoing.map(n => outbox.push(n.notice));
            channelResults.push(channelResult);
            return;
          }
          default:
            throw 'Unimplemented';
        }
      };

      // For the moment, we are only considering directly funded app channels.
      // Thus, we can directly fetch the channel record, and immediately construct the protocol state from it.
      // In the future, we can have an App model which collects all the relevant channels for an app channel,
      // and a Ledger model which stores ledger-specific data (eg. queued requests)
      const app = await Store.getChannel(channels[0], tx);

      if (!app) {
        setError(new Error('Channel not found'));

        throw 'unreachable';
      }

      try {
        const nextAction = await Application.protocol({app});
        // TODO: doAction might also throw an error.
        // It would be nice for doAction to return an Either type, pipe the right values,
        // and handle the left values with setError
        await Either.fold(setError, Option.fold(markChannelAsDone, doAction))(nextAction);
      } catch (err) {
        // TODO This code should not need to catch an arbitrary, unknown error.
        // doAction could return an Either, and then the error can be handled more explicitly
        // See https://github.com/statechannels/statechannels/issues/2379
        logger.error({err}, 'Error handling action');
        await setError(err);
      }
    });
  }

  return {outbox, error, channelResults};
};

// TODO: This should be removed, and not used externally.
// It is a fill-in until the wallet API is specced out.
export function getOrThrow<E, T>(result: Either.Either<E, T>): T {
  return Either.getOrElseW<E, T>(
    (err: E): T => {
      throw err;
    }
  )(result);
}
