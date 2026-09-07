import { readFile, open } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
const root = new URL('../', import.meta.url);
const template = await readFile(new URL('.env.example', root), 'utf8');
const content = template.replace(/^APP_PASSWORD=$/m, `APP_PASSWORD=${randomBytes(24).toString('hex')}`)
  .replace(/^POSTGRES_PASSWORD=.*$/m, `POSTGRES_PASSWORD=${randomBytes(24).toString('hex')}`);
try {
  const file = await open(new URL('.env', root), 'wx', 0o600);
  try { await file.writeFile(content); } finally { await file.close(); }
  console.log('Created .env (mode 0600) with random instance and database passwords.');
  console.log('Read APP_PASSWORD in .env to sign in. Configure a model, then run docker compose up -d --build --wait.');
} catch (error) {
  if (error.code === 'EEXIST') { console.error('.env already exists; leaving it unchanged.'); process.exitCode = 1; }
  else throw error;
}
