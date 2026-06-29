import { cpSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const standalone = join(root, '.next', 'standalone');
const staticSrc = join(root, '.next', 'static');
const staticDest = join(standalone, '.next', 'static');
const publicSrc = join(root, 'public');
const publicDest = join(standalone, 'public');

if (!existsSync(standalone)) {
  console.warn('copy-standalone: .next/standalone not found — skip (normal for dev builds)');
  process.exit(0);
}

cpSync(staticSrc, staticDest, { recursive: true });
cpSync(publicSrc, publicDest, { recursive: true });
console.log('copy-standalone: static + public copied into standalone output');
