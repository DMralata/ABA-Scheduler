import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const r = await prisma.proposedSession.deleteMany({
    where: { startTime: { gte: new Date('2026-04-06T04:00:00Z'), lt: new Date('2026-04-13T04:00:00Z') } }
  });
  console.log('Deleted:', r.count, 'proposals');
  await prisma.$disconnect();
}
main().catch(console.error);
