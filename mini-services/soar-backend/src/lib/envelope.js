/** SOAR API response envelope — matches Next.js src/lib/soar-api/envelope.ts */

export function soarOk(res, data, message, status = 200) {
  return res.status(status).json({
    success: true,
    data,
    ...(message ? { message } : {}),
  });
}

export function soarErr(res, message, status = 400) {
  return res.status(status).json({
    success: false,
    message,
    error: message,
  });
}

export function paginated(items, page, limit, total, listKey = 'items') {
  return {
    [listKey]: items,
    items,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}

export function queryPageLimit(query) {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
  return { page, limit, skip: (page - 1) * limit };
}
