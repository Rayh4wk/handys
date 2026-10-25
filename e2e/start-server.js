// Playwright webServer command: reset the e2e database (migrate reset runs the seed), then start
// the built server. Resetting here — before the server process exists — makes the order
// deterministic (Playwright starts webServer before globalSetup, so a reset there would drop the
// schema under a live server).
const { execFileSync, spawn } = require('child_process');
const { join } = require('path');

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('start-server: DATABASE_URL is not set.');
  process.exit(1);
}
const dbName = new URL(url).pathname.replace(/^\//, '');
if (!dbName.includes('e2e')) {
  console.error(`Refusing to reset database "${dbName}": name does not contain "e2e".`);
  process.exit(1);
}

const serverDir = join(__dirname, '..', 'apps', 'server');
execFileSync('npx', ['prisma', 'migrate', 'reset', '--force'], { cwd: serverDir, stdio: 'inherit' });

const server = spawn(process.execPath, ['dist/main.js'], { cwd: serverDir, stdio: 'inherit' });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.kill(sig));
server.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
