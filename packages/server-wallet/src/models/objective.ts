import {objectiveId, Objective as ObjectiveType} from '@statechannels/wallet-core';
import {Model, TransactionOrKnex} from 'objection';

import {ObjectiveStoredInDB} from '../wallet/store';

function extract(objective: Objective): ObjectiveStoredInDB {
  return {
    ...objective,
    participants: [],
    data: objective.data as any, // Here we will trust that the row respects our types
  };
}

function extractReferencedChannels(objective: ObjectiveType): string[] {
  switch (objective.type) {
    case 'OpenChannel':
    case 'CloseChannel':
    case 'VirtuallyFund':
      return [objective.data.targetChannelId];
    case 'FundGuarantor':
      return [objective.data.guarantorId];
    case 'FundLedger':
    case 'CloseLedger':
      return [objective.data.ledgerId];
    default:
      return [];
  }
}

export class ObjectiveChannel extends Model {
  readonly objectiveId!: ObjectiveStoredInDB['objectiveId'];
  readonly channelId!: string;

  static tableName = 'objectives_channels';
  static get idColumn(): string[] {
    return ['objectiveId', 'channelId'];
  }
}

export class Objective extends Model {
  readonly objectiveId!: ObjectiveStoredInDB['objectiveId'];
  readonly status!: ObjectiveStoredInDB['status'];
  readonly type!: ObjectiveStoredInDB['type'];
  readonly data!: ObjectiveStoredInDB['data'];

  static tableName = 'objectives';
  static get idColumn(): string[] {
    return ['objectiveId'];
  }

  static relationMappings = {
    objectiveChannels: {
      relation: Model.ManyToManyRelation,
      modelClass: ObjectiveChannel,
      join: {
        from: `${Objective.tableName}.objectiveId`,
        through: {
          from: 'objectives_channels.objectiveId',
          to: 'objectives_channels.channelId',
        },
        to: 'channels.channelId',
      },
    },
  };

  static async insert(
    objectiveToBeStored: ObjectiveType & {
      status: 'pending' | 'approved' | 'rejected' | 'failed' | 'succeeded';
    },
    tx: TransactionOrKnex
  ): Promise<Objective> {
    const id: string = objectiveId(objectiveToBeStored);

    const objective = await Objective.query(tx).insert({
      objectiveId: id,
      status: objectiveToBeStored.status,
      type: objectiveToBeStored.type,
      data: objectiveToBeStored.data,
    });

    // Associate the objective with any channel that it references
    // By inserting an ObjectiveChannel row for each channel
    // Requires objective and channels to exist
    extractReferencedChannels(objectiveToBeStored).map(
      async value => await ObjectiveChannel.query(tx).insert({objectiveId: id, channelId: value})
    );
    return objective;
  }

  static async forId(objectiveId: string, tx: TransactionOrKnex): Promise<ObjectiveStoredInDB> {
    const objective = await Objective.query(tx).findById(objectiveId);
    return extract(objective);
  }

  static async approve(objectiveId: string, tx: TransactionOrKnex): Promise<void> {
    await Objective.query(tx)
      .findById(objectiveId)
      .patch({status: 'approved'});
  }

  static async succeed(objectiveId: string, tx: TransactionOrKnex): Promise<void> {
    await Objective.query(tx)
      .findById(objectiveId)
      .patch({status: 'succeeded'});
  }

  static async forTargetChannelId(
    targetChannelId: string,
    tx: TransactionOrKnex
  ): Promise<ObjectiveStoredInDB[]> {
    return (
      await Objective.query(tx).select(
        Objective.relatedQuery('objectivesChannels')
          .select()
          .where({channelId: targetChannelId})
      )
    ).map(extract);
  }

  static async forTargetChannelIds(
    targetChannelIds: string[],
    tx: TransactionOrKnex
  ): Promise<ObjectiveStoredInDB[]> {
    return (
      await Objective.query(tx).select(
        Objective.relatedQuery('objectivesChannels')
          .select()
          .whereIn('channelId', targetChannelIds)
      )
    ).map(extract);
  }
}
