// Runs integration tests against the handys_test database.
// TEST_DATABASE_URL overrides the default (built from $USER, no password).
const { spawnSync } = require('child_process');
const user = process.env.USER || require('os').userInfo().username;
const url = process.env.TEST_DATABASE_URL || `postgresql://${user}@localhost:5432/handys_test`;
const dbName = new URL(url).pathname.replace(/^\//, '');
if (!dbName.includes('test')) {
  console.error(`Refusing to run: target database "${dbName}" does not contain "test".`);
  process.exit(1);
}
const env = { ...process.env, DATABASE_URL: url };
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { stdio: 'inherit', env, shell: false });
  if (r.status !== 0) process.exit(r.status ?? 1);
};
run('npx', ['prisma', 'migrate', 'reset', '--force', '--skip-seed']);
run('npx', ['jest', '--config', 'jest.int.config.js', '--runInBand', ...process.argv.slice(2)]);
