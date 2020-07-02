import {Message} from '@statechannels/wallet-components/lib/src/store/types';
import {Observable, fromEvent} from 'rxjs';
import {EventEmitter} from 'eventemitter3';
import {createSignatureEntry} from '@statechannels/wallet-components/lib/src/store/state-utils';
import {ethers} from 'ethers';

export class SimpleHub {
  constructor(
    private readonly privateKey: string,
    private readonly _eventEmitter = new EventEmitter()
  ) {}

  public get outboxFeed(): Observable<Message> {
    return fromEvent(this._eventEmitter, 'addToOutbox');
  }

  public async pushMessage({signedStates}: Message) {
    const address = await this.getAddress();
    signedStates?.map(signedState => {
      const {signatures, participants} = signedState;

      const hubIdx = participants.findIndex(p => p.signingAddress === address);
      if (hubIdx > -1) {
        signatures.push(createSignatureEntry(signedState, this.privateKey));

        this._eventEmitter.emit('addToOutbox', {
          signedStates: [{...signedState, signatures}],
          from: 'hub'
        });
      }
    });
  }

  public async getAddress() {
    return new ethers.Wallet(this.privateKey).address;
  }
}
