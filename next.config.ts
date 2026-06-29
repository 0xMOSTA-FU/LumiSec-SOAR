import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

/**
 * Security headers applied to every response.
 * Dev: allow unsafe-eval + ws for Next.js webpack HMR.
 * Prod: stricter CSP (no unsafe-eval).
 */
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "geolocation=(), microphone=(), camera=(), payment=(), usb=()",
  },
  ...(isDev
    ? []
    : [{
        key: "Strict-Transport-Security",
        value: "max-age=63072000; includeSubDomains; preload",
      }]),
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      isDev
        ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
        : "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' data: https://fonts.gstatic.com",
      "img-src 'self' data: https: blob:",
      isDev
        ? "connect-src 'self' https: http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:* wss://localhost:* wss://127.0.0.1:*"
        : "connect-src 'self' https:",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  output: "standalone",
  // CRITICAL FIX (AUDIT P0): Do NOT ignore TypeScript errors.
  // Previously `ignoreBuildErrors: true` shipped broken TS to production.
  // Now the build will fail on any type error, forcing engineers to fix them.
  typescript: {
    ignoreBuildErrors: false,
  },
  // Re-enable React StrictMode for dev-time safety checks.
  reactStrictMode: true,
  // Security headers — applied to every route.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
      // Health endpoint: no-store to prevent probe caching
      {
        source: "/api/health",
        headers: [{ key: "Cache-Control", value: "no-store, max-age=0" }],
      },
      // Metrics endpoint: no-store (Prometheus requires fresh data)
      {
        source: "/api/metrics",
        headers: [{ key: "Cache-Control", value: "no-store, max-age=0" }],
      },
    ];
  },
  // Allow preview domains (e.g. preview-chat-*.space-z.ai) to load /_next/*
  // resources during development. Without this, the browser blocks
  // cross-origin requests to JS chunks, hydration never runs, and the page
  // is stuck on the invisible SSR loading screen (looks like a blank page).
  allowedDevOrigins: [
    "*.space-z.ai",
    "preview-chat-*.space-z.ai",
    "preview-*.space-z.ai",
    "localhost",
    "127.0.0.1",
  ],
};

export default nextConfig;
