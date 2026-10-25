// `npm run setup`: (re)creates the local dev database from scratch — applies every migration and
// loads the demo seed (`prisma migrate reset` runs the seed). Safe to run again at any time; it
// always returns to the seed state. Guarded: local host only, database "handys" (or an explicit
// SETUP_DB_NAME opt-in), never a test/e2e database.
const { execFileSync } = require('child_process');
const { existsSync, readFileSync } = require('fs');
const { userInfo } = require('os');
const { join } = require('path');

const serverDir = join(__dirname, '..');

function urlFromDotEnv() {
  const file = join(serverDir, '.env');
  if (!existsSync(file)) return null;
  const m = readFileSync(file, 'utf8').match(/^\s*DATABASE_URL\s*=\s*"?([^"\n]+)"?/m);
  return m ? m[1].trim() : null;
}

const user = process.env.USER || userInfo().username;
const url =
  process.env.DATABASE_URL || urlFromDotEnv() || `postgresql://${user}@localhost:5432/handys`;
// Only ever reset a local database. The expected name is "handys"; another local name needs an
// explicit SETUP_DB_NAME=<name> opt-in (and still never a test/e2e database).
const parsed = new URL(url);
const dbName = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
const host = parsed.hostname.replace(/^\[|\]$/g, '');
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const allowedName = process.env.SETUP_DB_NAME || 'handys';
const refuse = (why) => {
  console.error(`setup: refusing to reset "${dbName}" on "${host}": ${why}`);
  process.exit(1);
};
if (!LOCAL_HOSTS.has(host)) refuse('host must be localhost, 127.0.0.1 or ::1.');
if (dbName !== allowedName) {
  refuse(`database name must be "${allowedName}" (set SETUP_DB_NAME to opt in to another name).`);
}
if (/test|e2e/i.test(dbName)) refuse('test/e2e databases are reset by their own runners.');

console.log(`setup: resetting dev database "${dbName}" (migrations + demo seed)…`);
execFileSync('npx', ['prisma', 'migrate', 'reset', '--force'], {
  cwd: serverDir,
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: url },
});
console.log(
  'setup: done. Start with `npm run dev` and open http://localhost:5300 (API on :3300). Demo accounts: agent / ops, password demo1234.',
);
