import {
  Guarantee,
  encodeGuarantee,
  decodeGuarantee,
  encodeAllocation,
  decodeAllocation,
  Allocation,
  encodeOutcome,
  decodeOutcome,
} from '../../src/contract/outcome';
import {ethers} from 'ethers';

const destination = ethers.utils.id('d');
const targetChannelId = ethers.utils.id('t');
const destinations = [destination];
const assetHolderAddress = ethers.Wallet.createRandom().address;

const guarantee: Guarantee = {
  targetChannelId,
  destinations,
};
const allocation: Allocation = [{destination, amount: '0x05'}];

const outcome = [{assetHolderAddress, allocation}, {assetHolderAddress, guarantee}];
const emptyOutcome = [];

const description0 = 'Encodes and decodes guarantee';
const description1 = 'Encodes and decodes allocation';
const description2 = 'Encodes and decodes outcome';
const description3 = 'Encodes and decodes empty outcome';

describe('outcome', () => {
  describe('encoding and decoding', () => {
    it.each`
      description     | encodeFunction      | decodeFunction      | data
      ${description0} | ${encodeGuarantee}  | ${decodeGuarantee}  | ${guarantee}
      ${description1} | ${encodeAllocation} | ${decodeAllocation} | ${allocation}
      ${description2} | ${encodeOutcome}    | ${decodeOutcome}    | ${outcome}
      ${description3} | ${encodeOutcome}    | ${decodeOutcome}    | ${emptyOutcome}
    `('$description', ({encodeFunction, decodeFunction, data}) => {
      const encodedData = encodeFunction(data);
      const decodedData = decodeFunction(encodedData);
      expect(decodedData).toEqual(data);
    });
  });
});
