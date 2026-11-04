/* EasyTrac dates
   Pure date helpers (ACS semantics: local time). */
(function () {
  'use strict';
  var ET = globalThis.EasyTrac;

  function pad2(n) { return String(n).padStart(2, '0'); }

  function toISO(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }

  function isoToDMA(iso) { var p = String(iso).split('-'); return p[2] + '/' + p[1] + '/' + p[0]; }

  function parseDia(s) { var p = String(s).split('/'); return new Date(+p[2], +p[1] - 1, +p[0]); }

  function parseISO(s) { var p = String(s).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }

  function ahoraHora() { var d = new Date(); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()); }

  /* Weeks run Monday to Sunday: every range the toolkit shows starts on a Monday. */
  function lunesDe(v) { var d = typeof v === 'string' ? parseISO(v) : new Date(v.getTime()); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); d.setHours(0, 0, 0, 0); return d; }

  function domingoDe(v) { var d = lunesDe(v); d.setDate(d.getDate() + 6); return d; }

  function semanaDe(v) { return { lunes: toISO(lunesDe(v)), domingo: toISO(domingoDe(v)) }; }

  function semanaAnterior() { var d = lunesDe(new Date()); d.setDate(d.getDate() - 7); return { lunes: toISO(d), domingo: toISO(domingoDe(d)) }; }

  ET.core = ET.core || {};
  ET.core.dates = {
    pad2: pad2,
    toISO: toISO,
    isoToDMA: isoToDMA,
    parseDia: parseDia,
    parseISO: parseISO,
    ahoraHora: ahoraHora,
    lunesDe: lunesDe,
    domingoDe: domingoDe,
    semanaDe: semanaDe,
    semanaAnterior: semanaAnterior
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = ET.core.dates;
})();
