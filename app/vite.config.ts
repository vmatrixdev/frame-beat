/// <reference types="vitest" />
import { defineConfig, Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";

function amvEngineVitePlugin(): Plugin {
  return {
    name: "amv-engine-dev-api",
    configureServer(server) {
      server.middlewares.use("/api/analyze-soundtrack", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          return res.end();
        }
        const chunks: Buffer[] = [];
        req.on("data", (chunk: Buffer) => chunks.push(chunk));
        req.on("end", async () => {
          try {
            const buffer = Buffer.concat(chunks);
            const projectRoot = path.resolve(__dirname, "..");
            const exportDir = path.join(projectRoot, "export");
            fs.mkdirSync(exportDir, { recursive: true });
            const tempUpload = path.join(exportDir, "browser_upload_audio.mp3");
            fs.writeFileSync(tempUpload, buffer);

            const pythonBin = path.join(projectRoot, "engine", ".venv", "bin", "python");
            const scriptPath = path.join(projectRoot, "engine", "main.py");
            const proc = spawn(pythonBin, [scriptPath, "analyze-soundtrack", tempUpload], {
              cwd: projectRoot,
              env: { ...process.env, PYTHONPATH: projectRoot },
            });

            let stdout = "";
            let stderr = "";
            proc.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
            proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()));

            proc.on("close", (code: number) => {
              if (code === 0 && stdout.trim()) {
                res.setHeader("Content-Type", "application/json");
                res.end(stdout);
              } else {
                res.statusCode = 500;
                res.end(JSON.stringify({ error: stderr || "Analysis failed" }));
              }
            });
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            res.statusCode = 500;
            res.end(JSON.stringify({ error: msg }));
          }
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), amvEngineVitePlugin()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  envPrefix: ["VITE_", "TAURI_"],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
  },
});
