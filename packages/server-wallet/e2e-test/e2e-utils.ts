import {spawn, ChildProcessWithoutNullStreams} from 'child_process';

import kill = require('tree-kill');
import axios from 'axios';

import Knex = require('knex');
import {dbConfig} from '../src/db/config';

export type ReceiverServer = {
  url: string;
  server: ChildProcessWithoutNullStreams;
};

/**
 * Starts the Receiver Express server in a separate process. Needs to be
 * a separate process because it relies on process.env variables which
 * should not be shared between Payer and Receiver -- particularly SERVER_DB_NAME
 * which indicates that Payer and Receiver use separate databases, despite
 * conveniently re-using the same PostgreSQL instance.
 */
export const startReceiverServer = (): ReceiverServer => {
  const server = spawn('yarn', ['ts-node', './e2e-test/receiver/server'], {
    stdio: 'pipe',
    env: {
      // eslint-disable-next-line
      ...process.env,
      SERVER_DB_NAME: 'receiver',
    },
  });

  server.on('error', data => console.error(data.toString()));
  server.stdout.on('data', data => console.log(data.toString()));
  server.stderr.on('data', data => console.error(data.toString()));

  return {
    server,
    url: `http://127.0.0.1:65535`,
  };
};

/**
 * Payers the server at /reset until the API responds with OK;
 * simultaneously ensures that the server is listening and cleans
 * the database of any stale data from previous test runs.
 */
export const waitForServerToStart = (
  receiverServer: ReceiverServer,
  pingInterval = 1500
): Promise<void> =>
  new Promise(resolve => {
    const interval = setInterval(async () => {
      try {
        await axios.post<'OK'>(`${receiverServer.url}/status`);
        clearInterval(interval);
        resolve();
      } catch {
        return;
      }
    }, pingInterval);
  });

export const knexReceiver: Knex = Knex({
  ...dbConfig,
  connection: {
    ...(dbConfig.connection as Knex.StaticConnectionConfig),
    database: 'receiver',
  },
});

export const killServer = async ({server}: ReceiverServer): Promise<void> => {
  kill(server.pid);

  await knexReceiver.destroy();
};
