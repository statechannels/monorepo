import { ChannelId } from '../data-types';
import { JsonRpcRequest, JsonRpcResponse, JsonRpcError } from '../jsonrpc-header-types';
import { ErrorCodes as AllErrors } from '../error-codes';

export interface SyncChannelParams {
  channelId: ChannelId;
}
export type SyncChannelRequest = JsonRpcRequest<'SyncChannel', SyncChannelParams>;
// eslint-disable-next-line @typescript-eslint/ban-types
export type SyncChannelResponse = JsonRpcResponse<{}>;

type ErrorCodes = AllErrors['SyncChannel'];

type ChannelNotFound = JsonRpcError<ErrorCodes['ChannelNotFound'], 'Channel not found'>;

export type SyncChannelError = ChannelNotFound;
