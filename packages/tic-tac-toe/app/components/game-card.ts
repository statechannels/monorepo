import Component from '@glimmer/component';
import makeBlockie from 'ethereum-blockies-base64';
import {action} from '@ember/object';
import ChallengeModel from '../models/challenge';
import CurrentGameService from '../services/current-game';
import {inject as service} from '@ember/service';
import UserService from '../services/user';
import TttChannelClientService from '../services/ttt-channel-client';
import {AppData} from '../core/app-data';

const {bigNumberify} = ethers.utils;

interface GameCardComponentArgs {
  game: {address: string};
}

export default class GameCardComponent extends Component<GameCardComponentArgs> {
  @service currentGame!: CurrentGameService;
  @service user!: UserService;
  @service tttChannelClient!: TttChannelClientService;

  get blockieSrc(): string {
    return makeBlockie(this.args.game.address ?? '0');
  }

  @action
  async joinGame(game: ChallengeModel): Promise<void> {
    game.playerAName = this.user.username;
    game.playerAOutcomeAddress = this.user.walletAddress;
    game.isPublic = false;
    await game.save();
    this.currentGame.setGame(game);

    const openingBalance = bigNumberify(game.stake)
      .mul(5)
      .toString();
    const aBal = openingBalance;
    const bBal = openingBalance;
    const startState: AppData = {type: 'start'};

    console.log('Lets createChannel');
    await this.tttChannelClient.createChannel(
      this.user.userAddress,
      game.address,
      aBal,
      bBal,
      startState,
      this.user.walletAddress,
      game.outcomeAddress
    );
    console.log('Created Channel?');
  }
}
