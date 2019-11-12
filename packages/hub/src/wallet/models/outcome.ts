import {Address} from 'fmg-core';
import {Model, snakeCaseMappers} from 'objection';
import Allocation from './allocation';
import ChannelState from './channelState';

export default class Outcome extends Model {
  static tableName = 'outcomes';

  static get columnNameMappers() {
    return snakeCaseMappers();
  }

  static relationMappings = {
    state: {
      relation: Model.BelongsToOneRelation,
      modelClass: ChannelState,
      join: {
        from: 'outcomes.channel_state_id',
        to: 'channel_states.id'
      }
    },
    allocation: {
      relation: Model.HasManyRelation,
      modelClass: `${__dirname}/allocation`,
      join: {
        from: 'outcomes.id',
        to: 'allocations.outcome_id'
      }
    }
  };

  readonly id!: number;
  state!: ChannelState;
  assetHolderAddress!: Address;
  allocation!: Allocation[];
  tagetChannelId: string;
}
