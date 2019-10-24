// EventEmitter3@4.0.0
!function(e){if("object"==typeof exports&&"undefined"!=typeof module)module.exports=e();else if("function"==typeof define&&define.amd)define([],e);else{("undefined"!=typeof window?window:"undefined"!=typeof global?global:"undefined"!=typeof self?self:this).EventEmitter3=e()}}(function(){return function i(s,f,c){function u(t,e){if(!f[t]){if(!s[t]){var n="function"==typeof require&&require;if(!e&&n)return n(t,!0);if(a)return a(t,!0);var r=new Error("Cannot find module '"+t+"'");throw r.code="MODULE_NOT_FOUND",r}var o=f[t]={exports:{}};s[t][0].call(o.exports,function(e){return u(s[t][1][e]||e)},o,o.exports,i,s,f,c)}return f[t].exports}for(var a="function"==typeof require&&require,e=0;e<c.length;e++)u(c[e]);return u}({1:[function(e,t,n){"use strict";var r=Object.prototype.hasOwnProperty,v="~";function o(){}function f(e,t,n){this.fn=e,this.context=t,this.once=n||!1}function i(e,t,n,r,o){if("function"!=typeof n)throw new TypeError("The listener must be a function");var i=new f(n,r||e,o),s=v?v+t:t;return e._events[s]?e._events[s].fn?e._events[s]=[e._events[s],i]:e._events[s].push(i):(e._events[s]=i,e._eventsCount++),e}function u(e,t){0==--e._eventsCount?e._events=new o:delete e._events[t]}function s(){this._events=new o,this._eventsCount=0}Object.create&&(o.prototype=Object.create(null),(new o).__proto__||(v=!1)),s.prototype.eventNames=function(){var e,t,n=[];if(0===this._eventsCount)return n;for(t in e=this._events)r.call(e,t)&&n.push(v?t.slice(1):t);return Object.getOwnPropertySymbols?n.concat(Object.getOwnPropertySymbols(e)):n},s.prototype.listeners=function(e){var t=v?v+e:e,n=this._events[t];if(!n)return[];if(n.fn)return[n.fn];for(var r=0,o=n.length,i=new Array(o);r<o;r++)i[r]=n[r].fn;return i},s.prototype.listenerCount=function(e){var t=v?v+e:e,n=this._events[t];return n?n.fn?1:n.length:0},s.prototype.emit=function(e,t,n,r,o,i){var s=v?v+e:e;if(!this._events[s])return!1;var f,c,u=this._events[s],a=arguments.length;if(u.fn){switch(u.once&&this.removeListener(e,u.fn,void 0,!0),a){case 1:return u.fn.call(u.context),!0;case 2:return u.fn.call(u.context,t),!0;case 3:return u.fn.call(u.context,t,n),!0;case 4:return u.fn.call(u.context,t,n,r),!0;case 5:return u.fn.call(u.context,t,n,r,o),!0;case 6:return u.fn.call(u.context,t,n,r,o,i),!0}for(c=1,f=new Array(a-1);c<a;c++)f[c-1]=arguments[c];u.fn.apply(u.context,f)}else{var l,p=u.length;for(c=0;c<p;c++)switch(u[c].once&&this.removeListener(e,u[c].fn,void 0,!0),a){case 1:u[c].fn.call(u[c].context);break;case 2:u[c].fn.call(u[c].context,t);break;case 3:u[c].fn.call(u[c].context,t,n);break;case 4:u[c].fn.call(u[c].context,t,n,r);break;default:if(!f)for(l=1,f=new Array(a-1);l<a;l++)f[l-1]=arguments[l];u[c].fn.apply(u[c].context,f)}}return!0},s.prototype.on=function(e,t,n){return i(this,e,t,n,!1)},s.prototype.once=function(e,t,n){return i(this,e,t,n,!0)},s.prototype.removeListener=function(e,t,n,r){var o=v?v+e:e;if(!this._events[o])return this;if(!t)return u(this,o),this;var i=this._events[o];if(i.fn)i.fn!==t||r&&!i.once||n&&i.context!==n||u(this,o);else{for(var s=0,f=[],c=i.length;s<c;s++)(i[s].fn!==t||r&&!i[s].once||n&&i[s].context!==n)&&f.push(i[s]);f.length?this._events[o]=1===f.length?f[0]:f:u(this,o)}return this},s.prototype.removeAllListeners=function(e){var t;return e?(t=v?v+e:e,this._events[t]&&u(this,t)):(this._events=new o,this._eventsCount=0),this},s.prototype.off=s.prototype.removeListener,s.prototype.addListener=s.prototype.on,s.prefixed=v,s.EventEmitter=s,void 0!==t&&(t.exports=s)},{}]},{},[1])(1)});

const log = window['debug'] ? window['debug']('wallet:bridge') : console.log;

