import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [tailwindcss(), viteSingleFile()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "esnext",
    minify: true,
    rollupOptions: {
      input: "mcp-app.html",
    },
  },
  root: ".",
});
