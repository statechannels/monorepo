import {JSONSchema, Model, Pojo, ModelOptions} from 'objection';
import {
  SignatureEntry,
  StateWithHash,
  State,
  makeAddress,
  Address,
  PrivateKey,
} from '@statechannels/wallet-core';
import {ethers} from 'ethers';

import {Values} from '../errors/wallet-error';
import {signState as wasmSignState} from '../utilities/signatures';
import {addHash} from '../state-utils';

export class SigningWallet extends Model {
  readonly id!: number;
  readonly privateKey!: PrivateKey;
  readonly address!: Address;

  static tableName = 'signing_wallets';

  $beforeValidate(jsonSchema: JSONSchema, json: Pojo, _opt: ModelOptions): JSONSchema {
    super.$beforeValidate(jsonSchema, json, _opt);

    if (!json.address) {
      const {address} = new ethers.Wallet(json.privateKey);
      json.address = address;
    }

    json.address = makeAddress(json.address);
    return json;
  }

  $validate(json: Pojo): Pojo {
    super.$validate(json);

    const addressFromPK = makeAddress(new ethers.Wallet(json.privateKey).address);
    if (addressFromPK !== json.address) {
      throw new SigningWalletError(SigningWalletError.reasons.invalidAddress, {
        given: json.address,
        correct: addressFromPK,
      });
    }

    return json;
  }

  signState(state: State | StateWithHash): SignatureEntry {
    let signature: string;
    if ('stateHash' in state) {
      signature = wasmSignState(state, this.privateKey).signature;
    } else {
      const stateWithHash: StateWithHash = addHash(state);
      signature = wasmSignState(stateWithHash, this.privateKey).signature;
    }
    return {
      signer: this.address,
      signature,
    };
  }
}

class SigningWalletError extends Error {
  readonly type = 'SigningWalletError';
  static readonly reasons = {invalidAddress: 'Invalid address'} as const;

  constructor(
    reason: Values<typeof SigningWalletError.reasons>,
    public readonly data: any = undefined
  ) {
    super(reason);
  }
}
