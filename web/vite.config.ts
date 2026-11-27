import { cpSync, existsSync, statSync, createReadStream } from "node:fs";
import { join, resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";

const ROOT = resolve(import.meta.dirname, "..");
const DATA = join(ROOT, "data");

// I dati generati dalle pipeline (data/) stanno alla radice del repo perché li scrivono le
// GitHub Actions. In sviluppo li servo da lì; nella build li copio in dist/data.
function dataDir(): Plugin {
  return {
    name: "pieno-furbo-data",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const m = /^\/(?:carburanti\/)?data\/([^?#]*)/.exec(req.url ?? "");
        if (!m) return next();
        const file = join(DATA, decodeURIComponent(m[1]!));
        if (!file.startsWith(DATA) || !existsSync(file) || !statSync(file).isFile()) return next();
        if (file.endsWith(".json")) res.setHeader("Content-Type", "application/json");
        if (file.endsWith(".svg")) res.setHeader("Content-Type", "image/svg+xml");
        createReadStream(file).pipe(res);
      });
    },
    closeBundle() {
      cpSync(DATA, join(ROOT, "dist", "data"), { recursive: true });
    },
  };
}

export default defineConfig({
  root: import.meta.dirname,
  // Pubblicata su https://rampagab.github.io/pienofurbo/ (base relativa: funziona con qualsiasi percorso)
  base: "./",
  publicDir: "public",
  plugins: [dataDir()],
  build: {
    outDir: join(ROOT, "dist"),
    emptyOutDir: true,
    target: "es2022",
  },
  server: { port: 8765, strictPort: true },
  preview: { port: 8765, strictPort: true },
});
