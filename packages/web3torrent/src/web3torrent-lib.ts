import debug from "debug";
import WebTorrent, {Torrent, TorrentOptions} from "webtorrent";
import paidStreamingExtension, {PaidStreamingExtensionOptions} from "./pse-middleware";
import {
  ClientEvents,
  ExtendedTorrent,
  ExtendedTorrentPiece,
  PaidStreamingExtensionEvents,
  PaidStreamingExtensionNotices,
  PaidStreamingTorrent,
  PaidStreamingWire,
  PeersByTorrent,
  TorrentEvents,
  WebTorrentAddInput,
  WebTorrentSeedInput,
  WireEvents
} from "./types";
const log = debug("web3torrent:library");

export type WebTorrentPaidStreamingClientOptions = WebTorrent.Options & Partial<PaidStreamingExtensionOptions>;
export type TorrentCallback = (torrent: Torrent) => any;

export * from "./types";

export default class WebTorrentPaidStreamingClient extends WebTorrent {
  allowedPeers: PeersByTorrent;
  pseAccount: string;
  torrents: PaidStreamingTorrent[] = [];

  constructor(opts: WebTorrentPaidStreamingClientOptions = {}) {
    super(opts);
    this.allowedPeers = {};
    this.pseAccount = opts.pseAccount || Math.floor(Math.random() * 99999999999999999).toString();
    log("ACCOUNT ID: ", this.pseAccount);
  }

  seed(
    input: WebTorrentSeedInput,
    optionsOrCallback?: TorrentOptions | TorrentCallback,
    callback?: TorrentCallback
  ): PaidStreamingTorrent {
    let torrent: PaidStreamingTorrent;

    if (typeof optionsOrCallback === "function") {
      torrent = super.seed(input, optionsOrCallback) as PaidStreamingTorrent;
    } else {
      torrent = super.seed(input, optionsOrCallback, callback) as PaidStreamingTorrent;
    }

    this.setupTorrent(torrent);
    log("torrent seed created");
    return torrent;
  }

  add(
    input: WebTorrentAddInput,
    optionsOrCallback?: TorrentOptions | TorrentCallback,
    callback?: TorrentCallback
  ): PaidStreamingTorrent {
    let torrent: PaidStreamingTorrent;

    if (typeof optionsOrCallback === "function") {
      torrent = super.add(input, optionsOrCallback) as PaidStreamingTorrent;
    } else {
      torrent = super.add(input, optionsOrCallback, callback) as PaidStreamingTorrent;
    }

    this.setupTorrent(torrent);
    log("torrent added");
    return torrent;
  }

  blockPeer(torrentInfoHash: string, wire: PaidStreamingWire, peerAccount: string) {
    this.allowedPeers[torrentInfoHash][peerAccount].allowed = false;
    wire.paidStreamingExtension.stop();
    this.emit(ClientEvents.PEER_STATUS_CHANGED, {
      allowedPeers: this.allowedPeers[torrentInfoHash],
      affectedTorrent: torrentInfoHash,
      peerAccount
    });
    log("SEEDER: > blockedPeer", peerAccount, Object.keys(this.allowedPeers));
  }

  unblockPeer(torrentInfoHash: string, wire: PaidStreamingWire, peerAccount: string) {
    this.allowedPeers[torrentInfoHash][peerAccount].allowed = true;
    wire.paidStreamingExtension.start();
    this.emit(ClientEvents.PEER_STATUS_CHANGED, {
      allowedPeers: this.allowedPeers[torrentInfoHash],
      torrentInfoHash,
      peerAccount
    });
    log("SEEDER: > unblockedPeer", peerAccount, "from", Object.keys(this.allowedPeers));
  }

  togglePeer(torrentInfoHash, peerAccount: string) {
    const {wire, allowed} = this.allowedPeers[torrentInfoHash][peerAccount];
    if (allowed) {
      this.blockPeer(torrentInfoHash, wire, peerAccount);
    } else {
      this.unblockPeer(torrentInfoHash, wire, peerAccount);
    }
    log("SEEDER: > togglePeer", peerAccount);
  }

