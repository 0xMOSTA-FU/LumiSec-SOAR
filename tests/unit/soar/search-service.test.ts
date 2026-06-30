import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: {
    case: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
    alert: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    soarArtifact: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    integration: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}));

describe('globalSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty buckets for short query', async () => {
    const { globalSearch } = await import('@/lib/soar-api/search-service');
    const result = await globalSearch({}, 'a');
    expect(result.incidents).toEqual([]);
    expect(result.alerts).toEqual([]);
  });

  it('queries all entity types for valid query', async () => {
    const { db } = await import('@/lib/db');
    const { globalSearch } = await import('@/lib/soar-api/search-service');
    await globalSearch({}, 'malware', 10);
    expect(db.case.findMany).toHaveBeenCalled();
    expect(db.alert.findMany).toHaveBeenCalled();
    expect(db.soarArtifact.findMany).toHaveBeenCalled();
    expect(db.integration.findMany).toHaveBeenCalled();
  });
});
