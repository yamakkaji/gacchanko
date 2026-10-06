'use strict';
// The canvas depends only on gacchankoHost, never on WebKit or Tauri directly.
// Another desktop shell may inject gacchankoPlatform before this script loads.
(() => {
  function swiftAdapter() {
    const handler = window.webkit?.messageHandlers?.gacchanko;
    if (!handler) return null;
    const pending = new Map();
    window.addEventListener('nativeReply', event => {
      const reply = event.detail;
      const request = pending.get(reply.id);
      if (!request) return;
      clearTimeout(request.timer);
      pending.delete(reply.id);
      reply.error ? request.reject(new Error(reply.error)) : request.resolve(reply.value);
    });
    return {
      kind: 'swift-webkit',
      request(command, args) {
        return new Promise((resolve, reject) => {
          const id = 'rpc_' + crypto.randomUUID();
          const timer = setTimeout(() => {
            pending.delete(id);
            reject(new Error('操作がタイムアウトしました。'));
          }, 300000);
          pending.set(id, {resolve, reject, timer});
          try { handler.postMessage({id, command, args}); }
          catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
        });
      },
      on(event, listener) {
        const names = {drop: 'nativeDrop', error: 'nativeError'};
        if (!names[event]) throw new Error('未対応のイベント: ' + event);
        const callback = message => listener(message.detail);
        window.addEventListener(names[event], callback);
        return () => window.removeEventListener(names[event], callback);
      }
    };
  }
  const adapter = window.gacchankoPlatform || swiftAdapter();
  if (adapter && (typeof adapter.request !== 'function' || typeof adapter.on !== 'function')) {
    throw new Error('gacchankoPlatform must implement request() and on().');
  }
  window.gacchankoHost = Object.freeze({
    available: !!adapter,
    platform: adapter?.kind || 'browser-preview',
    async request(command, args={}) {
      if (!adapter) throw new Error('この操作は gacchanko のデスクトップアプリで利用できます。');
      try { return await adapter.request(command, args); }
      catch (error) { throw error instanceof Error ? error : new Error(String(error)); }
    },
    async on(event, listener) {
      if (!adapter) return () => {};
      return await adapter.on(event, listener);
    }
  });
})();
