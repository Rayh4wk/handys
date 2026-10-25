// `npm run setup`: (re)creates the local dev database from scratch — applies every migration and
// loads the demo seed (`prisma migrate reset` runs the seed). Safe to run again at any time; it
// always returns to the seed state. Guarded so it can never wipe the test/e2e databases.
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
const dbName = new URL(url).pathname.replace(/^\//, '');
if (!dbName.includes('handys') || /_(test|e2e)/.test(dbName)) {
  console.error(
    `setup: refusing to reset database "${dbName}" (must contain "handys" and not be a _test/_e2e database).`,
  );
  process.exit(1);
}

console.log(`setup: resetting dev database "${dbName}" (migrations + demo seed)…`);
execFileSync('npx', ['prisma', 'migrate', 'reset', '--force'], {
  cwd: serverDir,
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: url },
});
console.log('setup: done. Start with `npm run dev`. Demo accounts: agent / ops, password demo1234.');
