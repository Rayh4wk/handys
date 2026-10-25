// Docker start helper: seeds the demo data only when the database has no reservations yet,
// so restarting the container (persistent DB volume) does not fail on duplicate seed ids.
const { spawnSync } = require('child_process');
const { PrismaClient } = require('@prisma/client');

async function main() {
  const prisma = new PrismaClient();
  try {
    const count = await prisma.reservation.count();
    if (count > 0) {
      console.log(`Seed skipped: ${count} reservations already present.`);
      return;
    }
  } finally {
    await prisma.$disconnect();
  }
  const r = spawnSync('npx', ['prisma', 'db', 'seed'], { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
