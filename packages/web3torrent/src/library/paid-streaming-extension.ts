import bencode from 'bencode';
import {Extension} from 'bittorrent-protocol';
import {logger} from '../logger';
import EventEmitter from 'eventemitter3';
import {
  ExtendedHandshake,
  PaidStreamingExtensionEvents,
  PaidStreamingExtensionNotices,
  PaidStreamingWire
} from './types';

const log = logger.child({module: 'paid-streaming-extension'});

export type PaidStreamingExtensionSerialized = Pick<
  PaidStreamingExtension,
  | 'pseAccount'
  | 'pseAddress'
  | 'seedingChannelId'
  | 'peerAccount'
  | 'peerOutcomeAddress'
  | 'leechingChannelId'
  | 'isForceChoking'
  | 'isBeingChoked'
  | 'blockedRequests'
>;

export abstract class PaidStreamingExtension implements Extension {
  protected wire: PaidStreamingWire;
  protected messageBus: EventEmitter;
  protected pseId: string = '';
  protected pseOutcomeAddress: string = '';

  get name(): 'paidStreamingExtension' {
    return 'paidStreamingExtension';
  }

  peerAccount?: string;
  peerOutcomeAddress?: string;

  // channel that another peer uses to pay me.
  seedingChannelId: string;
  // channel that I use to pay another peer.
  leechingChannelId: string;

  isForceChoking = false;
  isBeingChoked = false;

  blockedRequests: [number, number, number][] = [];

  constructor(wireToUse: PaidStreamingWire) {
    this.wire = wireToUse;
    this.messageBus = new EventEmitter();
    this.interceptRequests();
  }

  get pseAccount(): string {
    return this.pseId;
  }

  set pseAccount(value: string) {
    this.pseId = value;
    this.wire.extendedHandshake.pseAccount = value;
  }

  get pseAddress(): string {
    return this.pseOutcomeAddress;
  }

  set pseAddress(value: string) {
    this.pseOutcomeAddress = value;
    this.wire.extendedHandshake.outcomeAddress = value;
  }

  on(event: PaidStreamingExtensionEvents, callback: EventEmitter.ListenerFn<any[]>) {
    this.messageBus.on(event, callback);
  }

  once(event: PaidStreamingExtensionEvents, callback: EventEmitter.ListenerFn<any[]>) {
    this.messageBus.once(event, callback);
  }

  onHandshake(/* infoHash, peerId, extensions */) {}

  onExtendedHandshake(handshake: ExtendedHandshake) {
    if (!handshake.m || !handshake.m[this.name]) {
      log.warn('WARNING: Peer does not support Web3Torrent');
      return this.messageBus.emit(
        PaidStreamingExtensionEvents.WARNING,
        new Error('!>Peer does not support Web3Torrent')
      );
    }

    if (handshake.pseAccount) {
      this.peerAccount = handshake.pseAccount.toString();
    }

    if (handshake.outcomeAddress) {
      this.peerOutcomeAddress = handshake.outcomeAddress.toString();
    }

    this.messageBus.emit(PaidStreamingExtensionEvents.PSE_HANDSHAKE, {
      pseAccount: this.peerAccount,
      peerOutcomeAddress: this.peerOutcomeAddress
    });

    return true;
  }

  stop() {
    this.isForceChoking = true;
    this.executeExtensionCommand(PaidStreamingExtensionNotices.STOP, this.seedingChannelId);
  }

  start() {
    if (this.isForceChoking) {
      this.isForceChoking = false;
      this.executeExtensionCommand(PaidStreamingExtensionNotices.START);
      this.blockedRequests
        .splice(0, this.blockedRequests.length)
        .map(req => this.wire._onRequest(req[0], req[1], req[2]));
    }
  }

  ack() {
    this.executeExtensionCommand(PaidStreamingExtensionNotices.ACK);
  }

  sendMessage(message: string) {
    this.executeExtensionCommand(PaidStreamingExtensionNotices.MESSAGE, {
      message
    });
  }

  onMessage(buffer: Buffer) {
    try {
      const jsonData = bencode.decode(buffer, undefined, undefined, 'utf8');
      this.messageHandler(jsonData);
    } catch (err) {
      log.error(err, 'onMessage decoding or handling');
      return;
    }
  }

  serialize(): PaidStreamingExtensionSerialized {
    return {
      pseAccount: this.pseAccount,
      pseAddress: this.pseAddress,
      seedingChannelId: this.seedingChannelId,
      peerAccount: this.peerAccount,
      peerOutcomeAddress: this.peerOutcomeAddress,
      leechingChannelId: this.leechingChannelId,
      isForceChoking: this.isForceChoking,
      isBeingChoked: this.isBeingChoked,
      blockedRequests: this.blockedRequests
    };
  }

  protected messageHandler({command, data}) {
    switch (command) {
      case PaidStreamingExtensionNotices.ACK:
        return;
      case PaidStreamingExtensionNotices.START:
        log.info(`START received from ${this.peerAccount}`);
        this.isBeingChoked = false;
        break;
      case PaidStreamingExtensionNotices.STOP:
        log.info(`STOP received from ${this.peerAccount}`);
        this.leechingChannelId = data;
        if (this.isBeingChoked) {
          this.ack();
          return;
        }
        this.isBeingChoked = true;
        break;
      case PaidStreamingExtensionNotices.MESSAGE:
        data = JSON.parse(data.message);
        if (data.recipient !== this.pseAccount) {
          return;
        }
        log.info({data}, `MESSAGE received from ${this.peerAccount}`);
        break;
    }
    this.ack();
    this.messageBus.emit(PaidStreamingExtensionEvents.NOTICE, {command, data});
  }

  protected executeExtensionCommand(command: PaidStreamingExtensionNotices, data = {}) {
    if (!this.peerAccount) {
      log.warn(
        'Peer does not support Web3Torrent - This client will block all non-web3torrent leechers.'
      );
      this.messageBus.emit(
        PaidStreamingExtensionEvents.WARNING,
        new Error('!>Peer does not support Web3Torrent')
      );
    } else {
      this.wire.extended(this.name, bencode.encode({msg_type: 0, command, data}));
    }
  }

  protected interceptRequests() {
    const {messageBus, wire} = this;

    // for debugging purposes. It logs when a piece is received
    const _onPiece = wire._onPiece;
    wire._onPiece = function(index, offset, buffer) {
      _onPiece.apply(wire, [index, offset, buffer]);
      log.info(`<< _onPiece: ${index} OFFSET: ${offset} DOWNLOADED: ${wire.downloaded}`);
    };
    const blockedRequests = this.blockedRequests;
    const _onRequest = wire._onRequest;
    wire._onRequest = function(index, offset, length) {
      log.info(`_onRequest: ${index}`);

      if (this.paidStreamingExtension.isForceChoking) {
        blockedRequests.push([index, offset, length]);
        log.info(`_onRequest: ${index}, ${offset}, ${length} - IGNORED`);
      } else {
        messageBus.emit(PaidStreamingExtensionEvents.REQUEST, index, length, function(allow) {
          if (allow) {
            _onRequest.apply(wire, [index, offset, length]);
          } else {
            blockedRequests.push([index, offset, length]);
          }
        });
      }
    };
  }
}
