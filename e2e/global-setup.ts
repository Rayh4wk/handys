import { execFileSync } from 'child_process';
import { join } from 'path';
import { E2E_DATABASE_URL } from './env';

/**
 * Resets the e2e database to the seed data before the suite (migrate reset runs the seed).
 * Playwright starts `webServer` before global setup; the server has only opened its pool at this
 * point (no queries yet), so dropping and recreating the schema underneath it is safe.
 */
export default function globalSetup(): void {
  const dbName = new URL(E2E_DATABASE_URL).pathname.replace(/^\//, '');
  if (!dbName.includes('e2e')) {
    throw new Error(`Refusing to reset database "${dbName}": name does not contain "e2e".`);
  }
  execFileSync('npx', ['prisma', 'migrate', 'reset', '--force'], {
    cwd: join(__dirname, '..', 'apps', 'server'),
    env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL },
    stdio: 'inherit',
  });
}
