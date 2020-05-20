import WebTorrent, {Torrent, TorrentOptions} from 'webtorrent';
import paidStreamingExtension, {PaidStreamingExtensionOptions} from './pse-middleware';
import {
  ClientEvents,
  ExtendedTorrent,
  PaidStreamingExtensionEvents,
  PaidStreamingExtensionNotices,
  PaidStreamingTorrent,
  PaidStreamingWire,
  PeersByTorrent,
  TorrentEvents,
  WebTorrentAddInput,
  WebTorrentSeedInput,
  WireEvents
} from './types';
import {ChannelState, PaymentChannelClient} from '../clients/payment-channel-client';
import {
  defaultTrackers,
  WEI_PER_BYTE,
  INITIAL_SEEDER_BALANCE,
  BLOCK_LENGTH,
  PEER_TRUST
} from '../constants';
import {Message} from '@statechannels/client-api-schema';
import {utils} from 'ethers';
import {logger} from '../logger';
import {track} from '../analytics';
import _ from 'lodash';
const hexZeroPad = utils.hexZeroPad;

const bigNumberify = utils.bigNumberify;
// To enable logs in the browser, run `localStorage.debug = "web3torrent:*"`
const log = logger.child({module: 'web3torrent-lib'});

export type TorrentCallback = (torrent: Torrent) => any;

export * from './types';

// A Whimsical diagram explaining the functionality of Web3Torrent: https://whimsical.com/Sq6whAwa8aTjbwMRJc7vPU
export default class WebTorrentPaidStreamingClient extends WebTorrent {
  peersList: PeersByTorrent;
  torrents: PaidStreamingTorrent[] = [];
  paymentChannelClient: PaymentChannelClient;

  pseAccount: string;
  outcomeAddress: string;

  static torrentUpdatedEventPrefix: string = 'torrentUpdated';

  constructor(opts: WebTorrent.Options & Partial<PaidStreamingExtensionOptions> = {}) {
    super(opts);
    this.peersList = {};
    this.pseAccount = opts.pseAccount;
    this.paymentChannelClient = opts.paymentChannelClient;
    this.outcomeAddress = opts.outcomeAddress;
  }

  async enable() {
    if (!this.pseAccount || !this.outcomeAddress) {
      await this.paymentChannelClient.enable();
      this.pseAccount = this.paymentChannelClient.mySigningAddress;
      log.info({pseAccount: this.pseAccount}, 'set pseAccount to sc-wallet signing address');
      this.outcomeAddress = this.paymentChannelClient.myEthereumSelectedAddress;
      log.info(
        {outcomeAddress: this.outcomeAddress},
        'set outcomeAddress to sc-wallet web3 wallet address'
      );
      this.tracker.getAnnounceOpts = () => ({pseAccount: this.pseAccount});
    }
  }

  async disable() {
    log.warn('Disabling WebTorrentPaidStreamingClient');
    this.pseAccount = null;
    this.outcomeAddress = null;
  }

  seed(
    input: WebTorrentSeedInput,
    optionsOrCallback?: TorrentOptions | TorrentCallback,
    callback?: TorrentCallback
  ): PaidStreamingTorrent {
    this.ensureEnabled();

    const options =
      typeof optionsOrCallback === 'function'
        ? {createdBy: this.pseAccount, announce: defaultTrackers}
        : {
            createdBy: this.pseAccount,
            announce: defaultTrackers,
            ...optionsOrCallback
          };

    const torrent = super.seed(input, options, callback) as PaidStreamingTorrent;
    this.setupTorrent(torrent);

    return torrent;
  }

  add(
    input: WebTorrentAddInput,
    optionsOrCallback?: TorrentOptions | TorrentCallback,
    callback?: TorrentCallback
  ): PaidStreamingTorrent {
    this.ensureEnabled();
    let torrent: PaidStreamingTorrent;

    if (typeof optionsOrCallback === 'function') {
      torrent = super.add(input, optionsOrCallback) as PaidStreamingTorrent;
    } else {
      torrent = super.add(input, optionsOrCallback, callback) as PaidStreamingTorrent;
    }
    this.setupTorrent(torrent);

    return torrent;
  }

  pause(infoHash: string) {
    log.info('> Peer pauses download: Pause torrent, eventual close PaymentChannels');
    const torrent = this.torrents.find(t => t.infoHash === infoHash);
    if (torrent) {
      torrent.pause(); // the paymentChannelClosing is done at the moment of payment
      this.emitTorrentUpdated(infoHash);
    } else {
      throw new Error('No torrent found');
    }
  }

