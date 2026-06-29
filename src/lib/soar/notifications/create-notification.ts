import { db } from '@/lib/db';

export async function createSoarNotification(params: {
  tenantId?: string | null;
  userId?: string | null;
  title: string;
  message: string;
}): Promise<void> {
  await db.soarNotification.create({
    data: {
      tenantId: params.tenantId ?? null,
      userId: params.userId ?? null,
      title: params.title,
      message: params.message,
    },
  });
}
