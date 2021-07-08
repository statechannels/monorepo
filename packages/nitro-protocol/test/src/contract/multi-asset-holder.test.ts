import {convertBytes32ToAddress} from '../../../src/contract/multi-asset-holder';

describe('convertBytes32ToAddress', () => {
  it.each`
    bytes32                                                                 | address
    ${'0x0000000000000000000000000000000000000000000000000000000000000000'} | ${'0x0000000000000000000000000000000000000000'}
    ${'0x000000000000000000000000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'} | ${'0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa'}
    ${'0x000000000000000000000000aAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa'} | ${'0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa'}
    ${'0x000000000000000000000000000000000000000000000000000000000000000a'} | ${'0x000000000000000000000000000000000000000A'}
    ${'0x000000000000000000000000000000000000000000000000000000000000000A'} | ${'0x000000000000000000000000000000000000000A'}
  `(`$bytes32 -- $address`, ({bytes32, address}) => {
    expect(convertBytes32ToAddress(bytes32)).toBe(address);
  });
});
