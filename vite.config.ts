import { resolve } from "node:path";
import { defineConfig } from "vite";
import handlebars from "vite-plugin-handlebars";

const src = resolve(import.meta.dirname, "src");

// The pages live in `src/`; Tauri expects a fixed dev port and serves the built files from `dist`.
export default defineConfig({
  root: src,
  clearScreen: false,
  // `{{> name}}` in a page pastes `src/html/name.html` at build time: the output is still one HTML file per window.
  plugins: [handlebars({ partialDirectory: resolve(src, "html") })],
  server: { port: 1420, strictPort: true, watch: { ignored: ["**/src-tauri/**", "**/target/**"] } },
  build: {
    target: "es2022",
    outDir: resolve(import.meta.dirname, "dist"),
    // `dist` is outside the root now, so Vite only empties it when told to.
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(src, "index.html"),
        update: resolve(src, "update.html"),
      },
    },
  },
});
