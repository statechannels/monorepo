import {checkThat, isSimpleAllocation, State, unreachable} from '@statechannels/wallet-core';
import {Transaction} from 'knex';
import {Logger} from 'pino';
import {isExternalDestination} from '@statechannels/nitro-protocol';

import {Store} from '../wallet/store';
import {Bytes32} from '../type-aliases';
import {ChainServiceInterface} from '../chain-service';
import {DBCloseChannelObjective} from '../models/objective';
import {WalletResponse} from '../wallet/wallet-response';
import {recordFunctionMetrics} from '../metrics';
import {Channel} from '../models/channel';
import {LedgerRequest} from '../models/ledger-request';
import {ChainServiceRequest} from '../models/chain-service-request';

import {ChannelState, stage, Stage} from './state';
import {
  completeObjective,
  Withdraw,
  withdraw,
  signState,
  noAction,
  CompleteObjective,
  RequestLedgerDefunding,
  requestLedgerDefunding,
  SignState,
} from './actions';

export class ChannelCloser {
  constructor(
    private store: Store,
    private chainService: ChainServiceInterface,
    private logger: Logger,
    private timingMetrics = false
  ) {}

  public static create(
    store: Store,
    chainService: ChainServiceInterface,
    logger: Logger,
    timingMetrics = false
  ): ChannelCloser {
    return new ChannelCloser(store, chainService, logger, timingMetrics);
  }

  public async crank(objective: DBCloseChannelObjective, response: WalletResponse): Promise<void> {
    const channelToLock = objective.data.targetChannelId;

    let attemptAnotherProtocolStep = true;

    while (attemptAnotherProtocolStep) {
      await this.store.lockApp(channelToLock, async tx => {
        const protocolState = await getCloseChannelProtocolState(
          this.store,
          objective.data.targetChannelId,
          tx
        );
        const nextAction = recordFunctionMetrics(protocol(protocolState), this.timingMetrics);

        if (nextAction) {
          try {
            switch (nextAction.type) {
              case 'SignState':
                await this.signState(nextAction, protocolState, tx, response);
                break;
              case 'CompleteObjective':
                attemptAnotherProtocolStep = false;
                await this.completeObjective(objective, protocolState, tx, response);
                break;
              case 'Withdraw':
                await this.withdraw(nextAction, protocolState, tx);
                break;
              case 'RequestLedgerDefunding':
                await this.requestLedgerDefunding(protocolState, tx);
                break;
              default:
                unreachable(nextAction);
            }
          } catch (error) {
            this.logger.error({error}, 'Error handling action');
            await tx.rollback(error);
            attemptAnotherProtocolStep = false;
          }
        } else {
          response.queueChannelState(protocolState.app);
          attemptAnotherProtocolStep = false;
        }
      });
    }
  }

  private async signState(
    action: SignState,
    protocolState: ProtocolState,
    tx: Transaction,
    response: WalletResponse
  ): Promise<void> {
    const {myIndex, channelId} = protocolState.app;
    const channel = await Channel.forId(channelId, tx);
    const signedState = await this.store.signState(channel, action, tx);
    response.queueState(signedState, myIndex, channelId);
  }

  private async completeObjective(
    objective: DBCloseChannelObjective,
    protocolState: ProtocolState,
    tx: Transaction,
    response: WalletResponse
  ): Promise<void> {
    await this.store.markObjectiveAsSucceeded(objective, tx);

    response.queueChannelState(protocolState.app);
    response.queueSucceededObjective(objective);
  }

  private async withdraw(
    action: Withdraw,
    protocolState: ProtocolState,
    tx: Transaction
  ): Promise<void> {
    await ChainServiceRequest.insertOrUpdate(action.channelId, 'withdraw', tx);

    // app.supported is defined (if the wallet is functioning correctly), but the compiler is not aware of that
    // Note, we are not awaiting transaction submission
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    await this.chainService.concludeAndWithdraw([protocolState.app.supported!]);
  }

  private async requestLedgerDefunding(
    protocolState: ProtocolState,
    tx: Transaction
  ): Promise<void> {
    await LedgerRequest.requestLedgerDefunding(
      protocolState.app.channelId,
      protocolState.app.fundingLedgerChannelId as string,
      tx
    );
  }
}

type CloseChannelProtocolResult =
  | Withdraw
  | SignState
  | CompleteObjective
  | RequestLedgerDefunding
  | undefined;

export const protocol = (ps: ProtocolState): CloseChannelProtocolResult =>
  chainWithdraw(ps) ||
  completeCloseChannel(ps) ||
  defundIntoLedger(ps) ||
  (ensureAllAllocationItemsAreExternalDestinations(ps) && signFinalState(ps)) ||
  noAction;

export type ProtocolState = {
  app: ChannelState;
  ledgerDefundingRequested?: boolean;
  ledgerDefundingSucceeded?: boolean;
  ledgerChannelId?: Bytes32;
};

