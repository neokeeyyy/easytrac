/* EasyTrac core: namespace and logging. Loaded first. */
(function () {
  'use strict';
  var root = typeof globalThis !== 'undefined' ? globalThis : window;
  var ET = root.EasyTrac = root.EasyTrac || {};

  ET.version = '0.0.0-dev'; /* tools/build.mjs replace con la versión de package.json */

  ET.log = function () {
    try { console.log.apply(console, ['[EasyTrac]'].concat([].slice.call(arguments))); } catch (e) {}
  };

  /* Run fn when the DOM is usable. */
  ET.ready = function (fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  };
})();
