/* Release: bump the version, rebuild, commit, tag and push.
   bun tools/release.mjs patch "mensaje"      (minor | major | x.y.z)
   Flags: --no-push (only commit and tag), --skip-checks */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

const args = process.argv.slice(2);
const flags = args.filter((a) => a.startsWith('--'));
const rest = args.filter((a) => !a.startsWith('--'));
const kind = rest.shift() || 'patch';
const message = rest.join(' ') || 'release';
const noPush = flags.includes('--no-push');

/* git is installed but may not be on PATH (Windows). */
const GIT = process.env.GIT ||
  (existsSync('C:/Program Files/Git/cmd/git.exe') ? '"C:/Program Files/Git/cmd/git.exe"' : 'git');

function run(cmd) {
  execSync(cmd, { stdio: 'inherit' });
}

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const parts = pkg.version.split('.').map(Number);
if (kind === 'major') { parts[0] += 1; parts[1] = 0; parts[2] = 0; }
else if (kind === 'minor') { parts[1] += 1; parts[2] = 0; }
else if (kind === 'patch') { parts[2] += 1; }
else if (/^\d+\.\d+\.\d+$/.test(kind)) { const p = kind.split('.').map(Number); parts[0] = p[0]; parts[1] = p[1]; parts[2] = p[2]; }
else throw new Error('uso: bun tools/release.mjs patch|minor|major|x.y.z "mensaje" [--no-push]');

const version = parts.join('.');
const tag = 'v' + version;

if (!flags.includes('--skip-checks')) {
  run('bun tools/syntax.mjs');
  run('bun test');
}

pkg.version = version;
writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n', 'utf8');
run('bun tools/build.mjs');

run(GIT + ' add -A');
run(GIT + ' commit -m "chore(release): ' + tag + ' ' + message.replace(/"/g, "'") + '"');
run(GIT + ' tag -a ' + tag + ' -m "' + tag + ': ' + message.replace(/"/g, "'") + '"');

if (noPush) {
  console.log('\nListo en local: ' + tag + '. Publica con: git push --follow-tags');
} else {
  run(GIT + ' push --follow-tags');
  console.log('\nPublicado ' + tag + '. Tampermonkey lo verá en su próxima revisión (24 h) o con "Buscar actualizaciones".');
}
