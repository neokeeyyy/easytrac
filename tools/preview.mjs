/* Local UI preview: a synthetic SIRETRAC shell with the built bundle mounted.
   bun tools/preview.mjs [port]  ->  http://127.0.0.1:8099/GasLP/Compras/ListaRegistros
   All five tabs mount on that route because the page carries jQuery and the ids
   the features look for. Nothing leaves the machine except the jQuery tag. */
import { existsSync } from 'node:fs';
import { resolve, sep } from 'node:path';

const PORT = Number(process.argv[2] || 8099);
const ROOT = process.cwd();

const shell = () => `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>SIRETRAC - preview</title>
<style>
body{margin:0;background:#fff;color:#333;font:400 14px/1.43 var(--ui-font, ui-monospace, monospace);}
.main-header{background:var(--ui-header);color:#fff;height:50px;display:flex;align-items:center;padding:0 16px;}
.main-header a{color:#fff;text-decoration:none;}
.content-wrapper{padding:16px 20px;min-height:60vh;}
.panel{border:1px solid var(--ui-border);padding:14px;max-width:900px;}
h1{font-size:20px;margin:0 0 12px;}
table.grid{width:100%;border-collapse:collapse;}
table.grid td,table.grid th{border:1px solid var(--ui-border);padding:6px 8px;text-align:left;}
.main-footer{border-top:1px solid var(--ui-border);padding:10px 20px;color:var(--ui-muted);font-size:12px;}
</style></head>
<body>
<header class="main-header"><a href="#" class="siretrac_header">SIRETRAC</a><span style="flex:1"></span><a href="#">Salir</a></header>
<div class="content-wrapper">
  <div class="panel"><h1>Registros de compras</h1>
  <p>Página de prueba local. Los datos no salen de la máquina.</p></div>
  <form>
    <table class="grid" id="idtblVentasEntidad"><thead><tr><th>Estación</th><th>Auto-tanque</th><th>Recipientes</th></tr></thead>
    <tbody><tr><td>Ojuelos</td><td><input id="idVolumenVehiculo"></td><td></td></tr></tbody></table>
    <input id="idFechaVenta" type="text">
  </form>
</div>
<footer class="main-footer">Comisión Reguladora de Energía</footer>
<script src="https://cdn.jsdelivr.net/npm/jquery@3.7.1/dist/jquery.min.js"></script>
<script src="/dist/easytrac.bundle.js"></script>
</body></html>`;

const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' };

Bun.serve({
  hostname: '127.0.0.1',
  port: PORT,
  fetch(req) {
    const path = decodeURIComponent(new URL(req.url).pathname);
    if (path === '/' || path.startsWith('/GasLP/') || path.startsWith('/OrdenDePedido/') || path.startsWith('/RegistroVenta')) {
      return new Response(shell(), { headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
    const file = resolve(ROOT, path.replace(/^\/+/, ''));
    if (file.startsWith(ROOT + sep) && existsSync(file)) {
      const ext = file.slice(file.lastIndexOf('.'));
      return new Response(Bun.file(file), { headers: { 'content-type': types[ext] || 'application/octet-stream' } });
    }
    return new Response('no encontrado', { status: 404 });
  },
});

console.log('preview en http://127.0.0.1:' + PORT + '/GasLP/Compras/ListaRegistros');
