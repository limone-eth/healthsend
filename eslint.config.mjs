import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Fleet and agent worktrees live inside this checkout and are separate
    // copies of the repo. Linting them reports another session's in-progress
    // code as a failure in ours.
    ".claude/worktrees/**",
    ".fleet/**",
  ]),
]);

export default eslintConfig;
