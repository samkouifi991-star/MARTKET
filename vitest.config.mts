import { defineConfig } from "vitest/config";
import path from "path";
import { fileURLToPath } from "url";

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(dirname, "./src"),
      // Matches Next's own server-bundle resolution (see server-only's
      // package.json "react-server" export condition) — under plain Node,
      // server-only's default export unconditionally throws, which would
      // break any test importing a module marked `import "server-only"`.
      "server-only": path.resolve(dirname, "./node_modules/server-only/empty.js"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
