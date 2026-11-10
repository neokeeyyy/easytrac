/* EasyTrac VENTA
   Auto-fill of the sales registration forms. */
(function () {
  'use strict';
  var ET = globalThis.EasyTrac;

    var RE_FECHA = /^(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo),\s*(\d{1,2})\s+de\s+([a-záéíóúñü]+)\s+de\s+(\d{4})$/i;
    var MESES = { enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12 };
    var SECTORES = { comercial: 'Comercial y Servicio', 'comercial y servicio': 'Comercial y Servicio', residencial: 'Residencial' };
    // Sin jQuery no hay página: las funciones puras se prueban en Node y se
    // exportan aquí porque el archivo retorna antes de montar la UI.
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            norm: norm,
            parsear: parsear,
            parsearEstaciones: parsearEstaciones,
            parsearES: parsearES,
            esSemanaES: esSemanaES,
            parsearReporte: parsearReporte,
            colaDeEstaciones: colaDeEstaciones,
            elegirColumna: elegirColumna,
            sectorDesdeCelda: sectorDesdeCelda,
            valoresDeLinea: valoresDeLinea,
            resolverFilas: resolverFilas,
            xlsxTexto: xlsxTexto,
            xlsxHojaATexto: xlsxHojaATexto,
            rutaHojaReporte: rutaHojaReporte
        };
        return;
    }

    if (typeof jQuery === 'undefined' || typeof $ === 'undefined') return;

    var esPaginaDisPla = $('#idtblVentasEntidad').length > 0;
    var esPaginaES = !esPaginaDisPla && $('#idVolumenVehiculo').length > 0;
    if (!esPaginaDisPla && !esPaginaES) return;

    var paneVenta = ET.ui.tab('venta', 'Venta', 40, 300);
    paneVenta.innerHTML =
        '<div style="font-weight: 400;margin-bottom:6px">Auto-fill de ventas</div>' +
        '<div style="font-size:12px;line-height:1.45;color:#333">Copia el bloque de ventas de tu Excel y p\u00E9galo (Ctrl+V) en esta p\u00E1gina. ' +
        'El script llena fecha, autoconsumo y las filas de Auto-tanque y Recipientes, y verifica cada campo. ' +
        'Si pegas el REPORTE completo, aparece la lista de estaciones para subirlas una por una.<br><br>' +
        'Tipo de p\u00E1gina: <b>' + (esPaginaDisPla ? 'Distribuidor por Planta' : 'Estaci\u00F3n de Servicio') + '</b></div>' +
        '<div id="siretrac-venta-drop" style="margin-bottom:8px;padding:14px 10px;text-align:center;' +
        'border:2px dashed var(--ui-border-strong);border-radius:0;background:var(--ui-bg);' +
        'font:400 12px/1.4 var(--ui-font);color:var(--ui-muted)">' +
        'Arrastra aquí el REPORTE (.xlsm) o pégalo con Ctrl+V</div>' +
        '<div id="siretrac-venta-estaciones"></div>' +
        '<div id="siretrac-venta-cola"></div>';

    // Última pega del REPORTE: la usa el botón de la tabla de estaciones.
    var estacionesPegadas = [];
    var fechasPegadas = [];
    var colaDetenida = false;

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
        var res = { fechas: [], totalLitros: null, autoconsumo: null, bloques: [], filaTotal: null, totalImportes: null, recipientes: { lineas: [] } };
        var fase = 'totales';
        var seccion = null;
        var nBloques = 0;
        for (var i = 0; i < lineas.length; i++) {
            var c = cells(lineas[i]);
            var noVacias = c.filter(function (x) { return x !== ''; });
            for (var k = 0; k < c.length; k++) {
                var f = fechaDe(c[k]);
                if (f && res.fechas.indexOf(f) === -1) res.fechas.push(f);
            }
            var esCab = c.some(function (x) { return norm(x) === 'volumen'; });
            // La cabecera de la matriz municipal nombra MUNICIPIO; la de recipientes no.
            var esCabMunicipio = esCab && c.some(function (x) { return norm(x) === 'municipio'; });
            // La cabecera de recipientes nombra RECIPIENTES/CILINDRERAS; sin esas
            // palabras, una cabecera VOLUMEN abre otro bloque (formato vertical).
            var esCabRecipientes = esCab && c.some(function (x) { return /RECIPIENTE|CILINDRERA|TRANSPORTABLE/.test(norm(x)); });
            var nums = c.filter(esNumero);
            var hayDash = c.some(esDash);
            // Las celdas «$-» del domingo cuentan como 0 para no perder la fila entera.
            var numsDash = c.filter(celdaValorES).map(aNumero);
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
                if (esCab && esCabMunicipio) {
                    seccion = { nombre: null, municipio: null, lineas: [] };
                    res.bloques.push(seccion);
                    nBloques++;
                    continue;
                }
                if (esCab && esCabRecipientes) { fase = 'recipientes'; continue; }
                if (esCab) {
                    seccion = { nombre: null, municipio: null, lineas: [] };
                    res.bloques.push(seccion);
                    nBloques++;
                    continue;
                }
                if (nBloques >= 1 && norm(c[0]).indexOf('total') === 0) {
                    if (numsDash.length === 2) {
                        res.filaTotal = numsDash;
                    } else {
                        var dias = res.totalLitros ? res.totalLitros.length : res.fechas.length;
                        if (dias && numsDash.length === dias * 2) {
                            if (!res.totalLitros) res.totalLitros = numsDash.slice(0, dias);
                            res.totalImportes = numsDash.slice(dias);
                        } else if (dias && numsDash.length === dias && !res.totalLitros) {
                            res.totalLitros = numsDash;
                        }
                    }
                    fase = 'recipientes'; continue;
                }
                if (numsDash.length === 2 && nBloques >= 1) {
                    var sumaVol = 0, sumaImp = 0;
                    for (var bi = 0; bi < res.bloques.length; bi++) {
                        var ls = res.bloques[bi].lineas || [];
                        for (var li = 0; li < ls.length; li++) {
                            var ln = ls[li].nums;
                            if (!ls[li].cero && ln && ln.length === 3) {
                                sumaVol += ln[0];
                                sumaImp += ln[2];
                            }
                        }
                    }
                    // Formato vertical: el total final no trae la palabra TOTAL;
                    // se reconoce porque cuadra con la suma de las filas del bloque.
                    if (Math.abs(numsDash[0] - sumaVol) <= 2 && Math.abs(numsDash[1] - sumaImp) <= 0.05) {
                        res.filaTotal = numsDash;
                        fase = 'recipientes';
                        continue;
                    }
                    continue;
                }
                if (nums.length === 2) continue;
                if (numsDash.length >= 3 && numsDash.length % 3 === 0) {
                    if (!seccion.primera && c[0] !== '') seccion.primera = c[0];
                    // Nombre de la estación por forma: la primera celda de texto de la
                    // sección es el municipio. Sirve cualquier entidad, sin lista fija.
                    if (!seccion.nombre && c[0] !== '' && !esNumero(c[0])) {
                        seccion.nombre = c[0];
                        seccion.municipio = c[1] || '';
                    }
                    seccion.lineas.push({ celdas: c, nums: numsDash });
                    continue;
                }
                if (hayDash) {
                    seccion.lineas.push({ celdas: c, nums: [0, 0, 0], cero: true });
                    continue;
                }
                continue;
            }
            if (!noVacias.length || esCab) continue;
            // El REPORTE completo sigue con los bloques de estación: no son recipientes.
            var primeraRec = norm(noVacias[0]);
            if (primeraRec.indexOf('cap.') === 0 || primeraRec.indexOf('tipo de permiso') === 0 ||
                primeraRec.indexOf('sucursal') === 0 || primeraRec.indexOf('venta litros') === 0 ||
                primeraRec.indexOf('entrada por traspaso') === 0) break;
            if (nums.length >= 3 && nums.length % 3 === 0) {
                res.recipientes.lineas.push({ celdas: c, nums: nums.map(aNumero) });
            } else if (hayDash) {
                res.recipientes.lineas.push({ sinVenta: true });
            }
        }
        return res;
    }

    // --- REPORTE completo: un bloque por estación ---------------------------
    // Cada estación trae 3-4 filas de metadatos (CAP, TIPO DE PERMISO, N° DE
    // PERMISO, SUCURSAL), la fila del nombre y VENTA LITROS, seguida de
    // ENTRADA POR TRASPASO KILOS. Se tolera que falte alguna fila.
    function esNombreEstacion(v) {
        if (!v || esNumero(v) || esDash(v)) return false;
        var n = norm(v);
        if (/^lp\//.test(n) || /^\d{4,6}$/.test(v)) return false;
        if (n.indexOf('estacion de servi') === 0 || n.indexOf('estacion de distribu') === 0) return false;
        if (n.indexOf('cap.') === 0 || n.indexOf('tipo de permiso') === 0) return false;
        if (n.indexOf('de permiso') >= 0 || n.indexOf('sucursal') === 0) return false;
        if (n === 'volumen' || n === 'precio' || n === 'importe') return false;
        if (n.indexOf('entrada por traspaso') === 0 || n.indexOf('venta litros') === 0) return false;
        if (n.indexOf('sin fecha') === 0) return false;
        return true;
    }

    function nombreEstacion(filas) {
        var i, j, k;
        // El nombre suele ser la celda "ESTACION ..." más cercana al bloque.
        for (i = filas.length - 1; i >= 0; i--) {
            for (j = 0; j < filas[i].length; j++) {
                if (esNombreEstacion(filas[i][j]) && /^estacion/i.test(norm(filas[i][j]))) return filas[i][j];
            }
        }
        // Respaldo: el valor que sigue a la etiqueta SUCURSAL.
        for (i = 0; i < filas.length; i++) {
            for (j = 0; j < filas[i].length; j++) {
                if (norm(filas[i][j]).indexOf('sucursal') !== 0) continue;
                for (k = j + 1; k < filas[i].length; k++) {
                    if (filas[i][k] !== '') return esNombreEstacion(filas[i][k]) ? filas[i][k] : '';
                }
            }
        }
        // Último respaldo: cualquier texto que no sea etiqueta ni número.
        for (i = filas.length - 1; i >= 0; i--) {
            for (j = 0; j < filas[i].length; j++) {
                if (esNombreEstacion(filas[i][j])) return filas[i][j];
            }
        }
        return '';
    }

    function permisoDeEstacion(filas) {
        var i, j;
        for (i = filas.length - 1; i >= 0; i--) {
            for (j = 0; j < filas[i].length; j++) {
                var m = /(LP\/[A-Za-z0-9]+(?:\/[A-Za-z0-9]+)*)/i.exec(filas[i][j]);
                if (m) return m[1];
            }
        }
        // Respaldo: número de permiso de 4-6 dígitos. La celda debe ser sólo
        // el número para no confundirlo con textos como "4,913 LTS.".
        for (i = filas.length - 1; i >= 0; i--) {
            for (j = 0; j < filas[i].length; j++) {
                if (/^\d{4,6}$/.test(filas[i][j])) return filas[i][j];
            }
        }
        return '';
    }

    function valorTrasEtiqueta(celdas, etiqueta) {
        for (var i = 0; i < celdas.length; i++) {
            if (norm(celdas[i]).indexOf(etiqueta) !== 0) continue;
            for (var j = i + 1; j < celdas.length; j++) {
                if (celdas[j] !== '') return celdas[j];
            }
        }
        return '';
    }

    function tipoDeEstacion(filas) {
        var i, j;
        for (i = filas.length - 1; i >= 0; i--) {
            var v = valorTrasEtiqueta(filas[i], 'tipo de permiso');
            if (v) return v;
        }
        for (i = filas.length - 1; i >= 0; i--) {
            for (j = filas[i].length - 1; j >= 0; j--) {
                var n = norm(filas[i][j]);
                if (n.indexOf('estacion de servi') === 0 || n.indexOf('estacion de distribu') === 0 || n.indexOf('planta') === 0) {
                    return filas[i][j];
                }
            }
        }
        return '';
    }

    function sucursalDeEstacion(filas) {
        for (var i = filas.length - 1; i >= 0; i--) {
            var v = valorTrasEtiqueta(filas[i], 'sucursal');
            if (v) return v;
        }
        return '';
    }

    function ventasDeEstacion(celdas) {
        var vals = celdas.slice(1).filter(celdaValorES);
        var res = [];
        for (var i = 0; i + 2 < vals.length && res.length < 7; i += 3) {
            res.push({ vol: vals[i], precio: vals[i + 1], imp: vals[i + 2] });
        }
        return res;
    }

    function traspasosDeEstacion(celdas) {
        return celdas.slice(1).filter(esNumero).map(aNumero).slice(0, 7);
    }

    function parsearEstaciones(texto) {
        var lineas = texto.split(/\r?\n/);
        var res = [];
        var previas = [];
        for (var i = 0; i < lineas.length; i++) {
            var c = cells(lineas[i]);
            var noVacias = c.filter(function (x) { return x !== ''; });
            if (!noVacias.length) continue;
            var primer = norm(noVacias[0]);
            if (primer.indexOf('venta litros') === 0) {
                var meta = previas.slice(-3);
                var recientes = previas.slice(-4);
                res.push({
                    nombre: nombreEstacion(meta),
                    permiso: permisoDeEstacion(recientes),
                    tipo: tipoDeEstacion(recientes),
                    sucursal: sucursalDeEstacion(meta),
                    ventas: ventasDeEstacion(c),
                    traspasos: []
                });
                continue;
            }
            if (primer.indexOf('entrada por traspaso') === 0) {
                if (res.length) res[res.length - 1].traspasos = traspasosDeEstacion(c);
                continue;
            }
            previas.push(c);
            if (previas.length > 6) previas.shift();
        }
        return res;
    }

    function parsearReporte(texto) {
        return { municipios: parsear(texto), estaciones: parsearEstaciones(texto) };
    }

    // --- REPORTE como archivo Excel -------------------------------------------
    // La hoja REPORTE se convierte a TSV para reutilizar el mismo camino que el
    // pegado. El XML se procesa aquí, sin DOM, para poder probarlo en Node.

    function xmlTexto(s) {
        var mapa = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
        return (s || '').replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, function (m, c) {
            if (c.charAt(0) === '#') {
                var n = c.charAt(1).toLowerCase() === 'x'
                    ? parseInt(c.slice(2), 16)
                    : parseInt(c.slice(1), 10);
                return isNaN(n) ? m : String.fromCharCode(n);
            }
            return mapa[c.toLowerCase()] || m;
        });
    }

    function textosDe(xml) {
        var ts = xml.match(/<t\b[^>]*>([\s\S]*?)<\/t>/g) || [];
        var txt = '';
        for (var i = 0; i < ts.length; i++) {
            txt += xmlTexto(ts[i].replace(/^<t\b[^>]*>/, '').replace(/<\/t>$/, ''));
        }
        return txt;
    }

    function columnaDeRef(ref) {
        var m = /^([A-Z]+)/i.exec(ref || '');
        if (!m) return 0;
        var letras = m[1].toUpperCase();
        var n = 0;
        for (var i = 0; i < letras.length; i++) n = n * 26 + (letras.charCodeAt(i) - 64);
        return n - 1;
    }

    function resolverRutaHoja(target) {
        var t = target.charAt(0) === '/' ? target.slice(1) : 'xl/' + target;
        var partes = [];
        t.split('/').forEach(function (p) {
            if (!p || p === '.') return;
            if (p === '..') partes.pop();
            else partes.push(p);
        });
        return partes.join('/');
    }

    // workbook.xml + workbook.xml.rels -> ruta de la hoja REPORTE.
    function rutaHojaReporte(workbookXml, relsXml) {
        var hojas = (workbookXml || '').match(/<sheet\b[^>]*\/?>/g) || [];
        var rid = null;
        for (var i = 0; i < hojas.length; i++) {
            var nombre = /name="([^"]*)"/i.exec(hojas[i]);
            var id = /r:id="([^"]*)"/i.exec(hojas[i]);
            if (nombre && id && xmlTexto(nombre[1]).trim().toUpperCase() === 'REPORTE') {
                rid = id[1];
                break;
            }
        }
        if (rid) {
            var rels = (relsXml || '').match(/<Relationship\b[^>]*\/?>/g) || [];
            for (var j = 0; j < rels.length; j++) {
                var relId = /Id="([^"]*)"/i.exec(rels[j]);
                var target = /Target="([^"]*)"/i.exec(rels[j]);
                if (relId && target && relId[1] === rid) return resolverRutaHoja(xmlTexto(target[1]));
            }
        }
        throw new Error('El archivo no tiene una hoja REPORTE');
    }

    function xlsxHojaATexto(datos) {
        var sheetXml = (datos && datos.sheetXml) || '';
        var sharedXml = (datos && datos.sharedStringsXml) || '';

        var compartidas = [];
        var sis = sharedXml.match(/<si\b[^>]*>[\s\S]*?<\/si>/g) || [];
        for (var i = 0; i < sis.length; i++) {
            // <rPh> son lecturas fonéticas: no forman parte del valor de la celda.
            compartidas.push(textosDe(sis[i].replace(/<rPh\b[\s\S]*?<\/rPh>/g, '')));
        }

        var filas = [];
        var maxFila = -1;
        var maxCol = -1;
        var filasXml = sheetXml.match(/<row\b[^>]*>[\s\S]*?<\/row>|<row\b[^>]*\/>/g) || [];
        for (var f = 0; f < filasXml.length; f++) {
            var fila = filasXml[f];
            var rn = /\br="(\d+)"/.exec(fila);
            var nFila = rn ? parseInt(rn[1], 10) - 1 : f;
            var celdas = fila.match(/<c\b[^>]*\/>|<c\b[^>]*>[\s\S]*?<\/c>/g) || [];
            for (var c = 0; c < celdas.length; c++) {
                var celda = celdas[c];
                var ref = /\br="([A-Za-z]+\d+)"/.exec(celda);
                var col = ref ? columnaDeRef(ref[1]) : c;
                var tipo = /\bt="([^"]*)"/.exec(celda);
                var valor = '';
                if (tipo && tipo[1] === 'inlineStr') {
                    valor = textosDe(celda);
                } else {
                    var v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(celda);
                    if (v) {
                        valor = xmlTexto(v[1]);
                        if (tipo && tipo[1] === 's') valor = compartidas[parseInt(valor, 10)] || '';
                    }
                }
                if (!filas[nFila]) filas[nFila] = [];
                filas[nFila][col] = valor;
                if (valor !== '') {
                    if (nFila > maxFila) maxFila = nFila;
                    if (col > maxCol) maxCol = col;
                }
            }
        }

        var lineas = [];
        for (var k = 0; k <= maxFila; k++) {
            var celdasFila = filas[k] || [];
            var linea = [];
            for (var m = 0; m <= maxCol; m++) linea.push(celdasFila[m] == null ? '' : celdasFila[m]);
            while (linea.length && linea[linea.length - 1] === '') linea.pop();
            lineas.push(linea.join('\t'));
        }
        return lineas.join('\n');
    }

    async function xlsxTexto(buffer) {
        if (typeof JSZip === 'undefined') throw new Error('JSZip no está disponible');
        var zip = await JSZip.loadAsync(buffer);
        function leer(ruta) {
            var f = zip.file(ruta);
            return f ? f.async('string') : Promise.resolve('');
        }
        var ruta = rutaHojaReporte(await leer('xl/workbook.xml'), await leer('xl/_rels/workbook.xml.rels'));
        var sheetXml = await leer(ruta);
        if (!sheetXml) throw new Error('El archivo no tiene una hoja REPORTE');
        return xlsxHojaATexto({
            sheetXml: sheetXml,
            sharedStringsXml: await leer('xl/sharedStrings.xml')
        });
    }

    function colaDeEstaciones(estaciones, fechas) {
        var semana = (fechas || []).slice(0, 7);
        var cola = [];
        for (var i = 0; i < (estaciones || []).length; i++) {
            var e = estaciones[i];
            if (!e || !e.permiso) continue;
            cola.push({
                permiso: e.permiso,
                nombre: e.nombre,
                fechas: semana.slice(),
                ventas: (e.ventas || []).slice(0, 7)
            });
        }
        return cola;
    }

    function elegirColumna(fechas, fechaActual) {
        if (!fechas.length) return 0;
        if (fechaActual) {
            for (var i = 0; i < fechas.length; i++) {
                if (norm(fechas[i]) === norm(fechaActual)) return i;
            }
            return -1;
        }
        return fechas.length - 1;
    }

    function valoresDeLinea(nums, col) {
        // Un bloque semanal trae 3 columnas por día: se elige la del día que se registra.
        // Con 3 números y una columna > 0 no hay forma de saber de qué día son.
        if (nums.length === 3 && col > 0) return null;
        var c = nums.length === 3 ? 0 : (col || 0);
        if (nums.length < 3 || nums.length % 3 !== 0 || c * 3 + 2 >= nums.length) return null;
        return { vol: nums[c * 3], imp: nums[c * 3 + 2] };
    }

    function toast(mensajes) {
        var prev = document.getElementById('siretrac-toast');
        if (prev) prev.remove();
        var d = document.createElement('div');
        d.id = 'siretrac-toast';
        d.style.cssText = 'position:fixed;top:10px;right:calc(var(--shub-w,0px) + 20px);z-index:2147483647;background:var(--ui-fg);color:var(--ui-bg);padding:12px 16px;border:1px solid var(--ui-header-hover);border-radius:0;font:400 13px/1.6 var(--ui-font);max-width:400px;';
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

    // Compara una fila de la tabla con los datos del bloque; solo compara
    // los campos que el bloque trae (nombre/municipio/sector pueden faltar).
    function filaCoincide(fila, estado, municipio, sector) {
        if (estado && norm(fila.entidadFederativa) !== norm(estado)) return false;
        if (municipio && norm(fila.municipio) !== norm(municipio)) return false;
        if (sector) {
            var canon = SECTORES[norm(sector)] || sector;
            if (norm(fila.sector) !== norm(canon)) return false;
        }
        return true;
    }

    // Resuelve las líneas del bloque pegado contra las filas reales de la
    // tabla de Auto-tanque: por nombre/municipio/sector cuando el bloque los
    // trae y, si no, por posición (siguiente fila libre). Sin tope de filas.
    function resolverFilas(bloques, filas, col) {
        var lista = filas || [];
        var usadas = [];
        var warns = [];
        var asignaciones = [];
        /* Estados que existen en la tabla de esta empresa: así la lista ESTADOS
           solo actúa de pista y sirve cualquier entidad federativa. */
        var entidades = {};
        for (var e = 0; e < lista.length; e++) {
            var ent = lista[e].entidadFederativa;
            if (ent) entidades[norm(ent)] = ent;
        }
        for (var b = 0; b < (bloques || []).length; b++) {
            var sec = bloques[b] || {};
            var lineas = sec.lineas || [];
            for (var l = 0; l < lineas.length; l++) {
                var linea = lineas[l];
                var vals = valoresDeLinea(linea.nums || [], col || 0);
                if (!vals) {
                    if ((linea.nums || []).length === 3 && col > 0) {
                        warns.push('Una fila trae los valores de un solo día y no se sabe a cuál corresponde; no se escribió.');
                    }
                    continue;
                }
                var estado = sec.nombre || entidades[norm(sec.primera || '')] || '';
                var municipio = sec.municipio || '';
                var sector = sectorDesdeCelda(linea.celdas || []);
                var conNombre = !!(estado || municipio || sector);
                // shortcut: si el bloque no trae estado/municipio/sector reconocibles se
                // asigna por posición; una matriz desordenada puede cruzar filas.
                var idx = -1;
                for (var f = 0; f < lista.length; f++) {
                    if (usadas[f]) continue;
                    if (conNombre && !filaCoincide(lista[f], estado, municipio, sector)) continue;
                    idx = f;
                    break;
                }
                var etiqueta = (estado || '(sin nombre)') + ' / ' + (municipio || '-') + ' / ' + (sector || '-');
                if (idx < 0) {
                    warns.push('No se encontró la fila precargada para ' + etiqueta);
                    continue;
                }
                usadas[idx] = true;
                var fila = lista[idx];
                asignaciones.push({
                    fila: fila,
                    valores: vals,
                    etiqueta: (fila.entidadFederativa || estado) + ' / ' + (fila.municipio || municipio) + ' / ' + (fila.sector || sector || '-')
                });
            }
        }
        return { asignaciones: asignaciones, warns: warns };
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
        if (col === -1) {
            toast(['La fecha de la página no está en el bloque pegado. No se llenó nada.']);
            return;
        }
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
            var filasAT = [];
            tableAT.rows().every(function () { filasAT.push(this.data()); });
            var resuelto = resolverFilas(p.bloques, filasAT, col);
            for (var rw = 0; rw < resuelto.warns.length; rw++) warns.push(resuelto.warns[rw]);
            for (var a = 0; a < resuelto.asignaciones.length; a++) {
                var as = resuelto.asignaciones[a];
                var fila = as.fila;
                await escribirYVerificarFila(fila, 'Volumen-' + fila.idVenta, 'ValorVenta-' + fila.idVenta, 'volumen', 'valorVenta', as.valores.vol, as.valores.imp, msgs, warns, as.etiqueta);
                sumVol += as.valores.vol;
                sumImp += as.valores.imp;
                filasLlenadas++;
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
            var totalImp = null;
            if (p.totalImportes && p.totalImportes.length > col) totalImp = p.totalImportes[col];
            else if (p.filaTotal && p.filaTotal.length === 2) totalImp = p.filaTotal[1];
            if (totalImp != null && Math.abs(totalImp - sumImp) > 0.05) {
                warns.push('Suma de importes ($' + sumImp.toFixed(2) + ') difiere del total del bloque ($' + totalImp.toFixed(2) + ').');
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
                    if (!v) {
                        if (ln.nums.length === 3 && col > 0) {
                            warns.push('Recipiente fila ' + (ci + 1) + ': trae los valores de un solo día y no se sabe a cuál corresponde; no se escribió.');
                        }
                        continue;
                    }
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
        var res = { fechas: [], ventas: [], nVentas: 0 };
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
                res.nVentas++;
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

    // El bloque de una sola estación trae una única fila VENTA LITROS; el
    // REPORTE completo trae una por estación y debe seguir yendo a la cola.
    function esSemanaES(p) {
        return !!p && p.nVentas === 1 && p.fechas.length >= 5 && p.ventas.length >= 7;
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
                    resolve('error');
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
            if (yaRegistrada === 'error') {
                toast(['No se pudo comprobar si ' + fecha + ' ya estaba registrada: fallo de red o del servidor. No se registró nada.']);
                return;
            }
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

    function escHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function pintarEstaciones(estaciones, fechas) {
        estacionesPegadas = estaciones || [];
        fechasPegadas = fechas || [];
        var cont = document.getElementById('siretrac-venta-estaciones');
        if (!cont) return;
        if (!estacionesPegadas.length) {
            cont.innerHTML = '';
            return;
        }
        var html = '<div class="et-grid-wrap" style="max-height:30vh;margin-bottom:6px;overflow:auto">' +
            '<table class="et-grid" style="font-size:12px"><thead><tr>' +
            '<th>Estación</th><th>Permiso</th><th>Días</th><th>Traspasos</th>' +
            '</tr></thead><tbody>';
        for (var i = 0; i < estacionesPegadas.length; i++) {
            var e = estacionesPegadas[i];
            html += '<tr><td>' + escHtml(e.nombre || '(sin nombre)') + '</td>' +
                '<td>' + escHtml(e.permiso || '-') + '</td>' +
                '<td>' + (e.ventas ? e.ventas.length : 0) + '</td>' +
                '<td>' + (e.traspasos ? e.traspasos.length : 0) + '</td></tr>';
        }
        html += '</tbody></table></div>' +
            '<button id="siretrac-venta-subir" type="button" style="width:100%;padding:7px 10px;' +
            'border:1px solid var(--ui-border-strong);background:var(--ui-primary);color:#fff;' +
            'border-radius:0;cursor:pointer;font:400 12px/1 var(--ui-font)">Subir todas las estaciones</button>';
        cont.innerHTML = html;
        var boton = document.getElementById('siretrac-venta-subir');
        if (boton) boton.addEventListener('click', subirTodas);
    }

    // Una cola viva se reanuda sola en cada página ES. Este botón es la única
    // salida si algo salió mal: sin él, abrir la página vuelve a registrar.
    function pintarCola() {
        var cont = document.getElementById('siretrac-venta-cola');
        if (!cont) return;
        var cola = ET.store.get('venta.cola', []);
        if (!Array.isArray(cola) || !cola.length) { cont.innerHTML = ''; return; }
        cont.innerHTML = '<div style="margin-top:8px;padding:8px;border:1px solid var(--ui-border-strong);font-size:12px">' +
            'Cola pendiente: ' + cola.length + ' estación(es). Siguiente: ' +
            escHtml(cola[0].nombre || cola[0].permiso) + '.</div>' +
            '<button id="siretrac-venta-detener" type="button" style="width:100%;margin-top:6px;padding:7px 10px;' +
            'border:1px solid var(--ui-danger);background:var(--ui-danger);color:#fff;border-radius:0;' +
            'cursor:pointer;font:400 12px/1 var(--ui-font)">Detener la cola</button>';
        var boton = document.getElementById('siretrac-venta-detener');
        if (boton) boton.addEventListener('click', function () {
            if (!window.confirm('¿Descartar la cola? Lo ya registrado no se toca; lo pendiente no se sube.')) return;
            colaDetenida = true;
            ET.store.del('venta.cola');
            ET.store.del('venta.cola.auto');
            pintarCola();
        });
    }

    function resolverUrlPermiso(codigo) {
        if (typeof fetch !== 'function') return Promise.resolve(null);
        return fetch('/OrdenDePedido/Permisos', { credentials: 'include' })
            .then(function (r) { return r.text(); })
            .then(function (html) {
                var lista = ET.core.permisos.escanearPermisos(html);
                var buscado = norm(codigo);
                for (var i = 0; i < lista.length; i++) {
                    var p = lista[i];
                    var url = p.url || '';
                    var enUrl = false;
                    try {
                        enUrl = norm(decodeURIComponent(url)).indexOf(buscado) >= 0;
                    } catch (e) {
                        enUrl = norm(url).indexOf(buscado) >= 0;
                    }
                    if (norm(p.codigo) === buscado || enUrl) return url;
                }
                return null;
            });
    }

    function subirTodas() {
        var cola = colaDeEstaciones(estacionesPegadas, fechasPegadas);
        if (!cola.length) {
            alert('Ninguna estación del bloque tiene permiso (LP/... o número). No hay nada que subir.');
            return;
        }
        if (!fechasPegadas.length) {
            alert('No se encontraron las fechas de la semana en el bloque. Sin fechas no se puede registrar.');
            return;
        }
        var sinPermiso = 0;
        for (var i = 0; i < estacionesPegadas.length; i++) {
            if (!estacionesPegadas[i].permiso) sinPermiso++;
        }
        var listado = cola.map(function (e) {
            return (e.nombre || '(sin nombre)') + ' -> ' + e.permiso;
        }).join('\n');
        var mensaje = 'Se registrarán ' + cola.length + ' estación(es) en este orden:\n\n' + listado;
        if (sinPermiso) mensaje += '\n\nSe omiten ' + sinPermiso + ' estación(es) sin permiso.';
        mensaje += '\n\nLos días en cero o con "-" se registrarán como "Sin venta".\n\n¿Continuar?';
        if (!window.confirm(mensaje)) return;
        resolverUrlPermiso(cola[0].permiso).then(function (url) {
            if (!url) {
                alert('No se encontró el permiso ' + cola[0].permiso + ' en /OrdenDePedido/Permisos.\n\n' +
                    'No se navegó ni se guardó la cola.');
                return;
            }
            ET.store.set('venta.cola', cola);
            ET.store.set('venta.cola.auto', true);
            colaDetenida = false;
            location.href = url;
        }).catch(function () {
            alert('No se pudo consultar la lista de permisos. No se navegó ni se guardó la cola.');
        });
    }

    // La página ES no expone el permiso activo. La cabeza de la cola es la
    // fuente de verdad: es la estación a la que se navegó y se va a registrar.
    async function reanudarCola() {
        var cola = ET.store.get('venta.cola', []);
        if (!Array.isArray(cola) || !cola.length) return;
        if ($('#ShowbtonsGuardar').is(':visible')) {
            alert('Hay una cola de ventas pendiente, pero la página está en la pantalla de confirmación.\n' +
                'Pulsa "Regresar" y recarga para continuar.');
            return;
        }
        var est = cola[0];
        // Solo sigue sola si venimos de una navegación nuestra; si alguien
        // abre una página ES con una cola vieja, se le pregunta antes de escribir.
        var auto = ET.store.get('venta.cola.auto', false) === true;
        ET.store.del('venta.cola.auto');
        if (!auto && !window.confirm('Hay una subida pendiente: ' + cola.length + ' estación(es).\n\n' +
            'Siguiente: ' + (est.nombre || est.permiso) + '.\n\n¿Continuar ahora?')) return;
        if (!est || !est.permiso) {
            alert('La cola de ventas no tiene permiso en la primera estación. Se detiene para no registrar en la estación equivocada.');
            return;
        }
        var total = Math.min((est.fechas || []).length, (est.ventas || []).length);
        if (!total) {
            alert('La estación ' + (est.nombre || est.permiso) + ' de la cola no tiene fechas o ventas. Se detiene.');
            return;
        }
        var resultados = [];
        colaDetenida = false;
        for (var i = 0; i < total; i++) {
            if (colaDetenida) return;
            if (ET.core && ET.core.http && typeof ET.core.http.caida === 'function' && ET.core.http.caida()) {
                toast(['Se detuvo la subida: el servidor no responde (cortacircuitos activo). La cola se conserva.']);
                return;
            }
            var fecha = est.fechas[i];
            var colVenta = est.ventas[i];
            var ya = await fechaYaRegistrada(fecha);
            if (ya === 'error') {
                toast(['No se pudo comprobar si ' + fecha + ' ya estaba registrada: fallo de red o del servidor. La cola se detuvo sin registrar.']);
                return;
            }
            if (ya) {
                resultados.push(fecha + ': ya registrada, se omite');
                continue;
            }
            toast(['Registrando ' + (est.nombre || est.permiso) + ' - día ' + (i + 1) + ' de ' + total + ': ' + fecha + '...']);
            pintarEstadoDia(fecha, colVenta);
            var r = await registrarDiaES(fecha, colVenta);
            if (String(r).indexOf('ERROR:') === 0) {
                alert('No se pudo registrar ' + (est.nombre || est.permiso) + ':\n' + fecha + ': ' + r +
                    '\n\nLa cola se conserva. Detente y revisa antes de continuar.');
                return;
            }
            resultados.push(fecha + ': ' + r);
            await sleep(800);
        }
        cola.shift();
        if (colaDetenida) return;
        if (!cola.length) {
            ET.store.del('venta.cola');
            ET.store.del('venta.cola.auto');
            alert('Registro completado.\n\n' + resultados.join('\n'));
            return;
        }
        // Si no se resuelve el siguiente permiso no se guarda el avance: la
        // cola original sigue y los días ya registrados se omiten al reintentar.
        resolverUrlPermiso(cola[0].permiso).then(function (url) {
            if (colaDetenida) return;
            if (!url) {
                alert('Estación ' + (est.nombre || est.permiso) + ' registrada.\n\n' +
                    'No se encontró el siguiente permiso ' + cola[0].permiso + '.\n' +
                    'La cola se conserva sin cambios; recarga en una página ES para reintentar.');
                return;
            }
            ET.store.set('venta.cola', cola);
            ET.store.set('venta.cola.auto', true);
            alert('Estación ' + (est.nombre || est.permiso) + ' registrada.\n\n' + resultados.join('\n') +
                '\n\nSiguiente: ' + (cola[0].nombre || cola[0].permiso) + ' (' + cola[0].permiso + ').');
            location.href = url;
        }).catch(function () {
            alert('Estación ' + (est.nombre || est.permiso) + ' registrada, pero no se pudo consultar la lista de permisos.\n' +
                'La cola se conserva sin cambios.');
        });
    }

    // Mismo camino para el texto pegado y para el archivo soltado.
    function procesarTexto(texto) {
        var reporte = parsearReporte(texto);

        // En una página ES, el bloque de una sola estación se llena directo;
        // el REPORTE completo (varias filas VENTA LITROS) sigue yendo a la cola.
        if (esPaginaES) {
            var pe = parsearES(texto);
            if (esSemanaES(pe)) {
                fillES(texto, pe);
                return true;
            }
        }

        if (reporte.estaciones.length) {
            pintarEstaciones(reporte.estaciones, reporte.municipios.fechas);
            if (esPaginaDisPla) {
                var p = reporte.municipios;
                var lineasVenta = 0;
                p.bloques.forEach(function (b) { lineasVenta += b.lineas.length; });
                if (p.fechas.length && lineasVenta >= 4) llenar(texto, p);
            }
            return true;
        }

        pintarEstaciones([], []);

        if (esPaginaDisPla) {
            var p2 = parsear(texto);
            var lineasVenta2 = 0;
            p2.bloques.forEach(function (b) { lineasVenta2 += b.lineas.length; });
            if (!p2.fechas.length || lineasVenta2 < 4) return false;
            llenar(texto, p2);
            return true;
        }

        return false;
    }

    function avisoDrop(msg) {
        var drop = document.getElementById('siretrac-venta-drop');
        if (!drop) return;
        drop.textContent = msg;
        drop.style.borderColor = 'var(--ui-danger)';
        drop.style.color = 'var(--ui-danger)';
    }

    async function leerReporte(file) {
        var nombre = (file && file.name ? file.name : '').toLowerCase();
        if (/\.(xlsm|xlsx)$/.test(nombre)) return xlsxTexto(await file.arrayBuffer());
        if (/\.(csv|txt)$/.test(nombre)) return file.text();
        throw new Error('formato no soportado; usa .xlsm, .xlsx, .csv o .txt');
    }

    function montarDrop() {
        var drop = document.getElementById('siretrac-venta-drop');
        if (!paneVenta || !drop) return;
        var normal = function () {
            drop.textContent = 'Arrastra aquí el REPORTE (.xlsm) o pégalo con Ctrl+V';
            drop.style.borderColor = '';
            drop.style.color = '';
        };
        // Sin esto el navegador abre el archivo soltado en la página.
        paneVenta.addEventListener('dragover', function (e) { e.preventDefault(); e.stopPropagation(); });
        paneVenta.addEventListener('drop', function (e) { e.preventDefault(); e.stopPropagation(); });
        drop.addEventListener('dragover', function (e) {
            e.preventDefault();
            e.stopPropagation();
            drop.style.borderColor = 'var(--ui-primary)';
            drop.style.color = 'var(--ui-primary)';
        });
        drop.addEventListener('dragleave', function (e) {
            e.preventDefault();
            e.stopPropagation();
            drop.style.borderColor = '';
            drop.style.color = '';
        });
        drop.addEventListener('drop', function (e) {
            e.preventDefault();
            e.stopPropagation();
            drop.style.borderColor = '';
            drop.style.color = '';
            var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
            if (!file) return;
            drop.textContent = 'Leyendo ' + file.name + '…';
            leerReporte(file).then(function (texto) {
                if (procesarTexto(texto)) normal();
                else avisoDrop('No encontré un REPORTE en el archivo');
            }).catch(function (err) {
                avisoDrop('No pude leer el archivo: ' + (err && err.message ? err.message : err));
            });
        });
    }

    document.addEventListener('paste', function (e) {
        var cd = e.clipboardData || window.clipboardData;
        var texto = cd ? cd.getData('text/plain') : '';
        if (!texto || texto.indexOf('\t') < 0) return;
        if (!procesarTexto(texto)) return;
        e.preventDefault();
        e.stopPropagation();
    });

    montarDrop();

    pintarCola();
    if (esPaginaES) reanudarCola();

  ET.venta = ET.venta || {};
  ET.venta.xlsxTexto = xlsxTexto;
})();
