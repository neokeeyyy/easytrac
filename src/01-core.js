/* EasyTrac core: namespace, logging, route guard. Loaded first. */
(function () {
  'use strict';
  var root = typeof globalThis !== 'undefined' ? globalThis : window;
  var ET = root.EasyTrac = root.EasyTrac || {};

  ET.base = 'https://cdn.jsdelivr.net/gh/neokeeyyy/easytrac@main/src/';
  ET.version = '0.0.0-dev'; /* tools/build.mjs replace con la versión de package.json */

  ET.log = function () {
    try { console.log.apply(console, ['[EasyTrac]'].concat([].slice.call(arguments))); } catch (e) {}
  };
  ET.error = function () {
    try { console.error.apply(console, ['[EasyTrac]'].concat([].slice.call(arguments))); } catch (e) {}
  };

  /* Run fn when the DOM is usable. */
  ET.ready = function (fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  };

  /* Run fn only on the given path pattern. */
  ET.on = function (re, fn) {
    if (re.test(location.pathname + location.search)) fn();
  };
})();
