import {fork} from 'child_process';
import {RelayableAction} from '../communication';
import {Model} from 'objection';
import knex from '../wallet/db/connection';
import {assetHolderListen} from '../wallet/services/asset-holder-watcher';
import {handleWalletMessage} from './handlers/handle-wallet-message';

Model.knex(knex);

// A forked process inherits execArgv from the parent
// --inspect-brk is present when the process is launched via vs code debug
// The debug port cannot be used for both the parent process and child processes.
const forkExecArgv = process.execArgv.filter(arg => !arg.includes('--inspect-brk'));

const firebaseRelay = fork(`${__dirname}/../message/firebase-relay`, [], {
  execArgv: forkExecArgv
});
firebaseRelay.on('message', (message: RelayableAction) => {
  console.log(
    `Parent process received message from firebase": ${JSON.stringify(message, null, 1)}`
  );

  handleWalletMessage(message)
    .then(outgoingMessages => {
      for (const outgoingMessage of outgoingMessages) {
        console.log(
          `Parent process sending message to firebase: ${JSON.stringify(outgoingMessage, null, 1)}`
        );
        firebaseRelay.send(outgoingMessage);
      }
    })
    .catch(reason => console.error(reason));
});
console.log('Firebase relay sub-process started');
assetHolderListen();