let timeoutListener = null;
let attempts = 0;
const timeoutMs = 50;
const maxRetries = 5;

const events = new EventEmitter3.EventEmitter();

const getWalletFrame = () => {
  return new Promise(resolve => {
    let walletIframe = document.querySelector('iframe#wallet');
    if (!walletIframe) {
      const style = document.createElement('style');
      style.innerHTML = `
      iframe#wallet {
        border: 0;
        position: absolute;
        left: 0;
        right: 0;
        margin-left: auto;
        margin-right: auto;
        width: 700px;
        height: 500px;
        top: 50%;
        margin-top: -250px;
        overflow: hidden;
        z-index: 1;
      }

      div#walletContainer {
        position: absolute;
        left: 0px;
        top: 0px;
        width: 100%;
        height: 100%;
        background: #000;
        opacity: 0.32;
        z-index: 0;
      }
      `;
      document.head.appendChild(style);
      const walletContainer = document.createElement('div');
      walletContainer.id = 'walletContainer';
      walletIframe = document.createElement('iframe');
      walletIframe.id = 'wallet';
      walletIframe.src = ChannelProvider.url;
      document.body.appendChild(walletIframe);
      document.body.appendChild(walletContainer);

      walletIframe.onload = () => {
        log('Iframe loaded');
        resolve(walletIframe.contentWindow);
      };
    } else {
      log('Iframe already exists');
      resolve(walletIframe.contentWindow);
    }
  });
};

const request = (message, callback, url) => {
  if (!message.id) {
    message.id = Date.now();
  }
  return new Promise((resolve, reject) => {
    let listener;
    if (callback) {
      listener = event => {
        if (event.data && event.data.jsonrpc && event.data.result && event.data.id === message.id) {
          callback(event.data.result);
          window.removeEventListener('message', listener);
          log('Received response: %o', event.data);
          resolve(event.data.result);
        } else if (event.data.error) {
          reject(event.data.error);
        }
      };
    } else {
      listener = event => {
        if (event.data && event.data.jsonrpc && event.data.result && event.data.id === message.id) {
          window.removeEventListener('message', listener);
          log('Received response: %o', event.data);
          resolve(event.data.result);
        } else if (event.data.error) {
          reject(event.data.error);
        }
      };
    }

    window.addEventListener('message', listener);
    log('Requesting: %o', message);

    getWalletFrame().then(contentWindow => relayMessage(contentWindow, message, url));
  });
};

const relayMessage = (contentWindow, message, url) => {
  attempts += 1;

  log('Relaying message: %o (attempt %o)', message, attempts);
  contentWindow.postMessage(message, url);
  log('Relayed message: %o', message);

  timeoutListener = setTimeout(() => {
    if (attempts < maxRetries) {
      log('Request %o timed out after %o ms, retrying', message, timeoutMs);
      relayMessage(contentWindow, message);
    } else {
      log('Request %o timed out after %o attempts; is wallet unreachable?', message, attempts);
    }
  }, timeoutMs);
};

const onMessage = event => {
  const message = event.data;

  if (message === 'ui:wallet:close') {
    log('Close signal received: %o', message);
    document.querySelector('iframe#wallet').remove();
    document.querySelector('#walletContainer').remove();
    log('Iframe removed');
    return;
  }

  if (message === 'ui:wallet:ack') {
    log('ACK signal received');
    clearTimeout(timeoutListener);
    attempts = 0;
    return;
  }

  if (!message.jsonrpc || message.result) {
    return;
  }

  getWalletFrame().then(contentWindow => relayMessage(contentWindow, message, ChannelProvider.url));
};

class ChannelProvider {
  url = 'http://localhost:1701';

  static enable(url = undefined) {
    window.addEventListener('message', onMessage);

    if (url) {
      ChannelProvider.url = url;
    }
  }

  static async send(method, params = []) {
    return request({
      jsonrpc: '2.0',
      method,
      params
    });
  }

  static async subscribe(subscriptionType, params = []) {
    try {
      const response = request({
        jsonrpc: '2.0',
        method: 'chan_subscribe',
        params: [subscriptionType, ...params]
      });

      return response.subscription;
    } catch {
      console.error(error);
      throw new Error('Failed to subscribe');
    }
  }

  static async unsubscribe(subscriptionId) {
    try {
      request({
        jsonrpc: '2.0',
        method: 'chan_unsubscribe',
        params: [subscriptionId]
      });
    } catch (error) {
      console.error(error);
      throw new Error('Failed to unsubscribe');
    }

    events.off(subscriptionId);
    return true;
  }

  static on(event, callback) {
    events.on(event, callback);
  }

  static off(event, callback = undefined) {
    events.off(event, callback);
  }
}

if (window) {
  window.channelProvider = ChannelProvider;
} else if (global) {
  global.channelProvider = ChannelProvider;
} else if (module) {
  module.exports = ChannelProvider;
}
