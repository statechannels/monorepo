import {ChannelResult} from '@statechannels/client-api-schema';
import {Payload} from '@statechannels/wallet-core';
import _ from 'lodash';

import {Notice} from '../protocols/actions';

// Merges any messages to the same recipient into one message
// This makes message delivery less painful with the request/response model
export function mergeOutgoing(outgoing: Notice[]): Notice[] {
  if (outgoing.length === 0) return outgoing;

  const senders = outgoing.map(o => o.params.sender);
  const differentSender = new Set(senders).size !== 1;
  // This should never happen but it's nice to have a sanity
  if (differentSender) {
    throw new Error(`Trying to merge outgoing messages with multiple recipients ${senders}`);
  }

  const {sender} = outgoing[0].params;

  const mergedOutgoing: Record<string, Payload> = {};

  for (const notice of outgoing) {
    const {recipient, data} = notice.params as {recipient: string; data: Payload};
    if (!mergedOutgoing[recipient]) {
      mergedOutgoing[recipient] = {};
    }

    const {signedStates, requests, objectives} = mergedOutgoing[recipient];

    mergedOutgoing[recipient] = {
      signedStates: mergeProp(signedStates, data.signedStates),
      requests: mergeProp(requests, data.requests),
      objectives: mergeProp(objectives, data.objectives),
    };
  }
  return Object.keys(mergedOutgoing).map(k => ({
    params: {sender, recipient: k, data: mergedOutgoing[k]},
    method: 'MessageQueued' as const,
  }));
}

function mergeProp<T>(a: T[] | undefined, b: T[] | undefined): T[] | undefined {
  if (a && b) {
    return _.orderBy(
      _.uniqWith(_.concat(a, b), _.isEqual),
      ['channelId', 'turnNum'],
      ['desc', 'asc']
    );
  } else if (a) {
    return a;
  } else if (b) {
    return b;
  } else {
    return undefined;
  }
}

export function mergeChannelResults(channelResults: ChannelResult[]): ChannelResult[] {
  const sorted = _.orderBy(_.reverse(channelResults), ['channelId', 'turnNum'], ['desc', 'desc']);

  return _.sortedUniqBy(sorted, a => a.channelId);
}