const stageGuard = (guardStage: Stage) => (s: State | undefined): s is State =>
  !!s && stage(s) === guardStage;

const isFinal = stageGuard('Final');

function everyoneSignedFinalState(app: ChannelState): boolean {
  return (app.support || []).every(isFinal) && isFinal(app.latestSignedByMe);
}

// TODO: where is the corresponding logic for ledger channels?
//       should there be a generic logic for computing whether a channel is defunded regardless of funding type?
function successfulWithdraw({app}: ProtocolState): boolean {
  if (app.fundingStrategy !== 'Direct') return true;
  return app.directFundingStatus === 'Defunded';
}

const isMyTurn = (ps: ProtocolState): boolean =>
  !!ps.app.supported &&
  (ps.app.supported.turnNum + 1) % ps.app.participants.length === ps.app.myIndex;

// I want to sign the final state if:
// - the objective has been approved
// - I haven't yet signed a final state
// - and either
//    - there's an existing final state (in which case I double sign)
//    - or it's my turn (in which case I craft the final state)
//
const signFinalState = (ps: ProtocolState): SignState | false =>
  !!ps.app.supported && // there is a supported state
  !isFinal(ps.app.latestSignedByMe) && // I haven't yet signed a final state
  // if there's an existing final state double-sign it
  ((isFinal(ps.app.supported) &&
    signState({
      channelId: ps.app.channelId,
      ...ps.app.supported,
      turnNum: ps.app.supported.turnNum,
      isFinal: true,
    })) ||
    // otherwise, if it's my turn, sign a final state
    (isMyTurn(ps) &&
      signState({
        channelId: ps.app.channelId,
        ...ps.app.supported,
        turnNum: ps.app.supported.turnNum + 1,
        isFinal: true,
      })));

const defundIntoLedger = (ps: ProtocolState): RequestLedgerDefunding | false =>
  isLedgerFunded(ps.app) &&
  !ps.ledgerDefundingRequested &&
  !ps.ledgerDefundingSucceeded &&
  !!ps.app.supported &&
  everyoneSignedFinalState(ps.app) &&
  requestLedgerDefunding({
    channelId: ps.app.channelId,
    assetHolderAddress: checkThat(ps.app.latest.outcome, isSimpleAllocation).assetHolderAddress,
  });

/**
 * If the channel is directly funded, then ensure none of its allocation items are other
 * channels being funded by this channel (e.g., if it is a ledger channel). This should
 * cause the protocol to "pause" / "freeze" until no channel depends on this channel
 * for funding.
 */
const ensureAllAllocationItemsAreExternalDestinations = (ps: ProtocolState): boolean =>
  !isDirectlyFunded(ps.app) ||
  (isDirectlyFunded(ps.app) &&
    !!ps.app.supported &&
    checkThat(ps.app.supported.outcome, isSimpleAllocation).allocationItems.every(({destination}) =>
      isExternalDestination(destination)
    ));

const isDirectlyFunded = ({fundingStrategy}: ChannelState): boolean => fundingStrategy === 'Direct';
const isLedgerFunded = ({fundingStrategy}: ChannelState): boolean => fundingStrategy === 'Ledger';

const completeCloseChannel = (ps: ProtocolState): CompleteObjective | false =>
  everyoneSignedFinalState(ps.app) &&
  ((isLedgerFunded(ps.app) && ps.ledgerDefundingSucceeded) || !isLedgerFunded(ps.app)) &&
  successfulWithdraw(ps) &&
  completeObjective({channelId: ps.app.channelId});

function chainWithdraw({app}: ProtocolState): Withdraw | false {
  return (
    everyoneSignedFinalState(app) &&
    app.fundingStrategy === 'Direct' &&
    !app.chainServiceRequests.find(csr => csr.request === 'withdraw')?.isValid() &&
    withdraw(app)
  );
}

/**
 * Helper method to retrieve scoped data needed for CloseChannel protocol.
 */
export const getCloseChannelProtocolState = async (
  store: Store,
  channelId: Bytes32,
  tx: Transaction
): Promise<ProtocolState> => {
  const app = await store.getChannel(channelId, tx);
  switch (app.fundingStrategy) {
    case 'Direct':
    case 'Fake':
      return {app};
    case 'Ledger': {
      const req = await store.getLedgerRequest(app.channelId, 'defund', tx);
      return {
        app,
        ledgerDefundingRequested: !!req,
        ledgerDefundingSucceeded: req ? req.status === 'succeeded' : false,
        ledgerChannelId: req ? req.ledgerChannelId : undefined,
      };
    }
    case 'Unknown':
    case 'Virtual':
    default:
      throw new Error('getCloseChannelProtocolState: Unimplemented funding strategy');
  }
};
