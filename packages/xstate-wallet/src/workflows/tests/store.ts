import {MemoryStore, Funding} from '../../store/memory-store';
import {MemoryChannelStoreEntry} from '../../store/memory-channel-storage';
import {SignedState} from '../../store/types';
import {hashState} from '../../store/state-utils';
import {Guid} from 'guid-typescript';

export class TestStore extends MemoryStore {
  public _ledgers: Record<string, string> = {};
  public _channelLocks: Record<string, Guid | undefined> = {};

  public setLedger(entry: MemoryChannelStoreEntry) {
    const {channelId} = entry;
    this._channels[channelId] = entry;

    const peerId = entry.participants.find(p => p.signingAddress !== this.getAddress());
    if (peerId) this._ledgers[peerId.participantId] = channelId;
    else throw 'No peer';
  }

  public createEntry(signedState: SignedState, funding?: Funding): MemoryChannelStoreEntry {
    const myIndex = signedState.participants
      .map(p => p.signingAddress)
      .findIndex(a => a === this.getAddress());
    const entry = new MemoryChannelStoreEntry(
      signedState,
      myIndex,
      {[hashState(signedState)]: signedState},
      {[hashState(signedState)]: signedState.signatures},
      funding
    );
    this._channels[entry.channelId] = entry;

    return entry;
  }
}
