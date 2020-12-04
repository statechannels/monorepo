import joi, {ValidationErrorItem} from 'joi';
import {parse} from 'pg-connection-string';

import {ServerWalletConfig} from './types';

const validateConnectionString = (connection: string) => {
  const parsed = parse(connection);
  const result = databaseObjectConfigurationSchema.validate(parsed);
  if (result.error) {
    throw new Error('Invalid connection string');
  }
  return parsed;
};
const databaseObjectConfigurationSchema = joi.object({
  database: joi.string().required(),
  host: joi.string().required(),
  user: joi.string().required(),
  password: joi
    .string()
    .allow('')
    .optional(),
  port: joi
    .number()
    .integer()
    .optional(),
});
const databaseConnectionConfigurationSchema = joi.alternatives().conditional('.', {
  is: joi.string(),
  then: joi.string().custom(validateConnectionString, 'The connection string is valid'),
  otherwise: databaseObjectConfigurationSchema,
});

const databasePoolConfigurationSchema = joi.object({
  max: joi
    .number()
    .integer()
    .min(0)
    .optional(),
  min: joi
    .number()
    .integer()
    .min(0)
    .optional(),
});

const databaseConfigurationSchema = joi.object({
  connection: databaseConnectionConfigurationSchema.required(),
  debug: joi.boolean().optional(),
  pool: databasePoolConfigurationSchema.optional(),
});

const metricsConfigurationSchema = joi.object({
  timingMetrics: joi.boolean().required(),
  metricsOutputFile: joi.string().when('timingMetrics', {is: true, then: joi.string().required()}),
});

const loggingConfigurationSchema = joi.object({
  logLevel: joi.string().valid('fatal', 'error', 'warn', 'info', 'debug', 'trace'),
  logDestination: joi.string().required(),
});

const networkConfigurationSchema = joi.object({
  chainNetworkID: joi
    .number()
    .integer()
    .min(0)

    .required(),
});

const chainServiceConfigurationSchema = joi.object({
  attachChainService: joi.boolean().required(),
  pk: joi
    .string()
    .pattern(/0[xX][0-9a-fA-F]{40}/, {name: 'Hex value validator'})
    .optional(),
  provider: joi
    .string()
    .uri()
    .optional(),
  pollingInterval: joi
    .number()
    .positive()
    .optional(),
  blockConfirmations: joi
    .number()
    .not()
    .negative()
    .optional(),
  allowanceMode: joi
    .string()
    .valid('MaxUint', 'PerDeposit')
    .optional(),
});

const serverWalletConfigSchema = joi.object({
  databaseConfiguration: databaseConfigurationSchema,
  networkConfiguration: networkConfigurationSchema,
  chainServiceConfiguration: chainServiceConfigurationSchema,

  workerThreadAmount: joi
    .number()
    .min(0)
    .optional(),
  skipEvmValidation: joi.boolean().optional(),
  loggingConfiguration: loggingConfigurationSchema.optional(),
  metricsConfiguration: metricsConfigurationSchema.optional(),
});

export function validateServerWalletConfig(
  config: Record<string, any>
): {valid: boolean; value: ServerWalletConfig | undefined; errors: ValidationErrorItem[]} {
  const results = serverWalletConfigSchema.validate(config);
  return {
    valid: !results.error,
    value: results.value ? (results.value as ServerWalletConfig) : undefined,
    errors: results.error?.details || [],
  };
}
