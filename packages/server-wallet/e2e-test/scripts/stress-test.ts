import autocannon from 'autocannon';
import yargs from 'yargs';

import {
  waitForServerToStart,
  startReceiverServer,
  knexReceiver,
  killServer,
  seedTestChannels,
  getParticipant,
  knexPayer,
  startPayerServer,
  PAYER_PORT,
} from '../e2e-utils';
import { alice, bob } from '../../src/wallet/__test__/fixtures/signing-wallets';
import { SigningWallet } from '../../src/models/signing-wallet';
import { DBAdmin } from '../../src/db-admin/db-admin';

const { argv } = yargs
  .option('duration', {
    type: 'number',
    default: 60,
    description: 'The duration to run the stress test in seconds',
  })
  .option('connections', {
    type: 'number',
    demandOption: true,
    default: 25,
    description: 'The amount of connections (and channels) to use in the stress test.',
  });

(async function (): Promise<void> {
  const receiverServer = startReceiverServer();
  const payerServer = startPayerServer();
  await waitForServerToStart(receiverServer);
  await waitForServerToStart(payerServer);

  const [SWPayer, SWReceiver] = [knexPayer, knexReceiver].map(knex => SigningWallet.bindKnex(knex));
  await Promise.all([knexPayer, knexReceiver].map(knex => new DBAdmin(knex).truncateDB()));
  // Adds Alice to Payer's Database
  await SWPayer.query(knexPayer).insert(alice());

  // Adds Bob to Receiver's Database
  await SWReceiver.query(knexReceiver).insert(bob());
  const { connections, duration } = argv;
  const channelIds = await seedTestChannels(
    getParticipant('payer', alice().privateKey),
    alice().privateKey,
    getParticipant('receiver', bob().privateKey),
    bob().privateKey,
    connections,
    knexPayer
  );

  const urls = channelIds.map(c => `http://localhost:${PAYER_PORT}/makePayment?channelId=${c}`);

  // TODO: The autocannon types incorrectly type url as string. It actually can be a string or an array of strings
  const instance = autocannon({ url: urls as any, connections, duration }, stopServer);
  // Tracking outputs things in a decent format so we use that

  // eslint-disable-next-line no-process-env
  autocannon.track(instance, { renderLatencyTable: true, renderProgressBar: !process.env.CI });

  async function stopServer(): Promise<void> {
    await killServer(receiverServer);
    await killServer(payerServer);
    await knexReceiver.destroy();
    await knexPayer.destroy();
  }
})();
