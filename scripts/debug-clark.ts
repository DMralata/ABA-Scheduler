import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const client = await prisma.client.findFirst({
    where: { lastName: 'Clark', firstName: 'Benjamin' },
    include: {
      availability: true,
      approvedHomeProviders: { where: { endDate: null }, include: { provider: { select: { id: true, firstName: true, lastName: true, position: true, availability: true } } } },
      authorizations: { orderBy: { startDate: 'desc' }, take: 1 },
    },
  });
  if (!client) { console.log('not found'); return; }
  console.log('Client:', client.firstName, client.lastName);
  console.log('Auth hrs/wk:', client.authorizations[0]?.approvedHoursPerWeek);
  console.log('Preferred location:', client.preferredLocation);
  console.log('Female only:', client.femaleProviderOnly);
  console.log('Spanish:', client.spanish);
  console.log('Min RBT:', client.minimumRbtLevel);
  console.log('Availability:', JSON.stringify(client.availability.map(a => ({ day: a.dayOfWeek, start: a.startTime, end: a.endTime }))));
  console.log('Approved home providers:', client.approvedHomeProviders.length);
  for (const ah of client.approvedHomeProviders) {
    const p = ah.provider;
    console.log('  Provider:', p.firstName, p.lastName, '|', p.position);
    console.log('  Avail:', JSON.stringify(p.availability.map((a: { dayOfWeek: string; startTime: string; endTime: string }) => ({ day: a.dayOfWeek, start: a.startTime, end: a.endTime }))));
  }

  // Next week proposals
  const weekStart = new Date('2026-04-06T04:00:00Z');
  const weekEnd = new Date('2026-04-13T04:00:00Z');
  const proposals = await prisma.proposedSession.findMany({
    where: { clientId: client.id, startTime: { gte: weekStart, lt: weekEnd } },
    select: { startTime: true, endTime: true, status: true, reasoning: true, providerId: true },
    orderBy: { startTime: 'asc' },
  });
  console.log('\nNext week proposals:', proposals.length);
  for (const p of proposals) {
    const hrs = (p.endTime.getTime() - p.startTime.getTime()) / 3600000;
    const day = p.startTime.toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'long' });
    console.log(' ', day, `${hrs}h`, p.status, p.reasoning?.slice(0, 100) ?? '');
  }
  await prisma.$disconnect();
}
main().catch(console.error);
