import { readFileSync, writeFileSync, rmSync } from "node:fs";
const css = readFileSync("src/ui/tokens.css", "utf8").trim();
const mod = `/* EasyTrac tokens: house-ui stylesheet, inlined so it needs no extra request.
   Source: ~/.config/opencode/skills/house-ui/tokens.css */
(function () {
  'use strict';
  var ET = globalThis.EasyTrac;
  if (document.getElementById('easytrac-tokens')) return;
  var st = document.createElement('style');
  st.id = 'easytrac-tokens';
  st.textContent = ${JSON.stringify(css)};
  (document.head || document.documentElement).appendChild(st);
})();
`;
writeFileSync("src/10-ui-tokens.js", mod, "utf8");
rmSync("src/ui", { recursive: true, force: true });
console.log("tokens inlined:", mod.length, "bytes");
