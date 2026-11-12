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
      // Stream uploaded browser-dropped files into cache/library/<batchId>/<filename>
      server.middlewares.use("/api/upload-library-file", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          return res.end();
        }
        try {
          const urlObj = new URL(req.url || "", "http://localhost:1420");
          const rawBatch = urlObj.searchParams.get("batchId") || "default";
          const rawName = urlObj.searchParams.get("filename") || "media.bin";
          const safeBatch = rawBatch.replace(/[^a-zA-Z0-9_-]/g, "_");
          const safeName = path.basename(rawName).replace(/[/\\]/g, "_");

          const projectRoot = path.resolve(__dirname, "..");
          const batchDir = path.join(projectRoot, "cache", "library", safeBatch);
          fs.mkdirSync(batchDir, { recursive: true });
          const destPath = path.join(batchDir, safeName);

          const writeStream = fs.createWriteStream(destPath);
          req.pipe(writeStream);
          writeStream.on("finish", () => {
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: true, path: destPath, batchDir }));
          });
          writeStream.on("error", (err) => {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: err.message }));
          });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          res.statusCode = 500;
          res.end(JSON.stringify({ error: msg }));
        }
      });

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
              const jsonStart = stdout.indexOf("{");
              const cleanJson = jsonStart >= 0 ? stdout.slice(jsonStart) : "";
              if (code === 0 && cleanJson.trim()) {
                res.setHeader("Content-Type", "application/json");
                res.end(cleanJson);
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

      // Stream local media files (MP4/WebM/MOV/JPG/PNG) with Range support for HTML5 video
      server.middlewares.use("/api/media-stream", (req, res) => {
        try {
          const urlObj = new URL(req.url || "", "http://localhost:1420");
          let filePath = urlObj.searchParams.get("path") || "";
          if (!filePath) {
            res.statusCode = 400;
            return res.end("Missing path parameter");
          }
          if (filePath.startsWith("~")) {
            filePath = path.join(os.homedir(), filePath.slice(1));
          }
          if (!fs.existsSync(filePath)) {
            res.statusCode = 404;
            return res.end("File not found on disk");
          }

          const stat = fs.statSync(filePath);
          const ext = path.extname(filePath).toLowerCase();
          const mimeTypes: Record<string, string> = {
            ".mp4": "video/mp4",
            ".m4v": "video/mp4",
            ".webm": "video/webm",
            ".mov": "video/quicktime",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".png": "image/png",
            ".webp": "image/webp",
            ".mp3": "audio/mpeg",
            ".wav": "audio/wav",
          };
          const contentType = mimeTypes[ext] || "application/octet-stream";
          const range = req.headers.range;

          if (range) {
            const parts = range.replace(/bytes=/, "").split("-");
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
            const chunksize = end - start + 1;
            const file = fs.createReadStream(filePath, { start, end });
            res.writeHead(206, {
              "Content-Range": `bytes ${start}-${end}/${stat.size}`,
              "Accept-Ranges": "bytes",
              "Content-Length": chunksize,
              "Content-Type": contentType,
            });
            file.pipe(res);
          } else {
            res.writeHead(200, {
              "Content-Length": stat.size,
              "Content-Type": contentType,
            });
            fs.createReadStream(filePath).pipe(res);
          }
        } catch (e) {
          res.statusCode = 500;
          res.end(String(e));
        }
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
