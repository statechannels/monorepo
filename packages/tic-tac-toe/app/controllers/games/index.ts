import Controller from '@ember/controller';
import {tracked} from '@glimmer/tracking';
import {action} from '@ember/object';
import {inject as service} from '@ember/service';
import DS from 'ember-data';
import UserService from '@statechannels/tic-tac-toe/services/user';
import CurrentGameService from '@statechannels/tic-tac-toe/services/current-game';
import makeBlockie from 'ethereum-blockies-base64';

export default class GamesIndexController extends Controller {
  @service store!: DS.Store;
  @service user!: UserService;
  @service currentGame!: CurrentGameService;

  @tracked buyInAmount = 0.001;
  @tracked showCreateGameModal = false;

  get blockieSrc(): string {
    return makeBlockie(this.user.userAddress ?? '0');
  }

  @action
  protected async createNewGame(event: Event): Promise<void> {
    event.preventDefault();
    console.log('Create New Game');
    this.showCreateGameModal = false;
    const myPublicOpenGame = {
      address: this.user.userAddress,
      outcomeAddress: this.user.walletAddress,
      name: this.user.username,
      stake: this.buyInAmount.toString(),
      createdAt: new Date().getTime(),
      isPublic: true,
      playerAName: 'unknown',
      playerAOutcomeAddress: 'unknown'
    };
    const newGame = this.store.createRecord('challenge', myPublicOpenGame);
    await newGame.save();
    this.currentGame.setGame(newGame);
    this.transitionToRoute('games.waiting');
  }
}

// DO NOT DELETE: this is how TypeScript knows how to look up your controllers.
declare module '@ember/controller' {
  interface Registry {
    'games/index': GamesIndexController;
  }
}
