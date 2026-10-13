'use strict';
(() => {
  const tauri = window.__TAURI__;
  if (!tauri) return;
  window.gacchankoPlatform = {
    kind: 'tauri',
    request(command, args) { return tauri.core.invoke('gacchanko_rpc', {command, args}); },
    on(event, listener) {
      if (!['drop', 'error'].includes(event)) throw new Error('Unsupported host event: ' + event);
      return tauri.event.listen('gacchanko://' + event, message => listener(message.payload));
    }
  };
  // The language preference lives alongside the canvas preferences. Synchronize
  // native menus on startup as well as when the settings UI changes language.
  let language = 'ja';
  try { language = localStorage.getItem('gacchanko-language') || language; } catch {}
  tauri.core.invoke('gacchanko_rpc', {command:'setLanguage', args:{language}}).catch(console.error);
})();