  protected setupWire(torrent: Torrent, wire: PaidStreamingWire) {
    log("> Wire Setup");

    wire.use(paidStreamingExtension({pseAccount: this.pseAccount}));
    wire.setKeepAlive(true);
    wire.setTimeout(65000);
    wire.on("keep-alive", () => {
      log("> wire keep-alive :", !torrent.done && wire.amChoking ? "Clearing Timeout" : "");
      if (!torrent.done && wire.amChoking) {
        wire._clearTimeout();
      }
    });

    wire.on(WireEvents.REQUEST, () => {
      const peerAccount = wire.paidStreamingExtension.peerAccount as string;
      const knownPeerAccount = peerAccount in this.allowedPeers[torrent.infoHash];

      if (knownPeerAccount && !this.allowedPeers[torrent.infoHash][peerAccount].allowed) {
        this.blockPeer(torrent.infoHash, wire, peerAccount);
      } else if (!knownPeerAccount) {
        this.allowedPeers[torrent.infoHash][peerAccount] = {id: peerAccount, wire, allowed: false};
        this.blockPeer(torrent.infoHash, wire, peerAccount);
        this.emit(ClientEvents.PEER_STATUS_CHANGED, {
          allowedPeers: this.allowedPeers[torrent.infoHash],
          affectedId: torrent.infoHash,
          peerAccount
        });
      } else {
        this.allowedPeers[torrent.infoHash][peerAccount] = {id: peerAccount, wire, allowed: true};
      }
    });

    wire.paidStreamingExtension.once(PaidStreamingExtensionEvents.REQUEST, () => {
      const peerAccount = wire.paidStreamingExtension && wire.paidStreamingExtension.peerAccount;
      log(`SEEDER > wire first_request of ${peerAccount}`);
      wire.emit(PaidStreamingExtensionEvents.REQUEST, peerAccount);
    });

    wire.paidStreamingExtension.on(PaidStreamingExtensionEvents.NOTICE, notice =>
      torrent.emit(PaidStreamingExtensionEvents.NOTICE, wire, notice)
    );
  }

  protected setupTorrent(torrent: PaidStreamingTorrent) {
    if (torrent.usingPaidStreaming) {
      return torrent;
    }
    torrent.on("infoHash", () => {
      this.allowedPeers = {...this.allowedPeers, [torrent.infoHash]: {}};
    });
    torrent.on(TorrentEvents.WIRE, (wire: PaidStreamingWire) => {
      this.setupWire(torrent, wire);
    });

    torrent.on(TorrentEvents.NOTICE, (wire, {command, data}) => {
      log(`< ${command} received from ${wire.peerExtendedHandshake.pseAccount}`, data);
      switch (command) {
        case PaidStreamingExtensionNotices.STOP:
          wire.paidStreamingExtension.ack();
          wire.choke();
          break;
        case PaidStreamingExtensionNotices.START:
          wire.paidStreamingExtension.ack();
          this.jumpStart(torrent, wire);
          break;
        default:
          break;
      }
      this.emit(ClientEvents.TORRENT_NOTICE, torrent, wire, command, data);
    });

    torrent.on(TorrentEvents.DONE, () => this.emit(ClientEvents.TORRENT_DONE, torrent));

    torrent.on(TorrentEvents.ERROR, err => {
      log("ERROR: > ", err);
      this.emit(ClientEvents.TORRENT_ERROR, torrent, err);
    });
    torrent.usingPaidStreaming = true;

    return torrent;
  }

  protected jumpStart(torrent: ExtendedTorrent, wire: PaidStreamingWire) {
    log(`LEECHER: > JumpStarting! - With ${wire.requests.length} pending wire requests`);
    wire.unchoke();
    torrent._startDiscovery();
    torrent.resume();
    if (!torrent.done) {
      wire.requests = [];
      const canceledReservations: ExtendedTorrentPiece[] = [];
      torrent.pieces = torrent.pieces.map(piece => {
        if (piece && !!piece._reservations) {
          piece._reservations = 0;
          canceledReservations.push(piece);
        }
        return piece;
      });
      log("LEECHER: > Requests cleared!");
      torrent._updateWire(wire);
    } else {
      log("LEECHER: > Torrent its working fine or it finished", torrent, wire);
    }
  }
}
