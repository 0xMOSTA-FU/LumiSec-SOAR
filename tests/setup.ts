/**
 * Vitest global setup — runs before all test files.
 * Ensures env vars + MongoDB mock are in place.
 */
(process.env as Record<string, string>).NODE_ENV = 'test';
(process.env as Record<string, string>).LOG_LEVEL = 'error';
(process.env as Record<string, string>).MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/soar-test';
(process.env as Record<string, string>).MONGODB_DB = process.env.MONGODB_DB || 'soar-test';
(process.env as Record<string, string>).ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'a'.repeat(64);
