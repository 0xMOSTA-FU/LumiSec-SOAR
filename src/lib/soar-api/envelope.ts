import { NextResponse } from 'next/server';

export function soarOk<T>(data: T, message?: string, status = 200) {
  return NextResponse.json(
    { success: true, data, ...(message ? { message } : {}) },
    { status },
  );
}

export function soarErr(message: string, status = 400, error?: string) {
  return NextResponse.json(
    { success: false, message, error: error || message },
    { status },
  );
}

export function parseJson<T>(val: string | null | undefined, fallback: T): T {
  try {
    return JSON.parse(val || JSON.stringify(fallback)) as T;
  } catch {
    return fallback;
  }
}

export function paginated<T>(
  items: T[],
  page: number,
  limit: number,
  total: number,
  listKey = 'items',
) {
  const payload: Record<string, unknown> = {
    [listKey]: items,
    items,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
  return payload;
}

export function queryPageLimit(searchParams: URLSearchParams) {
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const limit = Math.min(100, Math.max(1, Number(searchParams.get('limit')) || 20));
  return { page, limit, skip: (page - 1) * limit };
}