  async cancel(infoHash: string) {
    log.info('> Cancelling download. Closing payment channels, and then removing torrent');
    const torrent = this.torrents.find(t => t.infoHash === infoHash);
    if (torrent) {
      await this.closeChannels(torrent, true);
      torrent.destroy(() => this.emitTorrentUpdated(infoHash));
    } else {
      throw new Error('No torrent found');
    }
  }

  blockPeer(torrentInfoHash: string, wire: PaidStreamingWire) {
    wire.paidStreamingExtension.stop();
    this.emit(ClientEvents.PEER_STATUS_CHANGED, {
      torrentPeers: this.peersList[torrentInfoHash],
      torrentInfoHash,
      peerAccount: wire.paidStreamingExtension.peerAccount,
      seedingChannelId: wire.paidStreamingExtension.seedingChannelId
    });
    log.info(
      {
        from: this.peersList[torrentInfoHash],
        peerAccount: wire.paidStreamingExtension.peerAccount,
        seedingChannelId: wire.paidStreamingExtension.seedingChannelId
      },
      `<< blockPeer`
    );
  }

  unblockPeer(torrentInfoHash: string, wire: PaidStreamingWire) {
    log.info(
      {
        from: Object.keys(this.peersList),
        peerAccount: wire.paidStreamingExtension.peerAccount,
        seedingChannelId: wire.paidStreamingExtension.seedingChannelId
      },
      '<< unblockPeer: start'
    );
    wire.paidStreamingExtension.start();
    this.emit(ClientEvents.PEER_STATUS_CHANGED, {
      torrentPeers: this.peersList[torrentInfoHash],
      torrentInfoHash,
      peerAccount: wire.paidStreamingExtension.peerAccount,
      seedingChannelId: wire.paidStreamingExtension.seedingChannelId
    });
    log.info(
      {
        from: this.peersList[torrentInfoHash],
        peerAccount: wire.paidStreamingExtension.peerAccount,
        seedingChannelId: wire.paidStreamingExtension.seedingChannelId
      },
      '<< unblockPeer: finish'
    );
  }

  // Note, this is only used by unit tests.
  togglePeerByChannel(torrentInfoHash: string, channelId: string) {
    const {wire} = this.peersList[torrentInfoHash][channelId];
    if (!(wire as PaidStreamingWire).paidStreamingExtension.isForceChoking) {
      this.blockPeer(torrentInfoHash, wire as PaidStreamingWire);
    } else {
      this.unblockPeer(torrentInfoHash, wire as PaidStreamingWire);
    }
  }

  protected ensureEnabled() {
    if (!(this.pseAccount && this.outcomeAddress)) {
      throw new Error('WebTorrentPaidStreamingClient is not enabled');
    }
  }

