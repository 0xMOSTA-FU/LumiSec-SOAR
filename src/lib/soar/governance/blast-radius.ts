/**
 * Blast-radius controls — limit automated containment per hour.
 */
import { db } from '@/lib/db';

const HOURLY_LIMITS: Record<string, number> = {
  block_ip: Number(process.env.SOAR_MAX_BLOCKS_PER_HOUR || 20),
  isolate_host: Number(process.env.SOAR_MAX_ISOLATIONS_PER_HOUR || 10),
  disable_user: Number(process.env.SOAR_MAX_DISABLE_USER_PER_HOUR || 10),
  'incident.respond.block_ip': Number(process.env.SOAR_MAX_BLOCKS_PER_HOUR || 20),
  'incident.respond.isolate_host': Number(process.env.SOAR_MAX_ISOLATIONS_PER_HOUR || 10),
  'incident.respond.disable_user': Number(process.env.SOAR_MAX_DISABLE_USER_PER_HOUR || 10),
};

export interface BlastRadiusResult {
  allowed: boolean;
  count?: number;
  limit?: number;
  reason?: string;
}

export async function checkBlastRadius(
  auditAction: string,
  tenantId?: string | null,
): Promise<BlastRadiusResult> {
  const limit = HOURLY_LIMITS[auditAction];
  if (!limit || !Number.isFinite(limit)) return { allowed: true };

  const since = new Date(Date.now() - 3600_000);
  const count = await db.auditLog.count({
    where: {
      ...(tenantId ? { tenantId } : {}),
      action: auditAction,
      createdAt: { gte: since },
    },
  });

  if (count >= limit) {
    return {
      allowed: false,
      count,
      limit,
      reason: `Hourly blast-radius limit reached (${count}/${limit}) for ${auditAction}`,
    };
  }

  return { allowed: true, count, limit };
}
