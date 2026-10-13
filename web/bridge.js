'use strict';
// The canvas depends only on gacchankoHost, never on WebKit or Tauri directly.
// Another desktop shell may inject gacchankoPlatform before this script loads.
(() => {
  const adapter = window.gacchankoPlatform;
  if (adapter && (typeof adapter.request !== 'function' || typeof adapter.on !== 'function')) {
    throw new Error('gacchankoPlatform must implement request() and on().');
  }
  window.gacchankoHost = Object.freeze({
    available: !!adapter,
    platform: adapter?.kind || 'browser-preview',
    async request(command, args={}) {
      if (!adapter) throw new Error(i18n.t('この操作は gacchanko のデスクトップアプリで利用できます。'));
      try { return await adapter.request(command, args); }
      catch (error) { throw error instanceof Error ? error : new Error(String(error)); }
    },
    async on(event, listener) {
      if (!adapter) return () => {};
      return await adapter.on(event, listener);
    }
  });
})();
