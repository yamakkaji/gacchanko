// Avoid embedding the builder's home/workspace paths in Rust panic locations.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {spawnSync} = require('node:child_process');

function buildEnvironment(env = process.env, root = path.resolve(__dirname, '..'), home = os.homedir()) {
  const flags = env.CARGO_ENCODED_RUSTFLAGS !== undefined
    ? env.CARGO_ENCODED_RUSTFLAGS.split('\x1f').filter(Boolean)
    : (env.RUSTFLAGS || '').split(/\s+/).filter(Boolean);
  for (const [source, destination] of [
    [home, '/build/user'],
    [env.CARGO_HOME || path.join(home, '.cargo'), '/build/cargo'],
    [env.RUSTUP_HOME || path.join(home, '.rustup'), '/build/rustup'],
    [root, '/build/gacchanko'],
  ]) {
    const paths = new Set([path.resolve(source)]);
    try { paths.add(fs.realpathSync(source)); } catch {}
    for (const p of paths) flags.push(`--remap-path-prefix=${p}=${destination}`);
  }
  return {...env, CARGO_ENCODED_RUSTFLAGS: flags.join('\x1f')};
}

if (require.main === module) {
  const cli = path.join(path.dirname(require.resolve('@tauri-apps/cli/package.json')), 'tauri.js');
  const result = spawnSync(process.execPath, [cli, 'build', '--features', 'custom-protocol', ...process.argv.slice(2)], {
    cwd: path.resolve(__dirname, '..'), env: buildEnvironment(), stdio: 'inherit',
  });
  if (result.error) console.error(result.error.message);
  process.exit(result.status ?? 1);
}
module.exports = {buildEnvironment};
