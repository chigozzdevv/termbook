import js from "@eslint/js";
import ts from "typescript-eslint";

export default ts.config(
  { ignores: ["**/dist/**", "**/out/**", "**/cache/**", "**/lib/**", "contracts/lib/**"] },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    files: ["contracts/solana/scripts/*.mjs"],
    languageOptions: { globals: { Buffer: "readonly", console: "readonly", fetch: "readonly",
      process: "readonly", setTimeout: "readonly" } },
  },
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
);
