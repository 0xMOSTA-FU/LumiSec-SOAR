import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const server = join(process.cwd(), '.next', 'standalone', 'server.js');
if (!existsSync(server)) {
  console.error('Missing .next/standalone/server.js — run npm run build first');
  process.exit(1);
}

process.env.NODE_ENV = 'production';
const child = spawn(process.execPath, [server], {
  stdio: 'inherit',
  env: process.env,
});

child.on('exit', (code) => process.exit(code ?? 0));
