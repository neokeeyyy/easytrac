/* EasyTrac store: JSON values in localStorage (replaces GM_getValue/GM_setValue). */
(function () {
  'use strict';
  var ET = globalThis.EasyTrac;
  var P = 'easytrac:';

  function get(k, def) {
    try {
      var v = localStorage.getItem(P + k);
      return v == null ? def : JSON.parse(v);
    } catch (e) { return def; }
  }
  function set(k, v) {
    try { localStorage.setItem(P + k, JSON.stringify(v)); return true; }
    catch (e) { return false; }
  }
  function del(k) {
    try { localStorage.removeItem(P + k); } catch (e) {}
  }

  ET.store = { get: get, set: set, del: del };
})();
