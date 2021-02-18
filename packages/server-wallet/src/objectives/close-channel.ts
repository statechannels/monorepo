import {Bytes32} from '../type-aliases';
import {Store} from '../wallet/store';
import {WalletError, Values} from '../errors/wallet-error';
import {WalletResponse} from '../wallet/wallet-response';

export class CloseChannelObjective {
  public static async commence(
    channelId: Bytes32,
    response: WalletResponse,
    store: Store
  ): Promise<void> {
    await store.lockApp(
      channelId,
      async (tx, channel) => {
        const dbObjective = await store.ensureObjective(
          {
            type: 'CloseChannel',
            participants: [],
            data: {
              targetChannelId: channelId,
              fundingStrategy: channel.fundingStrategy,
              txSubmitterOrder: [1, 0],
            },
          },
          tx
        );
        // add new objective to the response
        response.queueCreatedObjective(dbObjective, channel.myIndex, channel.participants);
      },
      () => {
        throw new CloseChannelError(CloseChannelError.reasons.channelMissing, {channelId});
      }
    );
  }
}

export class CloseChannelError extends WalletError {
  readonly type = WalletError.errors.CloseChannelError;

  static readonly reasons = {
    channelMissing: 'channel not found',
  } as const;

  constructor(
    reason: Values<typeof CloseChannelError.reasons>,
    public readonly data: any = undefined
  ) {
    super(reason);
  }
}
