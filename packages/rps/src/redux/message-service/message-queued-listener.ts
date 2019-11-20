import {take, fork} from 'redux-saga/effects';
import {buffers, eventChannel} from 'redux-saga';
import {reduxSagaFirebase} from '../../gateways/firebase';
import {JsonRPCNotification, Message} from '../../utils/channel-client';
import {RPSChannelClient} from '../../utils/rps-channel-client';

export function* messageQueuedListener() {
  const rpsChannelClient = new RPSChannelClient();

  const subscribe = emit => {
    rpsChannelClient.onMessageQueued(event => {
      emit(event);
    });

    return () => {
      rpsChannelClient.unSubscribe('MessageQueued');
    };
  };

  const channel = eventChannel(subscribe, buffers.fixed(10));

  while (true) {
    const message: JsonRPCNotification<Message> = yield take(channel);
    const to = message.params.recipient;
    yield fork(
      reduxSagaFirebase.database.create,
      `/messages/${to.toLowerCase()}`,
      sanitizeMessageForFirebase(message)
    );
  }
}

function sanitizeMessageForFirebase(message) {
  return JSON.parse(JSON.stringify(message));
}
