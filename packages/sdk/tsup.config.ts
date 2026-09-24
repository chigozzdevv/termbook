import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  define: { "process.env.TERMBOOK_PUBLIC_API_BASE": JSON.stringify(process.env["TERMBOOK_PUBLIC_API_BASE"] ?? "") },
});