  protected setupWire(torrent: Torrent, wire: PaidStreamingWire) {
    log.info('Wire setup initiated');
    log.trace({wire});

    wire.use(
      paidStreamingExtension({
        pseAccount: this.pseAccount,
        outcomeAddress: this.outcomeAddress
      })
    );
    wire.setKeepAlive(true);
    wire.setTimeout(65000);
    wire.on(WireEvents.KEEP_ALIVE, () => {
      log.info({keepAlive: !torrent.done && wire.amChoking}, 'wire keep-alive');
      log.trace({torrent});
      if (!torrent.done && wire.amChoking) {
        wire._clearTimeout();
      }
      this.emitTorrentUpdated(torrent.infoHash);
    });

    wire.paidStreamingExtension.on(
      PaidStreamingExtensionEvents.REQUEST,
      async (index: number, size: number, response: (allow: boolean) => void) => {
        const reqPrice = bigNumberify(size).mul(WEI_PER_BYTE);
        const {seedingChannelId, peerAccount: peer, isForceChoking} = wire.paidStreamingExtension;
        const knownPeer = this.peersList[torrent.infoHash][seedingChannelId];

        if (!knownPeer || !seedingChannelId) {
          await this.createPaymentChannel(torrent, wire);
          log.info(`${peer} >> REQUEST BLOCKED (NEW WIRE): ${index}`);
          response(false);
          this.blockPeer(torrent.infoHash, wire);
        } else if (isForceChoking || reqPrice.gt(knownPeer.buffer)) {
          log.info(`${peer} >> REQUEST BLOCKED: ${index} UPLOADED: ${knownPeer.uploaded}`);
          response(false);
          this.blockPeer(torrent.infoHash, wire); // As soon as buffer is empty, block
        } else {
          this.peersList[torrent.infoHash][seedingChannelId] = {
            ...knownPeer,
            wire,
            buffer: bigNumberify(knownPeer.buffer)
              .sub(reqPrice) // decrease buffer by the price of this request
              .toString(),
            uploaded: knownPeer.uploaded + size
          };

          const {buffer, uploaded} = this.peersList[torrent.infoHash][seedingChannelId];
          log.info(
            {seedingChannelId, peerAccout: peer, reqPrice, index, buffer, uploaded},
            `${peer} >> REQUEST ALLOWED: ${index} BUFFER: ${buffer} UPLOADED: ${uploaded}`
          );
          response(true);
        }
        this.emitTorrentUpdated(torrent.infoHash);
      }
    );

    wire.paidStreamingExtension.on(PaidStreamingExtensionEvents.NOTICE, notice => {
      torrent.emit(PaidStreamingExtensionEvents.NOTICE, wire, notice);
      this.emitTorrentUpdated(torrent.infoHash);
    });

    // If the wallet queues a message, send it across the wire
    this.paymentChannelClient.onMessageQueued((message: Message) => {
      if (message.recipient === wire.paidStreamingExtension.peerAccount) {
        wire.paidStreamingExtension.sendMessage(JSON.stringify(message));
      }
    });

    // If a channel is proposed, join it
    this.paymentChannelClient.onChannelProposed(async (channelState: ChannelState) => {
      if (!this.paymentChannelClient.amProposer(channelState)) {
        // do not pass a channelId, since this is the first we heard about this channel and it won't be cached
        // only join if counterparty proposed
        await this.paymentChannelClient.joinChannel(channelState.channelId);
        log.info(`<< Joined channel ${channelState.channelId}`);
      }
    });

    this.paymentChannelClient.onChannelUpdated(async (channelState: ChannelState) => {
      const {seedingChannelId, leechingChannelId, peerAccount} = wire.paidStreamingExtension;

      if (
        channelState.channelId === seedingChannelId ||
        channelState.channelId === leechingChannelId
      ) {
        if (channelState.status === 'closed' || channelState.status === 'closing') {
          wire.paidStreamingExtension.seedingChannelId = null;
          wire.paidStreamingExtension.leechingChannelId = null;
          log.info(
            `PeerAccount ${peerAccount} - ChannelId ${channelState.channelId} Channel Closed||Closing`
          );
        }
        // filter to updates for the channel on this wire
        log.info(`Channel updated to turnNum ${channelState.turnNum}`);
        if (this.paymentChannelClient.shouldSendSpacerState(channelState)) {
          // send "spacer" state
          await this.paymentChannelClient.acceptChannelUpdate(channelState);
          log.info('sent spacer state, now sending STOP');
          this.blockPeer(torrent.infoHash, wire);
        } else if (this.paymentChannelClient.isPaymentToMe(channelState)) {
          // Accepting payment, refilling buffer and unblocking
          await this.paymentChannelClient.acceptChannelUpdate(channelState);
          await this.refillBuffer(torrent.infoHash, channelState.channelId);
          this.unblockPeer(torrent.infoHash, wire);
          // TODO: only unblock if the buffer is large enough
        }
      }
    });
    log.info(
      {
        wire: {
          paidStreamingExtension: wire.paidStreamingExtension?.serialize()
        }
      },
      'Wire Setup completed'
    );
  }

  protected async createPaymentChannel(torrent: WebTorrent.Torrent, wire: PaidStreamingWire) {
    const {peerAccount, peerOutcomeAddress} = wire.paidStreamingExtension;

    const {channelId} = await this.paymentChannelClient.createChannel(
      this.pseAccount, // seeder
      peerAccount, // leecher
      hexZeroPad(INITIAL_SEEDER_BALANCE.toHexString(), 32), // seederBalance,
      hexZeroPad(WEI_PER_BYTE.mul(torrent.length).toHexString(), 32), // leecherBalance,
      this.paymentChannelClient.myEthereumSelectedAddress, // seederOutcomeAddress,
      peerOutcomeAddress // leecherOutcomeAddress
    );

    wire.paidStreamingExtension.seedingChannelId = channelId;
    this.peersList[torrent.infoHash][channelId] = {
      id: peerAccount,
      wire,
      buffer: '0', // (bytes) a value x > 0 would allow a leecher to download x bytes
      beneficiaryBalance: '0', // (wei)
      uploaded: 0
    };

    log.info(`${peerAccount} >> Channel Created - ID: ${channelId}`);
    return channelId;
  }

