/**
 * Remove leftover demo/seed operational data from SQLite.
 * Keeps: tenants, users, roles, permissions, API keys, attack pattern catalog.
 * Run: npm run db:purge
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function purge() {
  const before = {
    alerts: await prisma.alert.count(),
    cases: await prisma.case.count(),
    workflows: await prisma.workflow.count(),
    playbooks: await prisma.playbook.count(),
    integrations: await prisma.integration.count(),
    vault: await prisma.vaultSecret.count(),
    webhooks: await prisma.webhookSource.count(),
  };

  console.log('Before purge:', before);

  await prisma.$transaction([
    prisma.connectorCall.deleteMany(),
    prisma.soarNotification.deleteMany(),
    prisma.soarArtifact.deleteMany(),
    prisma.alertAttackPattern.deleteMany(),
    prisma.caseAttackPattern.deleteMany(),
    prisma.evidence.deleteMany(),
    prisma.approvalStep.deleteMany(),
    prisma.approval.deleteMany(),
    prisma.alert.deleteMany(),
    prisma.case.deleteMany(),
    prisma.workflowExecution.deleteMany(),
    prisma.playbook.deleteMany(),
    prisma.workflow.deleteMany(),
    prisma.integration.deleteMany(),
    prisma.vaultSecret.deleteMany(),
    prisma.webhookSource.deleteMany(),
  ]);

  const after = {
    alerts: await prisma.alert.count(),
    cases: await prisma.case.count(),
    workflows: await prisma.workflow.count(),
    playbooks: await prisma.playbook.count(),
    integrations: await prisma.integration.count(),
    vault: await prisma.vaultSecret.count(),
    webhooks: await prisma.webhookSource.count(),
    users: await prisma.user.count(),
    tenants: await prisma.tenant.count(),
  };

  console.log('After purge:', after);
  console.log('Operational data cleared. Ingest alerts via SIEM, webhooks, or connectors.');
}

purge()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
