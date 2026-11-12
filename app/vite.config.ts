/// <reference types="vitest" />
import { defineConfig, Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

function amvEngineVitePlugin(): Plugin {
  return {
    name: "amv-engine-dev-api",
    configureServer(server) {
      // API to run scene detection on any local directory path
      server.middlewares.use("/api/analyze-scenes", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          return res.end();
        }
        const chunks: Buffer[] = [];
        req.on("data", (chunk: Buffer) => chunks.push(chunk));
        req.on("end", async () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
            let dirPath = body.dirPath || "";
            if (!dirPath) {
              res.statusCode = 400;
              return res.end(JSON.stringify({ error: "dirPath is required" }));
            }
            const projectRoot = path.resolve(__dirname, "..");
            if (dirPath.startsWith("~")) {
              dirPath = path.join(os.homedir(), dirPath.slice(1));
            } else if (!path.isAbsolute(dirPath)) {
              dirPath = path.resolve(projectRoot, dirPath);
            }
            dirPath = path.resolve(dirPath);

            if (!fs.existsSync(dirPath)) {
              res.statusCode = 404;
              return res.end(JSON.stringify({ error: `Directory not found: ${dirPath}` }));
            }

            const pythonBin = path.join(projectRoot, "engine", ".venv", "bin", "python");
            const scriptPath = path.join(projectRoot, "engine", "main.py");
            const thumbsDir = path.join(projectRoot, "cache", "thumbnails");
            fs.mkdirSync(thumbsDir, { recursive: true });

            const proc = spawn(pythonBin, [scriptPath, "analyze-scenes", dirPath, "--thumbs", thumbsDir], {
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
                res.end(JSON.stringify({ error: stderr || "Scene analysis failed" }));
              }
            });
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            res.statusCode = 500;
            res.end(JSON.stringify({ error: msg }));
          }
        });
      });

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

      // Serve cache/thumbnails for keyframe previews in browser
      server.middlewares.use("/cache/thumbnails", (req, res, next) => {
        const projectRoot = path.resolve(__dirname, "..");
        const thumbName = path.basename(req.url || "");
        const thumbPath = path.join(projectRoot, "cache", "thumbnails", thumbName);
        if (fs.existsSync(thumbPath)) {
          res.setHeader("Content-Type", "image/jpeg");
          return fs.createReadStream(thumbPath).pipe(res);
        }
        next();
      });

      // API to fetch analyzed scenes (e.g. personal_scenes.json)
      server.middlewares.use("/api/get-analyzed-scenes", (req, res) => {
        const projectRoot = path.resolve(__dirname, "..");
        const scenesFile = path.join(projectRoot, "export", "personal_scenes.json");
        if (fs.existsSync(scenesFile)) {
          res.setHeader("Content-Type", "application/json");
          return fs.createReadStream(scenesFile).pipe(res);
        }
        res.statusCode = 404;
        res.end(JSON.stringify({ error: "No personal_scenes.json found" }));
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