  /**
   * Refill the buffer for a peer in a torrent, querying the channelClient for the updated balance.
   */
  protected refillBuffer(infoHash: string, channelId: string) {
    const peer = this.peersList[infoHash][channelId];
    if (!peer) {
      throw new Error(`>> Received payment in channel ${channelId} but peer not known!`);
    }
    // querying channel client for updated balance
    const newBalance = bigNumberify(
      this.paymentChannelClient.channelCache[channelId].beneficiaryBalance
    );
    // infer payment using update balance and previously stored balance
    const payment = bigNumberify(newBalance.sub(bigNumberify(peer.beneficiaryBalance)));
    // store new balance

    peer.beneficiaryBalance = newBalance.toString();
    // convert payment into buffer units (bytes)
    peer.buffer = bigNumberify(peer.buffer)
      .add(payment.div(WEI_PER_BYTE)) // This must remain an integer as long as our check above uses .isZero()
      // ethers BigNumbers are always integers
      .toString();

    log.info(
      `${channelId} >> Refill: Balance ${newBalance} payment: ${payment} buffer: ${peer.buffer}`
    );
  }

  protected setupTorrent(torrent: PaidStreamingTorrent) {
    if (torrent.usingPaidStreaming) {
      return torrent;
    }
    torrent.on(TorrentEvents.INFOHASH, () => {
      this.peersList = {...this.peersList, [torrent.infoHash]: {}};
      this.emitTorrentUpdated(torrent.infoHash);
    });
    torrent.on(TorrentEvents.WIRE, (wire: PaidStreamingWire) => {
      this.setupWire(torrent, wire);
      this.emitTorrentUpdated(torrent.infoHash);
    });

    torrent.on(TorrentEvents.NOTICE, async (wire, {command, data}) => {
      switch (command) {
        case PaidStreamingExtensionNotices.STOP: // synonymous with a prompt for a payment
          if (torrent.paused) {
            // We currently treat pausing torrent as canceling downloads
            log.info({data}, 'Closing torrent');
            await this.closeChannels(torrent);
          } else if (!torrent.done || !torrent.destroyed) {
            log.info({data}, 'Making payment');
            await this.makePayment(torrent, wire);
          }
          break;
        case PaidStreamingExtensionNotices.START:
          this.jumpStart(torrent, wire);
          break;
        case PaidStreamingExtensionNotices.MESSAGE:
          log.info({data}, 'Message received');
          await this.paymentChannelClient.pushMessage(data);
          break;
      }
      this.emit(ClientEvents.TORRENT_NOTICE, {torrent, wire, command, data});
      this.emitTorrentUpdated(torrent.infoHash);
    });

    torrent.on(TorrentEvents.DONE, async () => {
      log.info({torrent, channels: this.paymentChannelClient.channelCache}, '<< TORRENT DONE!');
      torrent.wires.map(wire => {
        const {leechingChannelId: channelId} = wire.paidStreamingExtension;
        const channelOfWire = this.paymentChannelClient.channelCache[channelId];
        if (channelOfWire) {
          const balance = bigNumberify(channelOfWire.beneficiaryBalance).toString();
          const downloaded = wire.downloaded;
          log.info(`<< DONE! Channel ${channelId} Balance: ${balance} Downloaded ${downloaded}`);
        }
      });
      log.trace({torrent, peers: this.peersList[torrent.infoHash]});

      this.emit(ClientEvents.TORRENT_DONE, {torrent});
      await this.closeChannels(torrent);
      track('Torrent Starting Seeding', {
        infoHash: torrent.infoHash,
        magnetURI: torrent.magnetURI,
        filename: torrent.name,
        filesize: torrent.length
      });
      this.emitTorrentUpdated(torrent.infoHash);
    });

    torrent.on(TorrentEvents.ERROR, err => {
      log.error({err, torrent}, 'Torrent ERROR');
      this.emit(ClientEvents.TORRENT_ERROR, {torrent, err});
      this.emitTorrentUpdated(torrent.infoHash);
    });

    torrent.on(TorrentEvents.DOWNLOAD, () => this.emitTorrentUpdated(torrent.infoHash));
    torrent.on(TorrentEvents.NOPEERS, () => this.emitTorrentUpdated(torrent.infoHash));
    torrent.on(TorrentEvents.METADATA, () => this.emitTorrentUpdated(torrent.infoHash));
    torrent.on(TorrentEvents.READY, () => this.emitTorrentUpdated(torrent.infoHash));
    torrent.on(TorrentEvents.UPLOAD, () => this.emitTorrentUpdated(torrent.infoHash));
    torrent.on(TorrentEvents.WARNING, () => this.emitTorrentUpdated(torrent.infoHash));

    torrent.usingPaidStreaming = true;
    return torrent;
  }

