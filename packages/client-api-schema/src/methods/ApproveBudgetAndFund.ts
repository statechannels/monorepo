import {Participant, Address, Uint256, DomainBudget} from '../data-types';
import {JsonRpcRequest, JsonRpcResponse} from '../jsonrpc-header-types';

export interface ApproveBudgetAndFundParams {
  hub: Participant;
  playerParticipantId: string;
  asset: Address;
  requestedSendCapacity: Uint256;
  requestedReceiveCapacity: Uint256;
}

export type ApproveBudgetAndFundRequest = JsonRpcRequest<
  'ApproveBudgetAndFund',
  ApproveBudgetAndFundParams
>;
export type ApproveBudgetAndFundResponse = JsonRpcResponse<DomainBudget>;
