// need to use this syntax, because ajv uses export= style exports
// otherwise we force all consumers of the package to set esModuleInterop to true
import Ajv = require('ajv');

// eslint-disable-next-line
const apiSchema = require('./generated-schema.json'); // because https://github.com/TypeStrong/ts-loader/issues/905
import {Request} from './types.js';

const ajv = new Ajv();
ajv.addSchema(apiSchema, 'api.json');

export const validateRequest = ajv.compile({$ref: 'api.json#/definitions/Request'});

export function parseRequest(jsonBlob: object): Request {
  const valid = validateRequest(jsonBlob);
  if (!valid) {
    const errorMessages = validateRequest.errors?.map(e => e.message);
    throw new Error(`Validation Error: ${errorMessages}`);
  }
  return jsonBlob as Request;
}
