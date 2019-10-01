import {Action, MultipleWalletActions} from "../actions";
import {take, put} from "redux-saga/effects";

export function* multipleActionDispatcher() {
  while (true) {
    const multipleWalletActions: MultipleWalletActions = yield take([
      Action.WALLET_MULTIPLE_ACTIONS,
      "WALLET.MULTIPLE_RELAYABLE_ACTIONS"
    ]);
    yield multipleWalletActions.actions.map(action => put(action));
  }
}
