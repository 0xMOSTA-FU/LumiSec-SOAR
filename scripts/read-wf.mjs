import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();
const wf = await db.workflow.findUnique({ where: { id: 'wf-1' } });
const n2 = JSON.parse(wf.nodes).find((n) => n.id === 'n2');
console.log(JSON.stringify(n2?.data?.config, null, 2));
await db.$disconnect();
