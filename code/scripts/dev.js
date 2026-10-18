#!/usr/bin/env node
// One command to run the whole app:  npm run dev
//
// 1. Installs backend and frontend packages if they're missing or out of date
// 2. Creates code/backend/.env from .env.example (with a random JWT_SECRET) if it doesn't exist
// 3. Starts the backend (auto-restarts on changes) and the frontend together
//
// `npm run setup` does steps 1 and 2 only. Ctrl+C stops everything.
// No extra dependencies: uses only Node's built-in modules.

const { spawn, spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

// Repo root (this file lives in code/scripts/).
const ROOT = path.resolve(__dirname, '..', '..');
const BACKEND = path.join(ROOT, 'code', 'backend');
const FRONTEND = path.join(ROOT, 'code', 'frontend');
const IS_WINDOWS = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
const API_PORT = 8080;
const WEB_PORT = 3000;
const setupOnly = process.argv.includes('--setup-only');

const colour = (code, text) => (process.stdout.isTTY ? `\x1b[${code}m${text}\x1b[0m` : text);
const info = (msg) => console.log(colour('36', '▸'), msg);
const warn = (msg) => console.log(colour('33', '!'), msg);
const fail = (msg) => {
  console.error(colour('31', '✖'), msg);
  process.exit(1);
};

function checkNode() {
  const [major] = process.versions.node.split('.').map(Number);
  // snowflake-sdk needs Node 20+
  if (major < 20) {
    fail(`Node ${process.versions.node} is too old. Install Node 20 or newer (22 recommended).`);
  }
}

function mtime(file) {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

// Install if node_modules is missing, or package.json / package-lock.json changed since the last install.
function needsInstall(dir) {
  const installed = mtime(path.join(dir, 'node_modules', '.package-lock.json'));
  if (!installed) return true;
  return mtime(path.join(dir, 'package.json')) > installed || mtime(path.join(dir, 'package-lock.json')) > installed;
}

function install(dir, label) {
  if (!needsInstall(dir)) {
    info(`${label}: packages up to date`);
    return;
  }
  info(`${label}: installing packages…`);
  const result = spawnSync('npm', ['install', '--no-audit', '--no-fund'], {
    cwd: dir,
    stdio: 'inherit',
    shell: IS_WINDOWS,
  });
  if (result.status !== 0) fail(`${label}: npm install failed (see the output above).`);
}

function ensureEnv() {
  const envFile = path.join(BACKEND, '.env');
  const example = path.join(BACKEND, '.env.example');
  if (fs.existsSync(envFile)) {
    const env = fs.readFileSync(envFile, 'utf8');
    if (/^DATABASE_URL=\s*$/m.test(env) || !/^DATABASE_URL=/m.test(env)) {
      warn('DATABASE_URL is empty in code/backend/.env. The app will start, but database calls will fail.');
    }
    return;
  }
  if (!fs.existsSync(example)) fail('code/backend/.env.example is missing.');
  const secret = crypto.randomBytes(32).toString('hex');
  const env = fs.readFileSync(example, 'utf8').replace(/^JWT_SECRET=.*$/m, `JWT_SECRET=${secret}`);
  fs.writeFileSync(envFile, env);
  warn('Created code/backend/.env with a random JWT_SECRET.');
  warn('Add your DATABASE_URL (and any API keys) there, then run: npm run db:reset');
}

// Resolve true if nothing is listening on the port. Checks both IPv4 and IPv6,
// since macOS often has servers listening on only one of them.
function portFree(port) {
  const tryHost = (host) =>
    new Promise((resolve) => {
      const server = net.createServer();
      server.once('error', (err) => resolve(err.code === 'EADDRNOTAVAIL' || err.code === 'EAFNOSUPPORT'));
      server.once('listening', () => server.close(() => resolve(true)));
      server.listen(port, host);
    });
  return Promise.all([tryHost('0.0.0.0'), tryHost('::')]).then((r) => r.every(Boolean));
}

async function checkPorts() {
  const busy = [];
  for (const port of [API_PORT, WEB_PORT]) if (!(await portFree(port))) busy.push(port);
  if (!busy.length) return;

  for (const port of busy) {
    let who = '';
    if (!IS_WINDOWS) {
      const r = spawnSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' });
      const line = (r.stdout || '').split('\n')[1];
      if (line) {
        const [cmd, pid] = line.trim().split(/\s+/);
        who = ` by ${cmd} (pid ${pid})`;
      }
    }
    warn(`Port ${port} is already in use${who}. Probably an earlier run that didn't close.`);
  }
  if (IS_WINDOWS) fail('Close the other terminal running the app, then try again.');
  fail(`Stop it with:  lsof -ti ${busy.map((p) => `:${p}`).join(' ')} | xargs kill\nthen run npm run dev again.`);
}

// Run a process and prefix each output line, e.g. "[api] server listening…"
function run(label, code, cmd, args, cwd, extraEnv = {}) {
  const child = spawn(cmd, args, {
    cwd,
    shell: IS_WINDOWS,
    // Own process group (macOS/Linux), so stopping it also stops anything it started.
    detached: !IS_WINDOWS,
    env: { ...process.env, FORCE_COLOR: '1', ...extraEnv },
  });
  const prefix = colour(code, `[${label}]`);
  for (const stream of [child.stdout, child.stderr]) {
    let buffer = '';
    stream.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) console.log(`${prefix} ${line}`);
    });
  }
  return child;
}

// Stop a process and everything it started (npm start -> react-scripts -> webpack).
function killTree(child) {
  if (child.exitCode !== null) return;
  try {
    if (IS_WINDOWS) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F']);
    else process.kill(-child.pid, 'SIGTERM');
  } catch {
    // already gone
  }
}

async function main() {
  checkNode();
  install(BACKEND, 'backend');
  install(FRONTEND, 'frontend');
  ensureEnv();
  if (setupOnly) {
    info('Setup done.');
    return;
  }

  await checkPorts();
  info(`Starting backend on http://localhost:${API_PORT} and frontend on http://localhost:${WEB_PORT} (Ctrl+C to stop)`);
  if (IS_MAC) info('Your browser will open when the frontend is ready.');
  const children = [
    run('api', '35', 'node', ['--watch', 'index.js'], BACKEND),
    // DANGEROUSLY_DISABLE_HOST_CHECK works around a Create React App bug where the
    // "proxy" setting crashes the dev server ("allowedHosts[0] should be a non-empty
    // string"). Local development only; production serves the built files instead.
    run('web', '34', 'npm', ['start'], FRONTEND, {
      // On a Mac, let React open (or reuse) a browser tab. Elsewhere, don't.
      BROWSER: process.env.BROWSER || (IS_MAC ? '' : 'none'),
      PORT: String(WEB_PORT),
      DANGEROUSLY_DISABLE_HOST_CHECK: 'true',
    }),
  ];

  let stopping = false;
  const stopAll = (exitCode) => {
    if (stopping) return;
    stopping = true;
    for (const child of children) killTree(child);
    setTimeout(() => process.exit(exitCode), 500);
  };

  for (const child of children) {
    child.on('exit', (code) => {
      if (!stopping) {
        warn(`A process stopped (exit code ${code}). Stopping the other one too.`);
        stopAll(code || 1);
      }
    });
  }
  process.on('SIGINT', () => stopAll(0));
  process.on('SIGTERM', () => stopAll(0));
  process.on('SIGHUP', () => stopAll(0)); // closing the Terminal window
}

main().catch((err) => fail(err.message));
