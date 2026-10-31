import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const backendDir = resolve(__dirname, '../../backend');

// Find virtual environment python executable
const isWindows = process.platform === 'win32';
const venvPython = resolve(
  backendDir,
  isWindows ? '.venv/Scripts/python.exe' : '.venv/bin/python'
);

if (!existsSync(venvPython)) {
  console.error(`[backend] Error: Python virtual environment not found at: ${venvPython}`);
  console.error('[backend] Please initialize the backend virtual environment:');
  console.error('  cd ../backend');
  console.error('  python -m venv .venv');
  console.error('  .\\.venv\\Scripts\\pip install -r requirements.txt');
  process.exit(1);
}

const args = [
  '-m',
  'uvicorn',
  'app.main:app',
  '--host',
  '127.0.0.1',
  '--port',
  '8000',
  '--reload',
];

console.log(`[backend] Launching FastAPI backend with ${venvPython}...`);
const child = spawn(venvPython, args, {
  cwd: backendDir,
  stdio: 'inherit',
  shell: false,
});

child.on('error', (err) => {
  console.error(`[backend] Failed to spawn backend process: ${err.message}`);
  process.exit(1);
});

child.on('close', (code, signal) => {
  if (signal) {
    console.log(`[backend] Backend terminated by signal ${signal}`);
  } else if (code !== 0) {
    console.error(`[backend] Backend process exited with error code ${code}`);
    process.exit(code ?? 1);
  }
});

// Forward termination signals so Ctrl+C shuts down backend cleanly
const shutdown = () => {
  if (child && !child.killed) {
    child.kill('SIGTERM');
  }
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

