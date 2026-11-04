/* EasyTrac http
   fetch helpers: retries, JSON in datos, multipart. */
(function () {
  'use strict';
  var ET = globalThis.EasyTrac;

  var HDRS = { 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' };
  var HDRS_PLAIN = { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' };

  /* Wired by the feature that owns the configuration and the logger. */
  function cfg() { return ET.core.http.config || {}; }
  function log() { if (ET.core.log) ET.core.log.apply(null, arguments); }

  function esperarMs(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function textoRespuesta(res) {
    return String(res && res.text || '').replace(/\s+/g, ' ').slice(0, 1200);
  }

  function apiPost(url, body, plain) {
    log(plain ? 'POST PLAIN' : 'POST', { url: url, body: body });
    return fetch(url, { method: 'POST', headers: plain ? HDRS_PLAIN : HDRS, body: body, credentials: 'same-origin' })
      .then(function (r) {
        return r.text().then(function (txt) {
          var j = null; try { j = JSON.parse(txt); } catch (e) {}
          var res = { status: r.status, text: txt, json: j };
          log('RESPUESTA', { url: url, status: r.status, json: j, text: textoRespuesta(res) });
          return res;
        });
      }).catch(function (e) {
        log('ERROR', { url: url, error: e.message });
        throw e;
      });
  }

  function respuestaReintentable(res) {
    return !res || !res.json || res.status === 408 || res.status === 429 || res.status >= 500;
  }

  function conReintentos(peticion, reintentar) {
    var intento = 0;
    var max = Math.max(1, Number(cfg().DATA_RETRIES) || 3);
    function ejecutar() {
      intento++;
      return peticion().then(function (res) {
        if (intento < max && reintentar(res)) {
          return esperarMs((Number(cfg().DATA_RETRY_BASE_MS) || 100) * Math.pow(2, intento - 1)).then(ejecutar);
        }
        return res;
      }).catch(function (e) {
        if (intento < max) {
          return esperarMs((Number(cfg().DATA_RETRY_BASE_MS) || 100) * Math.pow(2, intento - 1)).then(ejecutar);
        }
        throw e;
      });
    }
    return ejecutar();
  }

  function apiPostDatos(url, body) {
    return conReintentos(function () { return apiPost(url, body); }, respuestaReintentable);
  }

  function getJsonDatos(url) {
    return conReintentos(function () {
      return fetch(url, { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } })
        .then(function (r) {
          return r.text().then(function (txt) {
            var json = null;
            try { json = JSON.parse(txt); } catch (e) {}
            var res = { status: r.status, text: txt, json: json };
            log('RESPUESTA GET', { url: url, status: r.status, json: json, text: textoRespuesta(res) });
            return res;
          });
        });
    }, function (res) { return respuestaReintentable(res) || !res.json; })
      .then(function (res) {
        if (!res.json) throw new Error('respuesta no JSON en ' + url);
        return res.json;
      });
  }

  function datosDe(url) {
    return apiPostDatos(url, 'idEstatus=-2').then(function (res) { return (res.json && res.json.data) || []; });
  }

  function postMultipart(url, formData) {
    return fetch(url, {
      method: 'POST',
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
      body: formData,
      credentials: 'same-origin'
    }).then(function (r) {
      return r.text().then(function (txt) {
        var json = null;
        try { json = JSON.parse(txt); } catch (e) {}
        return { status: r.status, text: txt, json: json };
      });
    });
  }

  ET.core = ET.core || {};
  ET.core.http = {
    esperarMs: esperarMs,
    textoRespuesta: textoRespuesta,
    apiPost: apiPost,
    respuestaReintentable: respuestaReintentable,
    conReintentos: conReintentos,
    apiPostDatos: apiPostDatos,
    getJsonDatos: getJsonDatos,
    datosDe: datosDe,
    postMultipart: postMultipart
  };
})();
