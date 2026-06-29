// Async handler wrapper — catches promise rejections and forwards to next()
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// Generate a simple ID (for in-memory mode)
export function genId(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// Pagination helper
export function paginate(arr, page = 1, limit = 50) {
  const p = Math.max(1, Number(page) || 1);
  const l = Math.min(200, Math.max(1, Number(limit) || 50));
  const start = (p - 1) * l;
  return {
    data: arr.slice(start, start + l),
    page: p,
    limit: l,
    total: arr.length,
    pages: Math.ceil(arr.length / l),
  };
}
