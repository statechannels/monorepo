import {ChannelStoreEntry} from '../../store/channel-store-entry';
import {SignedState} from '../../store/types';
import {hashState} from '../../store/state-utils';
import {Guid} from 'guid-typescript';
import {XstateStore, Funding, Store} from '../../store';

export class TestStore extends XstateStore implements Store {
  public _channelLocks: Record<string, Guid>;
  public get dbBackend() {
    return this.backend;
  }
  public async createEntry(
    signedState: SignedState,
    opts?: {
      funding?: Funding;
      applicationSite?: string;
    }
  ): Promise<ChannelStoreEntry> {
    const address = await this.getAddress();
    const myIndex = signedState.participants
      .map(p => p.signingAddress)
      .findIndex(a => a === address);
    const {funding, applicationSite} = opts || {};
    const entry = new ChannelStoreEntry({
      channelConstants: signedState,
      myIndex,
      stateVariables: {[hashState(signedState)]: signedState},
      signatures: {[hashState(signedState)]: signedState.signatures},
      funding,
      applicationSite
    });
    await this.backend.setChannel(entry.channelId, entry.data());

    return entry;
  }

  async setLedgerByEntry(entry: ChannelStoreEntry) {
    // This is not on the Store interface itself -- it is useful to set up a test store
    const {channelId} = entry;
    this.backend.setChannel(channelId, entry.data());
    const address = await this.getAddress();
    const peerId = entry.participants.find(p => p.signingAddress !== address);
    if (!peerId) throw 'No peer';
    this.backend.setLedger(peerId?.participantId, channelId);
  }

  async setPrivateKey(address: string, pk: string) {
    await this.backend.setPrivateKey(address, pk);
  }
}
