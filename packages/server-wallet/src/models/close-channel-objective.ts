import {CloseChannel} from '@statechannels/wallet-core';
import {Model, TransactionOrKnex} from 'objection';

import {ObjectiveStoredInDB} from '../wallet/store';

function extract(
  objective: CloseChannelObjective | undefined
):
  | (CloseChannel & {
      objectiveId: number;
      status: 'pending' | 'approved' | 'rejected' | 'failed' | 'succeeded';
    })
  | undefined {
  if (objective === undefined) return undefined;
  return {
    objectiveId: objective.objectiveId,
    status: objective.status,
    type: 'CloseChannel',
    participants: [],
    data: {
      targetChannelId: objective.targetChannelId,
    },
  };
}

export class CloseChannelObjective extends Model {
  readonly objectiveId!: ObjectiveStoredInDB['objectiveId'];
  readonly status!: ObjectiveStoredInDB['status'];
  readonly type!: 'CloseChannel';
  readonly targetChannelId!: string;

  static tableName = 'close-channel-objectives';
  static get idColumn(): string[] {
    return ['objectiveId'];
  }

  static async insert(
    objectiveToBeStored: ObjectiveStoredInDB,
    tx: TransactionOrKnex
  ): Promise<CloseChannelObjective> {
    if (objectiveToBeStored.type !== 'CloseChannel')
      throw Error(
        'You may only store an CloseChannel objective in the close-channel-objectives tables'
      );
    return CloseChannelObjective.query(tx).insert({
      objectiveId: objectiveToBeStored.objectiveId,
      status: objectiveToBeStored.status,
      type: 'CloseChannel',
      targetChannelId: objectiveToBeStored.data.targetChannelId,
    });
  }

  static async forTargetChannelId(
    targetChannelId: string,
    tx: TransactionOrKnex
  ): Promise<
    | (CloseChannel & {
        objectiveId: number;
        status: 'pending' | 'approved' | 'rejected' | 'failed' | 'succeeded';
      })
    | undefined
  > {
    const objective = await CloseChannelObjective.query(tx)
      .select()
      .first()
      .where({targetChannelId: targetChannelId});
    if (!objective) return undefined;
    return extract(objective);
  }

  static async forTargetChannelIds(
    targetChannelIds: string[],
    tx: TransactionOrKnex
  ): Promise<
    (
      | (CloseChannel & {
          objectiveId: number;
          status: 'pending' | 'approved' | 'rejected' | 'failed' | 'succeeded';
        })
      | undefined
    )[]
  > {
    const objectives = await CloseChannelObjective.query(tx)
      .select()
      .whereIn('targetChannelId', targetChannelIds);

    return objectives.map(extract);
  }

  static async forId(
    objectiveId: number,
    tx: TransactionOrKnex
  ): Promise<
    | (CloseChannel & {
        objectiveId: number;
        status: 'pending' | 'approved' | 'rejected' | 'failed' | 'succeeded';
      })
    | undefined
  > {
    const objective = await CloseChannelObjective.query(tx).findById(objectiveId);
    if (!objective) return undefined;
    return extract(objective);
  }

  static async approve(objectiveId: number, tx: TransactionOrKnex): Promise<void> {
    await CloseChannelObjective.query(tx)
      .findById(objectiveId)
      .patch({status: 'approved'});
  }

  static async succeed(objectiveId: number, tx: TransactionOrKnex): Promise<void> {
    await CloseChannelObjective.query(tx)
      .findById(objectiveId)
      .patch({status: 'succeeded'});
  }
}
