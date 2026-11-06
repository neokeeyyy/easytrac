/* EasyTrac spreadsheet grid: paste a block, edit it as a table, serialize back to TSV. */
(function () {
  'use strict';
  var ET = globalThis.EasyTrac;

  var CSS =
    '.et-grid-wrap{overflow:auto;max-height:52vh;border:1px solid var(--ui-border-strong);background:var(--ui-bg);}' +
    'table.et-grid{border-collapse:collapse;font:inherit;min-width:100%;}' +
    'table.et-grid th,table.et-grid td{border:1px solid var(--ui-border);padding:4px 8px;white-space:nowrap;border-radius:0;}' +
    'table.et-grid th{position:sticky;top:0;z-index:2;background:var(--ui-muted);color:#fff;font-weight:400;text-align:left;}' +
    'table.et-grid tr > :first-child{position:sticky;left:0;z-index:1;background:#f5f5f5;color:var(--ui-muted);}' +
    'table.et-grid thead tr > :first-child{z-index:3;background:var(--ui-header-hover);color:#fff;}' +
    'table.et-grid td{background:var(--ui-bg);}' +
    'table.et-grid td.num{text-align:right;font-variant-numeric:tabular-nums;}' +
    'table.et-grid td:focus{outline:2px solid var(--ui-focus);outline-offset:-2px;}' +
    'table.et-grid td.sel{background:#eaf6ff;}' +
    'table.et-grid tbody tr{animation:et-row 200ms cubic-bezier(.2,.8,.2,1) both;}' +
    '@keyframes et-row{from{opacity:0;}to{opacity:1;}}' +
    '@media (prefers-reduced-motion:reduce){table.et-grid tbody tr{animation:none;}}';

  /* The grid can live in a shadow root, where document styles do not reach: keep its CSS with it. */
  function style(wrap) {
    var st = document.createElement('style');
    st.className = 'et-grid-style';
    st.textContent = CSS;
    wrap.appendChild(st);
  }

  /* TSV text -> 2D array. Drops one trailing empty row from a final newline. */
  function gridSplit(texto) {
    var lineas = String(texto == null ? '' : texto).replace(/\r\n?/g, '\n').split('\n');
    if (lineas.length && lineas[lineas.length - 1] === '') lineas.pop();
    return lineas.map(function (l) { return l.split('\t'); });
  }

  function gridToTSV(matriz) {
    return (matriz || []).map(function (f) { return f.join('\t'); }).join('\n');
  }

  function esNumero(v) {
    var s = String(v == null ? '' : v).trim();
    return s !== '' && /^-?[\d.,]+\s*%?$/.test(s) && /\d/.test(s);
  }

  function gridRender(matriz, opciones) {
    var opts = opciones || {};
    var cabecera = opts.cabecera !== false;
    var wrap = document.createElement('div');
    wrap.className = 'et-grid-wrap';
    style(wrap);
    var table = document.createElement('table');
    table.className = 'et-grid';

    (matriz || []).forEach(function (fila, r) {
      var tr = document.createElement('tr');
      var esCab = cabecera && r === 0;
      fila.forEach(function (valor, c) {
        var celda = document.createElement(esCab ? 'th' : 'td');
        celda.textContent = valor == null ? '' : String(valor);
        celda.setAttribute('data-r', String(r));
        celda.setAttribute('data-c', String(c));
        if (esCab) {
          celda.setAttribute('scope', 'col');
        } else {
          celda.setAttribute('contenteditable', 'true');
          if (esNumero(valor)) celda.className = 'num';
        }
        tr.appendChild(celda);
      });
      table.appendChild(tr);
    });

    if (cabecera && table.tHead == null && table.rows.length) {
      var head = document.createElement('thead');
      head.appendChild(table.rows[0]);
      table.insertBefore(head, table.firstChild);
    }
    wrap.appendChild(table);
    return wrap;
  }

  function gridSerializar(grid) {
    var table = grid.tagName === 'TABLE' ? grid : grid.querySelector('table.et-grid');
    if (!table) return '';
    var filas = [], fila = [], r = -1;
    for (var i = 0; i < table.rows.length; i++) {
      fila = [];
      for (var j = 0; j < table.rows[i].cells.length; j++) {
        fila.push(table.rows[i].cells[j].textContent.replace(/\s+/g, ' ').trim());
      }
      if (fila.join('') === '') continue;
      filas.push(fila);
      r++;
    }
    return gridToTSV(filas);
  }

  function gridEditar(celda, valor) {
    celda.textContent = valor == null ? '' : String(valor);
    celda.className = esNumero(valor) ? 'num' : '';
    celda.dispatchEvent(new Event('input', { bubbles: true }));
    return celda;
  }

  function gridPegar(contenedor, texto) {
    var matriz = gridSplit(texto);
    if (matriz.length > 500) matriz = matriz.slice(0, 500); // shortcut: 500-row cap, raise if a real matrix grows past it.
    contenedor.innerHTML = '';
    var grid = gridRender(matriz);
    contenedor.appendChild(grid);
    enlazar(grid);
    return grid;
  }

  function mover(celda, dr, dc) {
    var table = celda.closest('table');
    if (!table) return;
    var r = +celda.getAttribute('data-r') + dr;
    var c = +celda.getAttribute('data-c') + dc;
    var dest = table.querySelector('[data-r="' + r + '"][data-c="' + c + '"]');
    if (dest) { dest.focus(); }
  }

  function enlazar(grid) {
    var table = grid.tagName === 'TABLE' ? grid : grid.querySelector('table.et-grid');
    if (!table || table.getAttribute('data-et') === '1') return;
    table.setAttribute('data-et', '1');

    table.addEventListener('keydown', function (e) {
      var celda = e.target;
      if (!celda || celda.tagName !== 'TD') return;
      if (e.key === 'ArrowUp') { e.preventDefault(); mover(celda, -1, 0); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); mover(celda, 1, 0); }
      else if (e.key === 'ArrowLeft' && !celda.textContent) { e.preventDefault(); mover(celda, 0, -1); }
      else if (e.key === 'ArrowRight' && !celda.textContent) { e.preventDefault(); mover(celda, 0, 1); }
      else if (e.key === 'Enter') { e.preventDefault(); mover(celda, 1, 0); }
      else if (e.key === 'Delete') { e.preventDefault(); gridEditar(celda, ''); }
    });

    table.addEventListener('paste', function (e) {
      var celda = e.target;
      if (!celda || celda.tagName !== 'TD') return;
      var texto = (e.clipboardData || window.clipboardData).getData('text');
      if (texto.indexOf('\t') < 0 && texto.indexOf('\n') < 0) return;
      e.preventDefault();
      var trozos = gridSplit(texto);
      var table = celda.closest('table');
      var r0 = +celda.getAttribute('data-r'), c0 = +celda.getAttribute('data-c');
      trozos.forEach(function (fila, r) {
        fila.forEach(function (valor, c) {
          var dest = table.querySelector('[data-r="' + (r0 + r) + '"][data-c="' + (c0 + c) + '"]');
          if (dest && dest.tagName === 'TD') gridEditar(dest, valor);
        });
      });
    });
  }

  function gridMontar(contenedor) {
    if (!contenedor || contenedor.getAttribute('data-et-mount') === '1') return;
    contenedor.setAttribute('data-et-mount', '1');
    /* An empty container has no cell to paste into, so the first paste builds the grid. */
    contenedor.addEventListener('paste', function (e) {
      if (contenedor.querySelector('td')) return;
      e.preventDefault();
      var texto = (e.clipboardData || window.clipboardData).getData('text');
      gridPegar(contenedor, texto);
      var primera = contenedor.querySelector('td');
      if (primera) primera.focus();
    });
  }

  ET.grid = {
    render: gridRender,
    pegar: gridPegar,
    montar: gridMontar,
    serializar: gridSerializar,
    editar: gridEditar,
    split: gridSplit,
    toTSV: gridToTSV,
    esNumero: esNumero,
    enlazar: enlazar
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { gridSplit: gridSplit, gridToTSV: gridToTSV, esNumero: esNumero };
  }
})();
