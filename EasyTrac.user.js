// ==UserScript==
// @name         EasyTRAC
// @namespace    easytrac
// @version      1.1.12
// @description  Toolkit SIRETRAC en un solo sidebar: ACS, acuses, venta, fecha, precios CNE y traspasos.
// @author       ojuel
// @match        https://siretrac.cne.gob.mx/*
// @match        http://siretrac.cne.gob.mx/*
// @grant        GM_xmlhttpRequest
// @connect      www.gob.mx
// @run-at       document-idle
// @noframes
// @updateURL    https://raw.githubusercontent.com/neokeeyyy/easytrac/main/EasyTrac.user.js
// @downloadURL  https://raw.githubusercontent.com/neokeeyyy/easytrac/main/EasyTrac.user.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js
// @require      https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js
// @require      https://cdn.jsdelivr.net/gh/neokeeyyy/easytrac@v1.1.12/src/01-core.js
// @require      https://cdn.jsdelivr.net/gh/neokeeyyy/easytrac@v1.1.12/src/02-store.js
// @require      https://cdn.jsdelivr.net/gh/neokeeyyy/easytrac@v1.1.12/src/03-http.js
// @require      https://cdn.jsdelivr.net/gh/neokeeyyy/easytrac@v1.1.12/src/04-dates.js
// @require      https://cdn.jsdelivr.net/gh/neokeeyyy/easytrac@v1.1.12/src/05-text.js
// @require      https://cdn.jsdelivr.net/gh/neokeeyyy/easytrac@v1.1.12/src/06-permisos.js
// @require      https://cdn.jsdelivr.net/gh/neokeeyyy/easytrac@v1.1.12/src/10-ui-tokens.js
// @require      https://cdn.jsdelivr.net/gh/neokeeyyy/easytrac@v1.1.12/src/11-ui-sidebar.js
// @require      https://cdn.jsdelivr.net/gh/neokeeyyy/easytrac@v1.1.12/src/12-ui-notice.js
// @require      https://cdn.jsdelivr.net/gh/neokeeyyy/easytrac@v1.1.12/src/13-ui-grid.js
// @require      https://cdn.jsdelivr.net/gh/neokeeyyy/easytrac@v1.1.12/src/14-ui-config.js
// @require      https://cdn.jsdelivr.net/gh/neokeeyyy/easytrac@v1.1.12/src/20-acs.js
// @require      https://cdn.jsdelivr.net/gh/neokeeyyy/easytrac@v1.1.12/src/30-acuses.js
// @require      https://cdn.jsdelivr.net/gh/neokeeyyy/easytrac@v1.1.12/src/40-venta.js
// @require      https://cdn.jsdelivr.net/gh/neokeeyyy/easytrac@v1.1.12/src/50-fecha.js
// @require      https://cdn.jsdelivr.net/gh/neokeeyyy/easytrac@v1.1.12/src/60-precios-cne.js
// @require      https://cdn.jsdelivr.net/gh/neokeeyyy/easytrac@v1.1.12/src/65-compra.js
// @require      https://cdn.jsdelivr.net/gh/neokeeyyy/easytrac@v1.1.12/src/70-traspasos.js
// ==/UserScript==
if (typeof EasyTrac !== 'undefined') EasyTrac.version = '1.1.12';
