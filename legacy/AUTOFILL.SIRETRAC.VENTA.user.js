// ==UserScript==
// @name         SIRETRAC Auto-fill Registro de Venta
// @namespace    siretrac-autofill
// @version      1.6.0
// @description  Al pegar el bloque de ventas de tu Excel, llena fecha, autoconsumo y las filas de Auto-tanque y Recipientes en la página de registro de ventas de SIRETRAC. Verifica cada campo con el "check verde" y reintenta hasta 3 veces para evitar ceros en el acuse. Pide confirmación antes de registrar cualquier día/bloque como "Sin venta".
// @match        https://siretrac.cne.gob.mx/GasLP/Ventas/RegistroVentaDisPla
// @match        https://siretrac.cne.gob.mx/GasLP/Ventas/RegistroVentaES
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

  /* ===== SHub: menú unificado (copia IDÉNTICA en cada script; el primero en cargar crea el menú) ===== */
  function shubTab(id, titulo, orden, ancho) {
    var D = document;
    if (!D.getElementById('shub-style')) {
      var st = D.createElement('style');
      st.id = 'shub-style';
      st.textContent =
        '#shub-root{position:fixed;top:0;right:0;bottom:0;width:var(--shub-w,320px);z-index:2147483000;display:flex;flex-direction:column;background:#f1f1f1;border-left:1px solid #6f6f6f;box-shadow:-4px 0 18px rgba(0,0,0,.28);font:13px "roboto Neue",roboto,Arial,sans-serif;color:#000;}' +
        '#shub-root *{box-sizing:border-box;}' +
        '#shub-head{background:#6f6f6f;color:#fff;padding:9px 12px;font-weight:bold;font-size:15px;display:flex;justify-content:space-between;align-items:center;user-select:none;}' +
        '#shub-head button{background:#555;border:1px solid #444;border-bottom-width:3px;color:#fff;width:28px;height:24px;cursor:pointer;font-weight:bold;border-radius:3px;line-height:1;}' +
        '#shub-tabs{display:flex;flex-wrap:wrap;background:#fff;border-bottom:1px solid #6f6f6f;}' +
        '.shub-tab{background:none;border:1px solid transparent;border-bottom:none;margin-bottom:-1px;padding:9px 14px;cursor:pointer;color:#333;font:bold 13px "roboto Neue",roboto,Arial,sans-serif;}' +
        '.shub-tab:hover{background:#f1f1f1;color:#000;}' +
        '.shub-tab.on{background:#6f6f6f;color:#fff;border-color:#6f6f6f;}' +
        '#shub-panes{flex:1;min-height:0;overflow:auto;}' +
        '.shub-pane{display:none;padding:10px;}' +
        '.shub-pane.on{display:block;}' +
        '#shub-root.shub-min #shub-tabs,#shub-root.shub-min #shub-panes,#shub-root.shub-min #shub-head span{display:none;}' +
        '#shub-root.shub-min #shub-head{justify-content:center;padding:9px 0;}' +
        'body.shub-shift .content-wrapper,body.shub-shift .right-side,body.shub-shift .main-footer{margin-right:calc(var(--shub-w,320px) + 10px);}' +
        'body.shub-shift .main-header .navbar{margin-right:calc(var(--shub-w,320px) + 10px);display:flex;flex-wrap:nowrap;align-items:center;}' +
        'body.shub-shift .main-header .navbar-header,body.shub-shift .main-header .siretrac_header{float:none;flex:1 1 auto;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;}' +
        'body.shub-shift .main-header .navbar-custom-menu,body.shub-shift .main-header .navbar-right{float:none;flex:0 0 auto;}' +
        '#ui-datepicker-div{z-index:2147483647 !important;}';
      (D.head || D.documentElement).appendChild(st);
    }
    var root = D.getElementById('shub-root');
    function layout() {
      var min = root.classList.contains('shub-min'), on = root.querySelector('.shub-pane.on');
      D.documentElement.style.setProperty('--shub-w', (min ? 44 : (on ? +on.getAttribute('data-w') : 320)) + 'px');
      root.querySelector('#shub-min').textContent = min ? '\u00AB' : '\u00BB';
    }
    function activar(tid, guardar) {
      var els = root.querySelectorAll('.shub-tab,.shub-pane');
      for (var i = 0; i < els.length; i++) els[i].classList[els[i].getAttribute('data-id') === tid ? 'add' : 'remove']('on');
      if (guardar) { try { localStorage.setItem('shub_tab', tid); } catch (e) {} }
      layout();
    }
    if (!root) {
      root = D.createElement('div');
      root.id = 'shub-root';
      root.innerHTML = '<div id="shub-head"><span>Toolkit</span><button id="shub-min" type="button" title="Colapsar / expandir">\u00BB</button></div><div id="shub-tabs"></div><div id="shub-panes"></div>';
      D.body.appendChild(root);
      D.body.classList.add('shub-shift');
      try { if (localStorage.getItem('shub_min') === '1') root.classList.add('shub-min'); } catch (e) {}
      root.querySelector('#shub-min').addEventListener('click', function () {
        var m = root.classList.toggle('shub-min');
        try { localStorage.setItem('shub_min', m ? '1' : '0'); } catch (e) {}
        layout();
      });
    }
    var tabs = root.querySelector('#shub-tabs'), panes = root.querySelector('#shub-panes');
    var existente = panes.querySelector('[data-id="' + id + '"]');
    if (existente) return existente;
    var o = String(orden || 99);
    var pane = D.createElement('div');
    pane.className = 'shub-pane';
    pane.setAttribute('data-id', id); pane.setAttribute('data-o', o); pane.setAttribute('data-w', String(ancho || 320));
    var btn = D.createElement('button');
    btn.type = 'button'; btn.className = 'shub-tab'; btn.textContent = titulo;
    btn.setAttribute('data-id', id); btn.setAttribute('data-o', o);
    btn.addEventListener('click', function () { activar(id, true); });
    function insertar(cont, el) {
      var hijos = cont.children, ref = null;
      for (var i = 0; i < hijos.length; i++) { if (+hijos[i].getAttribute('data-o') > +o) { ref = hijos[i]; break; } }
      cont.insertBefore(el, ref);
    }
    insertar(tabs, btn); insertar(panes, pane);
    var guardada = ''; try { guardada = localStorage.getItem('shub_tab') || ''; } catch (e) {}
    if (!root.querySelector('.shub-pane.on') || guardada === id) activar(id, false); else layout();
    return pane;
  }
  /* ===== fin SHub ===== */


    if (typeof jQuery === 'undefined' || typeof $ === 'undefined') return;

    var esPaginaDisPla = $('#idtblVentasEntidad').length > 0;
    var esPaginaES = !esPaginaDisPla && $('#idVolumenVehiculo').length > 0;
    if (!esPaginaDisPla && !esPaginaES) return;

    shubTab('venta', 'Venta', 40, 300).innerHTML =
        '<div style="font-weight:bold;margin-bottom:6px">Auto-fill de ventas</div>' +
        '<div style="font-size:12px;line-height:1.45;color:#333">Copia el bloque de ventas de tu Excel y p\u00E9galo (Ctrl+V) en esta p\u00E1gina. ' +
        'El script llena fecha, autoconsumo y las filas de Auto-tanque y Recipientes, y verifica cada campo.<br><br>' +
        'Tipo de p\u00E1gina: <b>' + (esPaginaDisPla ? 'Distribuidor por Planta' : 'Estaci\u00F3n de Servicio') + '</b></div>';

    var RE_FECHA = /^(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo),\s*(\d{1,2})\s+de\s+([a-záéíóúñü]+)\s+de\s+(\d{4})$/i;
    var MESES = { enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12 };
    var SECTORES = { comercial: 'Comercial y Servicio', 'comercial y servicio': 'Comercial y Servicio', residencial: 'Residencial' };
    var ESTADOS = ['guanajuato', 'zacatecas', 'san luis potosi', 'jalisco', 'aguascalientes', 'nuevo leon', 'coahuila', 'tamaulipas', 'veracruz', 'michoacan', 'queretaro', 'hidalgo', 'mexico', 'ciudad de mexico', 'durango', 'chihuahua', 'sonora', 'sinaloa', 'nayarit', 'colima'];
    var ORDEN_FIJO = [
        ['Guanajuato', 'San Felipe', 'Comercial'],
        ['Guanajuato', 'San Felipe', 'Residencial'],
        ['Zacatecas', 'Pinos', 'Comercial'],
        ['Zacatecas', 'Pinos', 'Residencial'],
        ['San Luis Potosí', 'Villa de Arriaga', 'Comercial'],
        ['San Luis Potosí', 'Villa de Arriaga', 'Residencial'],
        ['Jalisco', 'Ojuelos de Jalisco', 'Comercial'],
        ['Jalisco', 'Ojuelos de Jalisco', 'Residencial']
    ];

    function norm(s) {
        return (s || '').toString().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    }

    function cells(linea) {
        return linea.split('\t').map(function (c) { return c.trim(); });
    }

    function esNumero(c) {
        if (!c) return false;
        return /^-?\d+(\.\d+)?$/.test(c.replace(/[$,\s]/g, ''));
    }

    function aNumero(c) {
        var v = parseFloat(c.replace(/[$,\s]/g, ''));
        return isNaN(v) ? 0 : v;
    }

    function fechaDe(texto) {
        var m = RE_FECHA.exec(texto || '');
        if (!m) return null;
        var mes = MESES[(m[3] || '').toLowerCase()];
        if (!mes) return null;
        return ('0' + m[2]).slice(-2) + '/' + ('0' + mes).slice(-2) + '/' + m[4];
    }

    function sectorDesdeCelda(celdas) {
        for (var i = 0; i < celdas.length; i++) {
            var s = SECTORES[norm(celdas[i])];
            if (s) return s;
        }
        return null;
    }

    function esDash(c) {
        return c.replace(/[$\s]/g, '') === '-';
    }

    // Pide confirmación explícita al usuario antes de que el script marque
    // algo como "Sin venta" de forma automática. Devuelve true solo si el
    // usuario aceptó; en cualquier otro caso (Cancelar) no se debe registrar nada.
    function confirmarSinVenta(mensaje) {
        return window.confirm(mensaje);
    }

    function parsear(texto) {
        var lineas = texto.split(/\r?\n/);
        var res = { fechas: [], totalLitros: null, autoconsumo: null, bloques: [], filaTotal: null, recipientes: { lineas: [] } };
        var fase = 'totales';
        var seccion = null;
        var nBloques = 0;
        for (var i = 0; i < lineas.length; i++) {
            var c = cells(lineas[i]);
            var noVacias = c.filter(function (x) { return x !== ''; });
            for (var k = 0; k < c.length; k++) {
                var f = fechaDe(c[k]);
                if (f) res.fechas.push(f);
            }
            var esCab = c.some(function (x) { return norm(x) === 'volumen'; });
            var nums = c.filter(esNumero);
            var hayDash = c.some(esDash);
            if (fase === 'totales') {
                if (!noVacias.length) continue;
                if (esCab) {
                    fase = 'bloques';
                    seccion = { nombre: null, municipio: null, lineas: [] };
                    res.bloques.push(seccion);
                    nBloques = 1;
                    continue;
                }
                if (nums.length && res.totalLitros === null) res.totalLitros = nums.map(aNumero);
                else if (nums.length && res.autoconsumo === null) res.autoconsumo = nums.map(aNumero);
                continue;
            }
            if (fase === 'bloques') {
                if (!noVacias.length) continue;
                if (esCab && nBloques < 4) {
                    seccion = { nombre: null, municipio: null, lineas: [] };
                    res.bloques.push(seccion);
                    nBloques++;
                    continue;
                }
                if (esCab) { fase = 'recipientes'; continue; }
                if (nums.length === 2 && nBloques >= 4) { res.filaTotal = nums.map(aNumero); fase = 'recipientes'; continue; }
                if (nums.length === 3 || nums.length === 6) {
                    if (ESTADOS.indexOf(norm(c[0])) >= 0 && c[0] !== '') {
                        seccion.nombre = c[0];
                        seccion.municipio = c[1] || '';
                    }
                    seccion.lineas.push({ celdas: c, nums: nums.map(aNumero) });
                    continue;
                }
                if (hayDash) {
                    seccion.lineas.push({ celdas: c, nums: [0, 0, 0], cero: true });
                    continue;
                }
                continue;
            }
            if (!noVacias.length || esCab) continue;
            if (nums.length === 3 || nums.length === 6) {
                res.recipientes.lineas.push({ celdas: c, nums: nums.map(aNumero) });
            } else if (hayDash) {
                res.recipientes.lineas.push({ sinVenta: true });
            }
        }
        return res;
    }

    function elegirColumna(fechas, fechaActual) {
        if (!fechas.length) return 0;
        if (fechas.length === 1) return 0;
        if (fechaActual) {
            for (var i = 0; i < fechas.length; i++) {
                if (norm(fechas[i]) === norm(fechaActual)) return i;
            }
        }
        return fechas.length - 1;
    }

    function valoresDeLinea(nums, col) {
        if (nums.length === 3) return { vol: nums[0], imp: nums[2] };
        if (nums.length === 6) return { vol: nums[col * 3], imp: nums[col * 3 + 2] };
        return null;
    }

    function toast(mensajes) {
        var prev = document.getElementById('siretrac-toast');
        if (prev) prev.remove();
        var d = document.createElement('div');
        d.id = 'siretrac-toast';
        d.style.cssText = 'position:fixed;top:10px;right:calc(var(--shub-w,0px) + 20px);z-index:2147483647;background:#1d3557;color:#ffffff;padding:12px 16px;border-radius:6px;font:13px/1.6 Arial,sans-serif;max-width:400px;box-shadow:0 2px 10px rgba(0,0,0,0.4);';
        for (var i = 0; i < mensajes.length; i++) {
            var p = document.createElement('div');
            p.textContent = mensajes[i];
            d.appendChild(p);
        }
        document.body.appendChild(d);
        setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, 15000);
    }

    function pintarInput(id, valor) {
        var el = document.getElementById(id);
        if (!el) return false;
        var texto;
        try { texto = formatNumber.new(valor, ''); } catch (err) { texto = String(valor); }
        el.value = texto;
        return true;
    }

    function pintarFilaAT(fila) {
        var ok1 = pintarInput('Volumen-' + fila.idVenta, fila.volumen);
        var ok2 = pintarInput('ValorVenta-' + fila.idVenta, fila.valorVenta);
        return ok1 && ok2;
    }

    function pintarFilaRec(fila) {
        var ok1 = pintarInput('CantidadVendida-' + fila.idVenta, fila.cantidadVendida);
        var ok2 = pintarInput('ValorVenta-' + fila.idVenta, fila.valorVenta);
        return ok1 && ok2;
    }

    function buscarFilaAT(estado, municipio, sector) {
        var table = $('#idtblVentasEntidad').DataTable();
        var sMap = SECTORES[norm(sector)];
        var targetSector = sMap || sector;
        var encontrada = null;
        table.rows().every(function () {
            var d = this.data();
            if (encontrada) return;
            if (norm(d.entidadFederativa) === norm(estado) &&
                norm(d.municipio) === norm(municipio) &&
                norm(d.sector) === norm(targetSector)) {
                encontrada = d;
            }
        });
        return encontrada;
    }

    function inputGrupo($i) {
        return $i.closest('.input-group').length ? $i.closest('.input-group') : $i.parent();
    }

    // True si el campo ya muestra el "check verde" nativo de SIRETRAC
    // (estado "valid" que jQuery Validate marca por cada input).
    function tieneCheck($i) {
        if (!$i || !$i.length) return false;
        if ($i.closest('.col-sm-12.has-success').length) return true;
        if (inputGrupo($i).find('span.glyphicon-ok').length) return true;
        if ($i.attr('aria-invalid') === 'false' && $i.attr('aria-describedby')) return true;
        return false;
    }

    // Marca el check verde: primero deja que el validador nativo corra y,
    // si no pinta nada, inyecta el mismo DOM que usa la página validada.
    function forzarCheck($i) {
        if (!$i || !$i.length) return;
        try {
            $i.trigger('change');
            var form = $i.closest('form');
            if (form.length && form.validate) {
                form.validate().element($i);
            }
        } catch (err) {}
        if (tieneCheck($i)) return;
        var id = $i.attr('id') || '';
        var $grupo = inputGrupo($i);
        var $wrap = $i.closest('.col-sm-12.has-feedback').length ? $i.closest('.col-sm-12.has-feedback') : $i.closest('.col-sm-12');
        if ($wrap.length) $wrap.addClass('has-feedback has-success');
        if (!$grupo.find('span.form-control-feedback.glyphicon-ok').length) {
            $grupo.append('<span class="glyphicon form-control-feedback glyphicon-ok" style="right: 0; left:0; z-index:3;"></span>');
        }
        $i.attr('aria-describedby', id + '-error').attr('aria-invalid', 'false');
        var $msgC = $i.closest('div').find('.messageContainer');
        if ($msgC.length && !$msgC.find('em').length) {
            $msgC.append('<em id="' + id + '-error" class="error help-block" style="display: inline;"></em>');
        }
    }

    // Escritura + verificación por campo. Reintenta hasta 3 veces (doble
    // validación) y reporta si algún valor quedó en 0 o sin check.
    async function escribirYVerificarFila(fila, idVol, idVal, campoVol, campoVal, esperadoVol, esperadoVal, msgs, warns, label) {
        if ($('#' + idVol).length === 0 || $('#' + idVal).length === 0) {
            fila[campoVol] = esperadoVol;
            fila[campoVal] = esperadoVal;
            try { ActualizaDatosVentaPrecargaDDAC(fila); } catch (err) {}
            warns.push(label + ': fila fuera de la página actual; dato guardado pero no verificable aquí (avanza de página para confirmar el check).');
            return false;
        }
        var ok = false;
        for (var intento = 0; intento < 3 && !ok; intento++) {
            fila[campoVol] = esperadoVol;
            fila[campoVal] = esperadoVal;
            pintarInput(idVol, esperadoVol);
            pintarInput(idVal, esperadoVal);
            try { ActualizaDatosVentaPrecargaDDAC(fila); } catch (err) {}
            await sleep(350);
            var $v = $('#' + idVol);
            var $imp = $('#' + idVal);
            forzarCheck($v);
            forzarCheck($imp);
            var volOk = tieneCheck($v) && (esperadoVol === 0 || aNumero($v.val()) !== 0);
            var impOk = tieneCheck($imp) && (esperadoVal === 0 || aNumero($imp.val()) !== 0);
            ok = volOk && impOk;
        }
        if (ok) {
            msgs.push(label + ' ✔');
            return true;
        }
        var causas = [];
        if (!tieneCheck($('#' + idVol)) || !tieneCheck($('#' + idVal))) causas.push('sin check');
        if (aNumero($('#' + idVol).val()) === 0 || aNumero($('#' + idVal).val()) === 0) causas.push('valor en 0');
        warns.push(label + ' NO quedó confirmado tras 3 intentos (' + (causas.join(', ') || 'desconocido') + '). Revisa antes de guardar el acuse.');
        return false;
    }

    async function llenar(texto, p) {
        if ($('#ShowbtonsGuardar').is(':visible')) {
            toast(['Estás en la pantalla de confirmación.', 'Pulsa "Regresar" y vuelve a pegar el bloque.']);
            return;
        }

        var tableAT;
        try { tableAT = $('#idtblVentasEntidad').DataTable(); } catch (err) { tableAT = null; }
        if (!tableAT) {
            toast(['La tabla de ventas aún no está lista.', 'Recarga la página y vuelve a intentarlo.']);
            return;
        }
        if (tableAT.rows().count() === 0) {
            toast(['La lista de ventas todavía se está cargando.', 'Espera unos segundos y vuelve a pegar el bloque.']);
            return;
        }

        var msgs = [];
        var warns = [];
        var fechaActual = $('#idFechaVenta').val().trim();
        var col = elegirColumna(p.fechas, fechaActual);
        var fecha = p.fechas[col] || null;

        if (fecha) {
            if (fechaActual === '') {
                $('#idFechaVenta').val(fecha).trigger('change');
                msgs.push('Fecha de venta: ' + fecha);
            } else if (norm(fechaActual) !== norm(fecha)) {
                warns.push('La fecha de la página (' + fechaActual + ') no coincide con la del bloque (' + fecha + ').');
            } else {
                msgs.push('Fecha de venta: ' + fecha);
            }
        } else {
            warns.push('No se detectó fecha en el bloque; no se modificó la fecha de venta.');
        }

        if (p.autoconsumo && p.autoconsumo.length) {
            var ac = p.autoconsumo.length > col ? p.autoconsumo[col] : p.autoconsumo[0];
            var acTxt = String(ac);
            if ($('#idAutoConsumo').val() !== acTxt) {
                $('#idAutoConsumo').val(acTxt);
                msgs.push('Autoconsumo: ' + acTxt + ' kg');
            }
        } else {
            warns.push('No se detectó autoconsumo en el bloque.');
        }

        var diaSinVenta = false;
        if (p.totalLitros && p.totalLitros.length && p.totalLitros.every(function (x) { return x === 0; })) {
            diaSinVenta = true;
            for (var bi = 0; bi < p.bloques.length && bi < 4; bi++) {
                var secb = p.bloques[bi];
                for (var li = 0; li < secb.lineas.length; li++) {
                    var lnv = valoresDeLinea(secb.lineas[li].nums, col);
                    if (lnv && lnv.vol !== 0) { diaSinVenta = false; break; }
                }
                if (!diaSinVenta) break;
            }
        }

        var filasLlenadas = 0;
        var sumVol = 0;
        var sumImp = 0;
        var globalIdx = 0;

        if (diaSinVenta) {
            var fechaConfirmarDia = fecha || fechaActual || '(fecha no detectada)';
            var confirmadoDia = confirmarSinVenta(
                'El bloque pegado indica que el día ' + fechaConfirmarDia + ' no tuvo NINGUNA venta ' +
                '(todos los valores están en blanco o en cero).\n\n' +
                '¿Confirmas que ese día realmente no hubo venta?\n\n' +
                'Aceptar = marcar "Sin venta" en Auto-tanque y Recipientes.\n' +
                'Cancelar = no hacer ningún cambio (podrás revisarlo y llenarlo a mano).'
            );
            if (confirmadoDia) {
                if (!$('#sinventaautotanquechk').is(':checked')) {
                    $('#sinventaautotanquechk').prop('checked', true).trigger('change');
                }
                if (!$('#sinventarecipientechk').is(':checked')) {
                    $('#sinventarecipientechk').prop('checked', true).trigger('change');
                }
                msgs.push('Día sin ventas: marcado "Sin venta" en Auto-tanque y Recipientes (confirmado).');
            } else {
                msgs.push('Día sin ventas detectado pero NO confirmado: no se modificó nada. Revísalo manualmente.');
            }
            var finalMsgsDia = msgs.slice();
            for (var wd = 0; wd < warns.length; wd++) finalMsgsDia.push('Advertencia: ' + warns[wd]);
            toast(finalMsgsDia);
            return;
        } else {
            for (var b = 0; b < p.bloques.length && b < 4; b++) {
                var sec = p.bloques[b];
                for (var l = 0; l < sec.lineas.length && globalIdx < ORDEN_FIJO.length; l++) {
                    var linea = sec.lineas[l];
                    var vals = valoresDeLinea(linea.nums, col);
                    if (!vals) continue;
                    var estado = sec.nombre || ORDEN_FIJO[globalIdx][0];
                    var municipio = sec.municipio || ORDEN_FIJO[globalIdx][1];
                    var sector = sectorDesdeCelda(linea.celdas) || ORDEN_FIJO[globalIdx][2];
                    var fila = buscarFilaAT(estado, municipio, sector);
                    if (!fila) {
                        warns.push('No se encontró la fila precargada para ' + estado + ' / ' + municipio + ' / ' + sector);
                        globalIdx++;
                        continue;
                    }
                    var labelAT = estado + ' / ' + municipio + ' / ' + sector;
                    await escribirYVerificarFila(fila, 'Volumen-' + fila.idVenta, 'ValorVenta-' + fila.idVenta, 'volumen', 'valorVenta', vals.vol, vals.imp, msgs, warns, labelAT);
                    sumVol += vals.vol;
                    sumImp += vals.imp;
                    filasLlenadas++;
                    globalIdx++;
                }
            }

            if (filasLlenadas) {
                try { ObtieneTotalesRegistroVentaDDAC(); } catch (err) {}
                msgs.push('Auto-tanque: ' + filasLlenadas + ' filas llenadas');
            } else {
                warns.push('No se llenó ninguna fila de Auto-tanque.');
            }

            if (p.totalLitros && p.totalLitros.length) {
                var tl = p.totalLitros.length > col ? p.totalLitros[col] : p.totalLitros[0];
                if (Math.abs(tl - sumVol) > 2) {
                    warns.push('Suma de volúmenes (' + sumVol + ') difiere del total del bloque (' + tl + ').');
                }
            }
            if (p.filaTotal && p.filaTotal.length === 2) {
                if (Math.abs(p.filaTotal[1] - sumImp) > 0.01) {
                    warns.push('Suma de importes ($' + sumImp.toFixed(2) + ') difiere del total del bloque ($' + p.filaTotal[1].toFixed(2) + ').');
                }
            }
        }

        var tableRec;
        try { tableRec = $('#idtblVentasRecipientes').DataTable(); } catch (err) { tableRec = null; }
        var lineasRec = p.recipientes.lineas;
        if (tableRec && lineasRec.length) {
            var hayDatos = false;
            for (var r = 0; r < lineasRec.length; r++) {
                if (lineasRec[r].nums && lineasRec[r].nums.length) hayDatos = true;
            }
            if (hayDatos) {
                var filasRec = [];
                tableRec.rows().every(function () { filasRec.push(this.data()); });
                var llenadasRec = 0;
                var ci = 0;
                for (var r2 = 0; r2 < lineasRec.length && ci < filasRec.length; r2++) {
                    var ln = lineasRec[r2];
                    if (!ln.nums || !ln.nums.length) continue;
                    var v = valoresDeLinea(ln.nums, col);
                    if (!v) continue;
                    var filaRec = filasRec[ci];
                    var labelRec = 'Recipiente fila ' + (ci + 1);
                    await escribirYVerificarFila(filaRec, 'CantidadVendida-' + filaRec.idVenta, 'ValorVenta-' + filaRec.idVenta, 'cantidadVendida', 'valorVenta', v.vol, v.imp, msgs, warns, labelRec);
                    ci++;
                    llenadasRec++;
                }
                if (llenadasRec) {
                    try { ObtieneTotalesRegistroVentaRecipientes(); } catch (err) {}
                    if ($('#sinventarecipientechk').is(':checked')) {
                        $('#sinventarecipientechk').prop('checked', false).trigger('change');
                    }
                    msgs.push('Recipientes: ' + llenadasRec + ' fila(s) llenadas');
                }
            } else {
                var fechaConfirmarRec = fecha || fechaActual || '(fecha no detectada)';
                var confirmadoRec = confirmarSinVenta(
                    'El bloque de Recipientes para el día ' + fechaConfirmarRec + ' no trae valores de venta ' +
                    '(aparece "-" o en blanco).\n\n' +
                    '¿Confirmas que Recipientes realmente no tuvo venta ese día?\n\n' +
                    'Aceptar = marcar "Sin venta" en Recipientes.\n' +
                    'Cancelar = no hacer ningún cambio en Recipientes.'
                );
                if (confirmadoRec) {
                    if (!$('#sinventarecipientechk').is(':checked')) {
                        $('#sinventarecipientechk').prop('checked', true).trigger('change');
                        msgs.push('Recipientes: marcado "Sin venta" (confirmado).');
                    }
                } else {
                    msgs.push('Recipientes sin datos detectado pero NO confirmado: no se modificó nada en Recipientes.');
                }
            }
        }

        var finalMsgs = msgs.slice();
        for (var w = 0; w < warns.length; w++) finalMsgs.push('Advertencia: ' + warns[w]);
        toast(finalMsgs);
    }

    function celdaValorES(c) {
        if (!c) return false;
        return esNumero(c) || esDash(c);
    }

    function parsearES(texto) {
        var lineas = texto.split(/\r?\n/);
        var res = { fechas: [], ventas: [] };
        for (var i = 0; i < lineas.length; i++) {
            var c = cells(lineas[i]);
            var noVacias = c.filter(function (x) { return x !== ''; });
            for (var k = 0; k < c.length; k++) {
                var f = fechaDe(c[k]);
                if (f) res.fechas.push(f);
            }
            if (!noVacias.length) continue;
            var primer = noVacias[0].toUpperCase();
            if (primer.indexOf('VENTA LITROS') === 0) {
                var seq = c.filter(celdaValorES);
                var cols = [];
                for (var j = 0; j + 2 < seq.length; j += 3) {
                    cols.push({ vol: seq[j], precio: seq[j + 1], imp: seq[j + 2] });
                }
                res.ventas = cols;
            }
        }
        return res;
    }

    function sleep(ms) {
        return new Promise(function (resolve) { setTimeout(resolve, ms); });
    }

    // Centraliza el criterio de "sin venta" para un día de la página ES,
    // para que la detección, el pintado y el registro usen siempre la misma lógica.
    function esSinVentaColES(colVenta) {
        return esDash(colVenta.vol) || aNumero(colVenta.vol) === 0;
    }

    function pintarEstadoDia(fecha, colVenta) {
        $('#idFechaVenta').val(fecha);
        var esSinVenta = esSinVentaColES(colVenta);
        if (esSinVenta) {
            if (!$('#sinventachk').is(':checked')) {
                $('#sinventachk').prop('checked', true).trigger('change');
            }
            $('#idVolumenVehiculo').val('');
            $('#idVentasVehiculo').val('');
        } else {
            if ($('#sinventachk').is(':checked')) {
                $('#sinventachk').prop('checked', false).trigger('change');
            }
            pintarInput('idVolumenVehiculo', aNumero(colVenta.vol));
            pintarInput('idVentasVehiculo', aNumero(colVenta.imp));
        }
        if ($('#idAutoConsumo').val() !== '0') {
            $('#idAutoConsumo').val('0');
        }
    }

    function fechaYaRegistrada(fecha) {
        return new Promise(function (resolve) {
            $.ajax({
                url: '/GasLP/Ventas/GetValidaFechaVenta',
                type: 'POST',
                dataType: 'json',
                data: { strFechaVenta: fecha },
                success: function (d) {
                    resolve(!(d.result === true && d.mensaje === '0'));
                },
                error: function () {
                    resolve(false);
                }
            });
        });
    }

    function registrarDiaES(fecha, colVenta) {
        return new Promise(function (resolve) {
            var esSinVenta = esSinVentaColES(colVenta);
            var fechaRegCompra = moment(fecha, 'DD/MM/YYYY').format('YYYY-MM-DD');
            if (esSinVenta) {
                var cadenaCero = '|Fecha de Registro=' + $('#idFechaRegistro').val() +
                    '|Fecha de Venta=' + fecha + '|Sin venta';
                $.ajax({
                    url: '/GasLP/Ventas/GuardaCeroVentas',
                    type: 'POST',
                    dataType: 'json',
                    data: { fechaRegCompra: fechaRegCompra, TipoVenta: 0, cadenaAcuse: cadenaCero },
                    success: function (d) {
                        resolve(d.result === true ? 'sin venta registrado' : 'ERROR: ' + (d.mensaje || 'respuesta inválida'));
                    },
                    error: function (xhr) {
                        resolve(xhr.status === 401 ? 'ERROR: sesión expirada' : 'ERROR: fallo de red');
                    }
                });
                return;
            }
            var vol = aNumero(colVenta.vol);
            var imp = aNumero(colVenta.imp);
            var volTxt = formatNumber.new(vol, '');
            var impTxt = formatNumber.new(imp, '');
            var cadenaVenta = '|Fecha de Registro=' + $('#idFechaRegistro').val() +
                '|Fecha de Venta=' + fecha +
                '|Gas LP utilizado para consumos propios=0' +
                '|Volumen Vendido a Vehiculo=' + volTxt +
                '|Valor de las Ventas a Vehiculos=' + impTxt;
            $.ajax({
                url: '/GasLP/Ventas/GuardaVentaEstacionServicio',
                type: 'POST',
                dataType: 'json',
                data: {
                    fechaVenta: SetFormatFechaHora(fecha),
                    fechaRegistro: GetFechaHoraBrowser(1),
                    volumenV: volTxt,
                    valorVentaV: impTxt,
                    volumenR: '',
                    valorVentaR: '',
                    cantidadAutoConsumo: 0,
                    cadenaAcuse: cadenaVenta
                },
                success: function (d) {
                    resolve(d.success === true ? volTxt + ' l / $' + impTxt + ' registrado' : 'ERROR: ' + (d.mensaje || 'respuesta inválida'));
                },
                error: function (xhr) {
                    resolve(xhr.status === 401 ? 'ERROR: sesión expirada' : 'ERROR: fallo de red');
                }
            });
        });
    }

    async function fillES(texto, p) {
        if ($('#ShowbtonsGuardar').is(':visible')) {
            toast(['Estás en la pantalla de confirmación.', 'Pulsa "Regresar" y vuelve a pegar el bloque.']);
            return;
        }
        var total = Math.min(p.fechas.length, p.ventas.length);
        if (total === 0) {
            toast(['No se encontraron días en el bloque.']);
            return;
        }
        var resultados = [];
        for (var i = 0; i < total; i++) {
            var fecha = p.fechas[i];
            var colVenta = p.ventas[i];

            var yaRegistrada = await fechaYaRegistrada(fecha);
            if (yaRegistrada) {
                resultados.push(fecha + ': ya registrada, se omite');
                continue;
            }

            if (esSinVentaColES(colVenta)) {
                var confirmadoDiaES = confirmarSinVenta(
                    'El día ' + fecha + ' aparece SIN VENTA en el bloque (en blanco o "-").\n\n' +
                    '¿Confirmas que ese día realmente no hubo venta?\n\n' +
                    'Aceptar = registrar ese día como "Sin venta".\n' +
                    'Cancelar = omitir este día (no se registrará nada; podrás capturarlo tú mismo).'
                );
                if (!confirmadoDiaES) {
                    resultados.push(fecha + ': omitido, "sin venta" NO confirmado por el usuario');
                    continue;
                }
            }

            toast(['Registrando día ' + (i + 1) + ' de ' + total + ': ' + fecha + '...']);
            pintarEstadoDia(fecha, colVenta);
            var resultado = await registrarDiaES(fecha, colVenta);
            resultados.push(fecha + ': ' + resultado);
            await sleep(800);
        }
        toast(['Registro completado.']);
        alert('Resumen de registro (Estación de Servicio):\n\n' + resultados.join('\n') + '\n\nLa página se recargará.');
        location.reload();
    }

    document.addEventListener('paste', function (e) {
        var cd = e.clipboardData || window.clipboardData;
        var texto = cd ? cd.getData('text/plain') : '';
        if (!texto || texto.indexOf('\t') < 0) return;

        if (esPaginaDisPla) {
            var p = parsear(texto);
            var lineasVenta = 0;
            p.bloques.forEach(function (b) { lineasVenta += b.lineas.length; });
            if (!p.fechas.length || lineasVenta < 4) return;
            e.preventDefault();
            e.stopPropagation();
            llenar(texto, p);
            return;
        }

        if (esPaginaES) {
            var pe = parsearES(texto);
            if (pe.fechas.length < 5 || pe.ventas.length < 7) return;
            e.preventDefault();
            e.stopPropagation();
            fillES(texto, pe);
        }
    });
})();