import { Argv } from 'yargs';
import _ from 'lodash';
import { configureEnvVariables } from '@statechannels/devtools';
configureEnvVariables();

import PayerClient from '../payer/client';
import { alice } from '../../src/wallet/__test__/fixtures/signing-wallets';
import { recordFunctionMetrics } from '../../src/metrics';
import { defaultTestConfig } from '../../src/config';

import { PerformanceTimer } from './timers';

export default {
  command: 'start',

  describe: 'Makes (fake) payments on many channels concurrently',

  builder: (yargs: Argv): Argv =>
    yargs
      .option('database', {
        type: 'string',
        demandOption: true,
      })
      .option('channels', {
        type: 'array',
        demandOption: true,
      })
      .option('numPayments', {
        type: 'number',
        default: 1,
      })
      .coerce('channels', (channels: number[]): string[] =>
        channels.map(channel => channel.toString(16))
      )
      .example(
        'start --database payer --channels 0xf00 0x123 0xabc',
        'Makes payments with three channels'
      ),

  handler: async (argv: { [key: string]: any } & Argv['argv']): Promise<void> => {
    const { database, numPayments, channels } = argv;

    const payerClient = recordFunctionMetrics(
      new PayerClient(alice().privateKey, `http://127.0.0.1:65535`, {
        ...defaultTestConfig,
        postgresDBName: database,
      })
    );

    const performanceTimer = new PerformanceTimer(channels || [], numPayments);
    await Promise.all(
      (channels || []).map((channelId: string) =>
        _.range(numPayments).reduce(
          p =>
            p.then(() => {
              performanceTimer.start(channelId);
              return payerClient.makePayment(channelId).then(() => {
                performanceTimer.stop(channelId);
              });
            }),
          Promise.resolve()
        )
      )
    );

    const timingResults = performanceTimer.calculateResults();
    console.log(PerformanceTimer.formatResults(timingResults));
    process.send && process.send(JSON.stringify(timingResults));
    await payerClient.destroy();

    process.exit(0);
  },
};
