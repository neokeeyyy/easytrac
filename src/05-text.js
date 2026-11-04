/* EasyTrac text
   Small string and HTML helpers. */
(function () {
  'use strict';
  var ET = globalThis.EasyTrac;

  function limpiarHtml(s) {
    return String(s).replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/g, "'")
      .replace(/&oacute;/gi, 'ó').replace(/&aacute;/gi, 'á').replace(/&eacute;/gi, 'é')
      .replace(/&iacute;/gi, 'í').replace(/&uacute;/gi, 'ú').replace(/&ntilde;/gi, 'ñ')
      .replace(/\s+/g, ' ').trim();
  }

  function pick(obj, keys) {
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (obj && obj[k] !== undefined && obj[k] !== null && String(obj[k]) !== '') return String(obj[k]);
    }
    return '';
  }

  function matchInput(html, id) {
    var m = html.match(new RegExp("(?:id|name)\\s*=\\s*[\"']" + id + "[\"'][^>]*?value\\s*=\\s*[\"']([^\"']*)[\"']", 'i')) ||
      html.match(new RegExp("value\\s*=\\s*[\"']([^\"']*)[\"'][^>]*?(?:id|name)\\s*=\\s*[\"']" + id + "[\"']", 'i'));
    return m ? m[1] : '';
  }

  function matchText(html, id) {
    var re = new RegExp("(?:id|class)\\s*=\\s*[\"'][^\"']*\\b" + id + "\\b[^\"']*[\"'][^>]*>([^<]*)<", 'i');
    var m = html.match(re);
    return m ? m[1].trim() : '';
  }

  ET.core = ET.core || {};
  ET.core.text = {
    limpiarHtml: limpiarHtml,
    pick: pick,
    matchInput: matchInput,
    matchText: matchText
  };
})();
