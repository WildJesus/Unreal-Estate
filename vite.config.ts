import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        content: resolve(__dirname, "src/content.ts"),
        sidebar: resolve(__dirname, "src/sidebar/sidebar.ts"),
      },
      output: {
        entryFileNames: "[name].js",
        assetFileNames: "[name].[ext]",
        // No code splitting — content scripts must be single files
        inlineDynamicImports: false,
        format: "iife",
      },
    },
  },
});
