import {Message} from '@statechannels/client-api-schema';
import _ from 'lodash';
import {Logger} from 'pino';

import {Engine} from '..';

import {MessageHandler, MessageServiceInterface} from './types';

export type LatencyOptions = {
  /**
   * The mean delay to delay messages with. If undefined messages are not delayed
   * Otherwise each message is delayed by meanDelay / 2 + Math.random() * meanDelay);
   */
  meanDelay?: number;
  /**
   * How frequently a message should be dropped. Can range from 0 (never dropped) to 1(always dropped)
   */
  dropRate: number;
};

/**
 * A basic message service that is responsible for sending and receiving messages for a collection of engines.
 * All the engines will share the same message service.
 * The message service is responsible for calling pushMessage on the appropriate engines.
 */
export class TestMessageService implements MessageServiceInterface {
  private _handleMessage: (message: Message) => Promise<void>;
  private _options: LatencyOptions;

  private _timeouts: NodeJS.Timeout[] = [];

  protected _destroyed = false;
  /**
   * Creates a test message service that can be used in tets
   * @param incomingMessageHandler The message handler to use
   * @param logger An optional logger for logging

   * @returns
   */
  protected constructor(handleMessage: MessageHandler, protected _logger?: Logger) {
    this._options = {dropRate: 0, meanDelay: undefined};
    // We always pass a reference to the messageService when calling handleMessage
    // This allows the MessageHandler function to easily call messageHandler.send
    // We just bind that here for convenience.
    this._handleMessage = async message => {
      // This prevents triggering messages after the service is destroyed
      // This is important
      if (!this._destroyed) return handleMessage(message, this);
    };
  }

  static async create(
    incomingMessageHandler: MessageHandler,

    logger?: Logger
  ): Promise<MessageServiceInterface> {
    const service = new TestMessageService(incomingMessageHandler, logger);
    return service;
  }
  public setLatencyOptions(incomingOptions: Partial<LatencyOptions>): void {
    this._options = _.merge(this._options, incomingOptions);
  }
  async send(messages: Message[]): Promise<void> {
    const shouldDrop = Math.random() > 1 - this._options.dropRate;

    if (!shouldDrop) {
      const {meanDelay} = this._options;
      if (meanDelay) {
        const delay = meanDelay / 2 + Math.random() * meanDelay;
        this._timeouts.push(
          setTimeout(async () => {
            for (const message of messages) {
              await this._handleMessage(message);
            }
          }, delay)
        );
      } else {
        for (const message of messages) {
          await this._handleMessage(message);
        }
      }
      await Promise.all(messages.map(this._handleMessage));
    }
  }

  async destroy(): Promise<void> {
    this._destroyed = true;
    // This prevents any more progress from being made
    this._handleMessage = async () => _.noop();

    this._timeouts.forEach(t => t.unref());
  }
}

/**
 * This is a helper method that sets up a message service for a collection of engines.
 * Whenever handleMessages or send are called they are pushed into the appropriate engine.
 * Any response to the pushMessage is then sent to the other participants
 * @param engines The collection of engines that will be communicating. A participantId must be provided for each engine.
 * @returns A messaging service that is responsible for calling pushMessage on the correct engine.
 * @example
 * const handler = createTestMessageHandler(..bla)
 * const ms = createTestMessageHandler(handler)
 * const result = engine.createChannel(..bla);
 *
 * // This will send all the messages from the result of the create channel call
 * // and will handle any responses to those messages and so on...
 * await ms.handleMessages(result.outbox);
 */
export const createTestMessageHandler = (
  engines: {participantId: string; engine: Engine}[],
  logger?: Logger
): MessageHandler => {
  const hasUniqueParticipants = new Set(engines.map(w => w.participantId)).size === engines.length;
  const hasUniqueEngines = new Set(engines.map(w => w.engine)).size === engines.length;

  if (!hasUniqueParticipants) {
    throw new Error('Duplicate participant ids');
  }

  if (!hasUniqueEngines) {
    throw new Error('Duplicate engines');
  }
  return async (message, me) => {
    const matching = engines.find(w => w.participantId === message.recipient);

    if (!matching) {
      throw new Error(`Invalid recipient ${message.recipient}`);
    }

    logger?.trace({message}, 'Pushing message into engine');
    const result = await matching.engine.pushMessage(message.data);

    await me.send(result.outbox.map(o => o.params));
  };
};
