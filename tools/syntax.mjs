import { readFileSync, readdirSync } from "node:fs";
let bad = 0;
for (const f of readdirSync("src").filter(x => x.endsWith(".js"))) {
  const src = readFileSync("src/"+f, "utf8");
  try { new Function(src); console.log("ok   " + f + "  " + src.split("\n").length + " lines"); }
  catch (e) { bad++; console.log("FAIL " + f + ": " + e.message); }
}
process.exit(bad ? 1 : 0);
