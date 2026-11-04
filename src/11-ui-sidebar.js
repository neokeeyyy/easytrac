/* EasyTrac sidebar: one copy for every feature.
   Expanded it floats over the page; collapsed it is a 44px rail that pushes content. */
(function () {
  'use strict';
  var ET = globalThis.EasyTrac;
  if (ET.ui && ET.ui.tab) return;

  var CSS =
    /* Soft spring: overshoots ~5% and settles. One curve for everything that moves. */
    ':root{--shub-spring:cubic-bezier(.34,1.4,.64,1);--shub-ease:cubic-bezier(.2,.8,.2,1);}' +
    '#shub-root{position:fixed;top:0;right:0;bottom:0;width:var(--shub-w,470px);z-index:2147483000;display:flex;flex-direction:column;' +
    'background:var(--ui-bg);border-left:1px solid var(--ui-muted);font:400 14px/1.43 var(--ui-font);color:var(--ui-fg);' +
    'transition:width 260ms var(--shub-spring);}' +
    '#shub-root *{box-sizing:border-box;}' +
    '#shub-head{background:var(--ui-header);color:#fff;padding:9px 12px;font-size:15px;display:flex;justify-content:space-between;' +
    'align-items:center;user-select:none;min-height:42px;}' +
    '#shub-head button{background:#fff;border:1px solid var(--ui-border-input);color:var(--ui-fg);width:28px;height:24px;' +
    'cursor:pointer;border-radius:0;line-height:1;font:inherit;transition:transform 180ms var(--shub-spring);}' +
    '#shub-head button:active{transform:scale(.88);}' +
    '#shub-tabs{display:flex;flex-wrap:wrap;background:var(--ui-bg);border-bottom:1px solid var(--ui-border-strong);}' +
    '.shub-tab{background:none;border:none;border-bottom:2px solid transparent;padding:8px 7px;cursor:pointer;' +
    'color:var(--ui-muted);font:inherit;font-size:12px;text-transform:uppercase;letter-spacing:0;white-space:nowrap;' +
    'transition:background 120ms linear,color 120ms linear,transform 140ms var(--shub-spring);}' +
    '.shub-tab:hover{background:#f5f5f5;color:var(--ui-fg);}' +
    '.shub-tab:active{transform:translateY(1px);}' +
    '.shub-tab.on{background:#f5f5f5;color:var(--ui-fg);border-bottom-color:var(--ui-muted);}' +
    '#shub-panes{flex:1;min-height:0;overflow:auto;}' +
    '.shub-pane{display:none;padding:10px;}' +
    '.shub-pane.on{display:block;animation:shub-in 200ms var(--shub-spring) both;}' +
    '@keyframes shub-in{from{opacity:0;transform:translateY(8px);}to{opacity:1;transform:none;}}' +
    '#shub-root button:not(#shub-min){transition:transform 140ms var(--shub-spring),background 120ms linear;}' +
    '#shub-root button:not(#shub-min):active{transform:scale(.97);}' +
    '#shub-root.shub-min{width:44px;cursor:pointer;}' +
    '#shub-root.shub-min #shub-tabs,#shub-root.shub-min #shub-panes,#shub-root.shub-min #shub-head span{display:none;}' +
    '#shub-root.shub-min #shub-head{justify-content:center;padding:9px 0;cursor:pointer;}' +
    'body.shub-rail .content-wrapper,body.shub-rail .right-side,body.shub-rail .main-footer{margin-right:calc(44px + 10px);}' +
    'body.shub-rail .main-header .navbar{margin-right:calc(44px + 10px);display:flex;flex-wrap:nowrap;align-items:center;}' +
    'body.shub-rail .main-header .navbar-header,body.shub-rail .main-header .siretrac_header{float:none;flex:1 1 auto;min-width:0;' +
    'overflow:hidden;white-space:nowrap;text-overflow:ellipsis;}' +
    'body.shub-rail .main-header .navbar-custom-menu,body.shub-rail .main-header .navbar-right{float:none;flex:0 0 auto;}' +
    'body .content-wrapper,body .right-side,body .main-footer,body .main-header .navbar{' +
    'transition:margin-right 260ms var(--shub-spring);}' +
    '@media (prefers-reduced-motion:reduce){#shub-root,.shub-pane.on,#shub-root button,.shub-tab,body .content-wrapper,' +
    'body .right-side,body .main-footer,body .main-header .navbar{transition:none;animation:none;}}' +
    /* jQuery UI sets its own z-index inline; only !important wins here. */
    '#ui-datepicker-div{z-index:2147483647 !important;}';

  function style() {
    if (document.getElementById('shub-style')) return;
    var st = document.createElement('style');
    st.id = 'shub-style';
    st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
  }

  var root = null, tabs = null, panes = null;

  function layout() {
    var min = root.classList.contains('shub-min');
    var on = root.querySelector('.shub-pane.on');
    document.documentElement.style.setProperty('--shub-w', (min ? 44 : (on ? +on.getAttribute('data-w') : 470)) + 'px');
    document.body.classList[min ? 'add' : 'remove']('shub-rail');
    var btn = root.querySelector('#shub-min');
    btn.textContent = min ? '\u00AB' : '\u00BB';
    btn.setAttribute('aria-expanded', min ? 'false' : 'true');
  }

  function activar(tid, guardar) {
    var els = root.querySelectorAll('.shub-tab,.shub-pane');
    for (var i = 0; i < els.length; i++) {
      els[i].classList[els[i].getAttribute('data-id') === tid ? 'add' : 'remove']('on');
    }
    if (guardar) { try { localStorage.setItem('shub_tab', tid); } catch (e) {} }
    layout();
  }

  function crear() {
    style();
    root = document.createElement('div');
    root.id = 'shub-root';
    root.innerHTML =
      '<div id="shub-head"><span>EasyTRAC</span>' +
      '<button id="shub-min" type="button" aria-expanded="true" title="Colapsar / expandir">\u00BB</button></div>' +
      '<div id="shub-tabs"></div><div id="shub-panes"></div>';
    document.body.appendChild(root);
    tabs = root.querySelector('#shub-tabs');
    panes = root.querySelector('#shub-panes');
    try { if (localStorage.getItem('shub_min') === '1') root.classList.add('shub-min'); } catch (e) {}

    function toggle() {
      var min = root.classList.toggle('shub-min');
      if (!min && !root.querySelector('.shub-pane.on')) {
        var first = root.querySelector('.shub-tab');
        if (first) { activar(first.getAttribute('data-id'), false); return; }
      }
      try { localStorage.setItem('shub_min', min ? '1' : '0'); } catch (e) {}
      layout();
    }
    root.querySelector('#shub-min').addEventListener('click', function (e) {
      e.stopPropagation();
      toggle();
    });
    /* The whole rail is a target when collapsed. */
    root.addEventListener('click', function () {
      if (root.classList.contains('shub-min')) toggle();
    });
    layout();
  }

  function tab(id, titulo, orden, ancho) {
    if (!root) crear();
    var existente = panes.querySelector('[data-id="' + id + '"]');
    if (existente) return existente;

    var o = String(orden || 99);
    var pane = document.createElement('div');
    pane.className = 'shub-pane';
    pane.setAttribute('data-id', id);
    pane.setAttribute('data-o', o);
    pane.setAttribute('data-w', String(ancho || 470));

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'shub-tab';
    btn.textContent = titulo;
    btn.setAttribute('data-id', id);
    btn.setAttribute('data-o', o);
    btn.addEventListener('click', function () { activar(id, true); });

    function insertar(cont, el) {
      var hijos = cont.children, ref = null;
      for (var i = 0; i < hijos.length; i++) {
        if (+hijos[i].getAttribute('data-o') > +o) { ref = hijos[i]; break; }
      }
      cont.insertBefore(el, ref);
    }
    insertar(tabs, btn);
    insertar(panes, pane);

    var guardada = '';
    try { guardada = localStorage.getItem('shub_tab') || ''; } catch (e) {}
    if (!root.querySelector('.shub-pane.on') || guardada === id) activar(id, false);
    else layout();
    return pane;
  }

  ET.ui = ET.ui || {};
  ET.ui.tab = tab;
  ET.ui.root = function () { return root; };
  ET.ui.style = function (css) {
    style();
    var st = document.createElement('style');
    st.textContent = css;
    (document.head || document.documentElement).appendChild(st);
  };
})();
