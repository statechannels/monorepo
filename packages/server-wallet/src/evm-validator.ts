import {createValidTransitionTransaction, State as NitroState} from '@statechannels/nitro-protocol';
import * as PureEVM from '@connext/pure-evm-wasm';
import {utils} from 'ethers';

import {Bytes} from './type-aliases';
import {createLogger} from './logger';
import {defaultTestConfig} from './config';

const logger = createLogger(defaultTestConfig());
/**
 * Takes two states and runs the validateTransition in an evm (pureevm).
 * Returns a promise that resolves to true if the validateTransition
 * returns true false otherwise
 */
export const validateAppTransitionWithEVM = (
  from: NitroState,
  to: NitroState,
  bytecode?: Bytes
): boolean => {
  if (bytecode === '0x' || bytecode == undefined) return false;

  const {data} = createValidTransitionTransaction(from, to);

  const result = PureEVM.exec(
    Uint8Array.from(Buffer.from(bytecode.substr(2), 'hex')),
    Uint8Array.from(Buffer.from(data ? data.toString().substr(2) : '0x00', 'hex'))
  );
  // We need to ensure the result is the correct length otherwise we might be interpreting a failed assertion
  const transitionPassed =
    result.length === 32 && (utils.defaultAbiCoder.decode(['bool'], result)[0] as boolean);

  if (!transitionPassed) {
    logger.error(`Call to ValidTransition failed in the EVM ${parseRevertReason(result)}`, {
      result: parseRevertReason(result),
    });
    return false;
  }

  return true;
};

function parseRevertReason(result: Uint8Array) {
  // TODO: Figure out the proper encoding.
  // Right now the revert reason is readable but slightly garbled
  return new TextDecoder().decode(result.filter(r => r !== 0));
}
