import {configureEnvVariables} from '@statechannels/devtools';

import app from './app';

configureEnvVariables();

app.listen(65535, '127.0.0.1');

app.on('listening', () => {
  console.info('[pong] Listening on 127.0.0.1:65535');
});
