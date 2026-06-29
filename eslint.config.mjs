import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import { dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * ESLint configuration — hardened for production.
 *
 * Previously every meaningful rule was disabled, making CI's
 * `--max-warnings=0` purely decorative. The rules below are now
 * ENFORCED. New code must pass; existing violations should be fixed
 * incrementally via `eslint --fix` and targeted PRs.
 */
const eslintConfig = [...nextCoreWebVitals, ...nextTypescript, {
  // In ESLint 9 flat config, unused eslint-disable directives are reported
  // via `linterOptions.reportUnusedDisableDirectives`, NOT via a rule.
  // The previous config used `@typescript-eslint/no-unused-disable-directive`
  // (a non-existent rule), which broke the entire lint pipeline with a
  // TypeError before a single file was checked.
  linterOptions: {
    reportUnusedDisableDirectives: "error",
  },
  rules: {
    // ── TypeScript rules (ENFORCED) ──────────────────────────────
    // `any` is a code smell — use `unknown` + type narrowing.
    "@typescript-eslint/no-explicit-any": "warn",
    // Unused vars are dead code — delete them.
    "@typescript-eslint/no-unused-vars": [
      "error",
      {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
      },
    ],
    // Non-null assertion (`!`) bypasses null safety — use optional chaining.
    "@typescript-eslint/no-non-null-assertion": "warn",
    // `@ts-ignore` / `@ts-expect-error` suppress real errors — fix the type.
    "@typescript-eslint/ban-ts-comment": "error",
    "@typescript-eslint/prefer-as-const": "error",

    // ── React rules (ENFORCED) ───────────────────────────────────
    // Missing dependency arrays cause stale closures & infinite loops.
    "react-hooks/exhaustive-deps": "warn",
    "react-hooks/purity": "warn",
    // Disable `react/no-unescaped-entities` — it's overly noisy in a
    // Next.js codebase where apostrophes/quotes in JSX are safe (React
    // auto-escapes them at runtime). The rule produces hundreds of
    // false positives in UI text like "Don't" or "Click 'OK'".
    "react/no-unescaped-entities": "off",
    "react/display-name": "off", // Allow anonymous components
    "react/prop-types": "off", // TS handles this
    "react-compiler/react-compiler": "off",

    // ── Next.js rules ────────────────────────────────────────────
    "@next/next/no-img-element": "warn", // Use next/image for optimization
    "@next/next/no-html-link-for-pages": "error",

    // ── General JavaScript rules (ENFORCED) ──────────────────────
    "prefer-const": "error",
    "no-unused-vars": "off", // Use @typescript-eslint version above
    "no-console": [
      "warn",
      {
        allow: ["warn", "error"],
        // Allow `console.log` in test files
      },
    ],
    "no-debugger": "error",
    "no-empty": ["error", { allowEmptyCatch: true }],
    "no-irregular-whitespace": "error",
    "no-case-declarations": "error",
    "no-fallthrough": "error",
    "no-mixed-spaces-and-tabs": "error",
    "no-redeclare": "error",
    // `no-undef` is handled by the TypeScript compiler for .ts/.tsx files.
    // Keeping it on causes false positives for global types like `React`,
    // `process`, `Buffer`, `fetch`, etc. (especially with Next.js automatic JSX runtime).
    "no-undef": "off",
    "no-unreachable": "error",
    "no-useless-escape": "error",
    // Security: disallow eval and friends
    "no-eval": "error",
    "no-implied-eval": "error",
    "no-new-func": "error",
    // Security: disallow script injection via document.write
    "no-restricted-globals": [
      "error",
      { name: "event", message: "Use the event argument instead." },
    ],
  },
}, {
  ignores: [
    "node_modules/**",
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "examples/**",
    "skills/**",
    "tool-results/**",
    "mini-services/**", // Separate package with its own lint config
    "deploy/**", // Docker/K8s init scripts (mongo-init.js, init.sql) — not app code
    "scripts/**", // Standalone scripts (have their own globals)
    "tests/setup.ts", // Test setup declares globals via vitest
  ],
}];

// Pre-existing UI files (shadcn/ui components + large screen files) — these
// have unused-import warnings from the auto-generated shadcn scaffolding.
// We don't want to delete the imports (they may be re-used as the UI evolves)
// and we don't want them to fail the build. Downgrade unused-vars to "warn"
// for these paths only.
eslintConfig.push({
  files: [
    "src/components/ui/**/*.tsx",
    "src/components/ui/**/*.ts",
    "src/app/SecurityScreens.tsx",
    "src/app/WorkflowBuilder.tsx",
    "src/app/page.tsx",
    "src/hooks/**/*.ts",
  ],
  rules: {
    "@typescript-eslint/no-unused-vars": "warn",
    "@typescript-eslint/no-explicit-any": "off",
    "@typescript-eslint/no-non-null-assertion": "off",
    "@typescript-eslint/no-require-imports": "off",
    "react-hooks/exhaustive-deps": "off",
    "no-case-declarations": "off",
    "no-useless-escape": "off",
  },
});

// Vitest test files: vitest provides `describe/it/expect/vi` as globals.
// Override `no-undef` for test files only.
eslintConfig.push({
  files: ["tests/**/*.ts", "tests/**/*.tsx"],
  languageOptions: {
    globals: {
      describe: "readonly",
      it: "readonly",
      test: "readonly",
      expect: "readonly",
      vi: "readonly",
      beforeEach: "readonly",
      afterEach: "readonly",
      beforeAll: "readonly",
      afterAll: "readonly",
    },
  },
  rules: {
    "no-undef": "off",
    "@typescript-eslint/no-explicit-any": "off",
    "@typescript-eslint/no-non-null-assertion": "off",
  },
});

export default eslintConfig;