  // TODO: make this publicly accesible and not in an error handler. (when we get a pause/resume button)
  // TODO: make this work okay (takes a long time to restart)
  protected resumeTorrent(infoHash: string) {
    const torrent = super.get(infoHash);
    if (torrent && torrent.paused) {
      torrent.resume();
    } else {
      throw new Error('Invalid infoHash of torrent to resume: ' + infoHash);
    }
  }

  /**
   * Define the amount to pay, and makes the payment
   */
  protected async makePayment(torrent: PaidStreamingTorrent, wire: PaidStreamingWire) {
    if (torrent.paused) {
      log.info('Torrent Paused - makePayment early exit', torrent);
      return;
    }
    const {leechingChannelId, peerAccount} = wire.paidStreamingExtension;

    let numBlocksToPayFor = wire.requests.length > PEER_TRUST ? PEER_TRUST : wire.requests.length;
    let tailBytes = 0;

    // On each wire, the algorithm tries to download the uneven piece (which is always the last piece)
    if (this.isAboutToPayForLastPiece(torrent, peerAccount)) {
      numBlocksToPayFor = numBlocksToPayFor - 1;
      tailBytes = torrent.store.store.lastChunkLength;
    }

    const amountToPay = WEI_PER_BYTE.mul(BLOCK_LENGTH * numBlocksToPayFor + tailBytes);
    log.info(`<< STOP ${peerAccount} - About to pay ${amountToPay.toString()}`);
    await this.paymentChannelClient.makePayment(leechingChannelId, amountToPay.toString());

    const balance =
      this.paymentChannelClient.channelCache[leechingChannelId] &&
      bigNumberify(
        this.paymentChannelClient.channelCache[leechingChannelId].beneficiaryBalance
      ).toString();
    log.info(`<< Payment - Peer ${peerAccount} Balance: ${balance} Downloaded ${wire.downloaded}`);
  }

  private isAboutToPayForLastPiece(torrent: PaidStreamingTorrent, peerAccount: string) {
    const lastPieceReservations: PaidStreamingWire[] =
      torrent._reservations && torrent._reservations[torrent.pieces.length - 1];
    if (!lastPieceReservations || !lastPieceReservations.length) return false;

    const lastPieceIsReservedToThisWire = lastPieceReservations.some(
      wire => wire && wire.paidStreamingExtension.peerAccount === peerAccount
    );
    return lastPieceIsReservedToThisWire;
  }

  // Close any channels that I am downloading from or seeding to
  protected async closeChannels(torrent: PaidStreamingTorrent, includeSeedChannels = false) {
    await Promise.all(
      torrent.wires.map(async wire => {
        const {seedingChannelId, leechingChannelId} = wire.paidStreamingExtension;
        if (leechingChannelId) {
          log.info(`About to close payment channel ${leechingChannelId}`);
          await this.paymentChannelClient.getLatestPaymentReceipt(leechingChannelId);
          await this.paymentChannelClient.closeChannel(leechingChannelId);
          wire.paidStreamingExtension.leechingChannelId = null;
          log.info(`Channel ${leechingChannelId} closed`);
        }

        if (includeSeedChannels && seedingChannelId) {
          // TODO: do we need to make something like getLatestPaymentReceipt for this case?
          log.info(`About to close paying channel ${seedingChannelId}`);
          await this.paymentChannelClient.closeChannel(seedingChannelId);
          wire.paidStreamingExtension.seedingChannelId = null;
          log.info(`Channel ${seedingChannelId} closed`);
        }
      })
    );
  }

  /**
   * Jumpstart a torrent wire download, after being stopped by a peer.
   */
  protected jumpStart(torrent: ExtendedTorrent, wire: PaidStreamingWire) {
    if (torrent.done) {
      log.info('<< JUMPSTART: FINISHED');
      log.trace({torrent, wire});
      return;
    }
    log.info({requests: wire.requests}, `<< START ${wire.paidStreamingExtension.peerAccount}`);
    log.trace({pieces: torrent.pieces});
    (torrent as any)._updateWireWrapper(wire); // TODO: fix this type, if its the solution
  }

  private emitTorrentUpdated(infoHash) {
    this.emit(WebTorrentPaidStreamingClient.torrentUpdatedEventName(infoHash));
  }

  public static torrentUpdatedEventName(infoHash) {
    return this.torrentUpdatedEventPrefix + infoHash;
  }
}
