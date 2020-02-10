import {ListenerFn} from 'eventemitter3';
import {
  CreateChannelResult,
  CloseChannelResult,
  UpdateChannelResult,
  PushMessageResult,
  JoinChannelResult,
  GetAddressResult,
  GetEthereumSelectedAddressResult,
  ChallengeChannelResult,
  BudgetResult1 as BudgetResult
} from '@statechannels/client-api-schema';

export interface JsonRpcRequest<MethodName = string, RequestParams = any> {
  id?: number;
  jsonrpc: '2.0';
  method: MethodName;
  params: RequestParams;
}

export interface JsonRpcResponse<ResultType = any> {
  id: number;
  jsonrpc: '2.0';
  result: ResultType;
}

export function isJsonRpcResponse(message: any): message is JsonRpcResponse {
  return 'result' in message;
}

export type JsonRpcError = {
  code: number;
  message: string;
  data?: {
    [key: string]: any;
  };
};

export interface JsonRpcNotification<NotificationName = string, NotificationParams = any> {
  jsonrpc: '2.0';
  method: NotificationName;
  params: NotificationParams;
}

export function isJsonRpcNotification(message: any): message is JsonRpcNotification {
  return 'method' in message && !('id' in message);
}

export interface JsonRpcErrorResponse {
  id: number;
  jsonrpc: '2.0';
  error: JsonRpcError;
}

export function isJsonRpcErrorResponse(message: any): message is JsonRpcErrorResponse {
  return 'error' in message;
}
// TODO: This probably should live in client-api-schema?
export type MethodType = {
  CreateChannel: CreateChannelResult;
  UpdateChannel: UpdateChannelResult;
  PushMessage: PushMessageResult;
  CloseChannel: CloseChannelResult;
  JoinChannel: JoinChannelResult;
  GetAddress: GetAddressResult;
  GetEthereumSelectedAddress: GetEthereumSelectedAddressResult;
  ChallengeChannel: ChallengeChannelResult;
  ApproveBudgetAndFund: BudgetResult;
  GetBudget: BudgetResult;
  CloseAndWithdraw: BudgetResult;
};

export interface ChannelProviderInterface {
  enable(url?: string): Promise<void>;
  send<K extends keyof MethodType>(method: K, params?: any): Promise<MethodType[K]>;
  on(event: string, callback: ListenerFn): void;
  off(event: string, callback?: ListenerFn): void;
  subscribe(subscriptionType: string, params?: any): Promise<string>;
  unsubscribe(subscriptionId: string): Promise<boolean>;
}
