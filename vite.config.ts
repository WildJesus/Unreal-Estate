import { defineConfig, type Plugin } from "vite";
import { resolve } from "path";
import { copyFileSync, cpSync, mkdirSync } from "fs";

function copyExtensionFiles(): Plugin {
  return {
    name: "copy-extension-files",
    closeBundle() {
      // Copy manifest.json into dist/
      copyFileSync(
        resolve(__dirname, "manifest.json"),
        resolve(__dirname, "dist/manifest.json")
      );
      // Copy data/ folder into dist/data/
      mkdirSync(resolve(__dirname, "dist/data"), { recursive: true });
      cpSync(
        resolve(__dirname, "data"),
        resolve(__dirname, "dist/data"),
        { recursive: true }
      );
      // Copy icons/ folder into dist/icons/
      mkdirSync(resolve(__dirname, "dist/icons"), { recursive: true });
      cpSync(
        resolve(__dirname, "icons"),
        resolve(__dirname, "dist/icons"),
        { recursive: true }
      );
    },
  };
}

export default defineConfig({
  plugins: [copyExtensionFiles()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        content: resolve(__dirname, "src/content.ts"),
        background: resolve(__dirname, "src/background.ts"),
        sidebar: resolve(__dirname, "src/sidebar/sidebar.ts"),
      },
      output: {
        entryFileNames: "[name].js",
        assetFileNames: "[name].[ext]",
        // ES modules — Vite bundles all deps inline so output files are
        // self-contained, which is what Chrome content scripts require.
        format: "es",
      },
    },
  },
});
