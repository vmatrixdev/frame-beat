/// <reference types="vitest" />
import { defineConfig, Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

function resolveProjectCacheDir(projectRoot: string, projectId?: string | null): string {
  if (projectId && projectId.trim()) {
    const safeId = projectId.trim().replace(/[^a-zA-Z0-9_-]/g, "_");
    return path.join(projectRoot, "projects", safeId);
  }
  return path.join(projectRoot, "cache");
}

function readJsonIfExists<T>(filePath: string): T | null {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
    }
  } catch {
    // ignore corrupt/partial files
  }
  return null;
}

function amvEngineVitePlugin(): Plugin {
  return {
    name: "amv-engine-dev-api",
    configureServer(server) {
      // Project CRUD endpoints (projects/<id>/)
      server.middlewares.use("/api/projects/create", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          return res.end();
        }
        const chunks: Buffer[] = [];
        req.on("data", (chunk: Buffer) => chunks.push(chunk));
        req.on("end", () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
            const rawName = String(body.name || "Untitled Project").trim() || "Untitled Project";
            const slugBase = rawName
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "-")
              .replace(/^-+|-+$/g, "") || "project";
            const projectRoot = path.resolve(__dirname, "..");
            const projectsRoot = path.join(projectRoot, "projects");
            fs.mkdirSync(projectsRoot, { recursive: true });

            let projectId = slugBase;
            let suffix = 2;
            while (fs.existsSync(path.join(projectsRoot, projectId))) {
              projectId = `${slugBase}-${suffix++}`;
            }

            const projDir = path.join(projectsRoot, projectId);
            fs.mkdirSync(projDir, { recursive: true });
            const now = new Date().toISOString();
            const meta = {
              id: projectId,
              name: rawName,
              created_at: now,
              updated_at: now,
              audio_file: null,
              user_prompt: "",
              audio_notes: [],
            };
            fs.writeFileSync(path.join(projDir, "project.json"), JSON.stringify(meta, null, 2));
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ project: { ...meta, beats: null, scenes: null, timeline: null } }));
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            res.statusCode = 500;
            res.end(JSON.stringify({ error: msg }));
          }
        });
      });

      server.middlewares.use("/api/projects/load", (req, res) => {
        if (req.method !== "GET") {
          res.statusCode = 405;
          return res.end();
        }
        try {
          const urlObj = new URL(req.url || "", "http://localhost:1420");
          const rawId = urlObj.searchParams.get("id") || "";
          const safeId = rawId.trim().replace(/[^a-zA-Z0-9_-]/g, "_");
          if (!safeId) {
            res.statusCode = 400;
            return res.end(JSON.stringify({ error: "id is required" }));
          }
          const projectRoot = path.resolve(__dirname, "..");
          const projDir = path.join(projectRoot, "projects", safeId);
          const metaPath = path.join(projDir, "project.json");
          if (!fs.existsSync(metaPath)) {
            res.statusCode = 404;
            return res.end(JSON.stringify({ error: `Project '${safeId}' not found` }));
          }
          const meta = readJsonIfExists<Record<string, unknown>>(metaPath) || { id: safeId, name: safeId };
          const beats = readJsonIfExists(path.join(projDir, "beats.json"));
          const scenes = readJsonIfExists(path.join(projDir, "scenes.json"));
          const timeline = readJsonIfExists(path.join(projDir, "timeline.json"));
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ project: { ...meta, beats, scenes, timeline } }));
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          res.statusCode = 500;
          res.end(JSON.stringify({ error: msg }));
        }
      });

      server.middlewares.use("/api/projects/save", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          return res.end();
        }
        const chunks: Buffer[] = [];
        req.on("data", (chunk: Buffer) => chunks.push(chunk));
        req.on("end", () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
            const safeId = String(body.id || "").trim().replace(/[^a-zA-Z0-9_-]/g, "_");
            if (!safeId) {
              res.statusCode = 400;
              return res.end(JSON.stringify({ error: "id is required" }));
            }
            const projectRoot = path.resolve(__dirname, "..");
            const projDir = path.join(projectRoot, "projects", safeId);
            fs.mkdirSync(projDir, { recursive: true });

            const metaPath = path.join(projDir, "project.json");
            const existing = readJsonIfExists<Record<string, unknown>>(metaPath) || {};
            const now = new Date().toISOString();
            const meta = {
              id: safeId,
              name: String(body.name || existing.name || safeId),
              created_at: String(existing.created_at || now),
              updated_at: now,
              audio_file: body.audio_file !== undefined ? body.audio_file : existing.audio_file ?? null,
              user_prompt: body.user_prompt !== undefined ? body.user_prompt : existing.user_prompt ?? "",
              audio_notes: body.audio_notes !== undefined ? body.audio_notes : existing.audio_notes ?? [],
            };
            fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));

            if (body.beats !== undefined) {
              if (body.beats === null) {
                fs.rmSync(path.join(projDir, "beats.json"), { force: true });
              } else {
                fs.writeFileSync(path.join(projDir, "beats.json"), JSON.stringify(body.beats, null, 2));
              }
            }
            if (body.scenes !== undefined) {
              if (body.scenes === null) {
                fs.rmSync(path.join(projDir, "scenes.json"), { force: true });
              } else {
                fs.writeFileSync(path.join(projDir, "scenes.json"), JSON.stringify(body.scenes, null, 2));
              }
            }
            if (body.timeline !== undefined) {
              if (body.timeline === null) {
                fs.rmSync(path.join(projDir, "timeline.json"), { force: true });
              } else {
                fs.writeFileSync(path.join(projDir, "timeline.json"), JSON.stringify(body.timeline, null, 2));
              }
            }

            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: true, updated_at: now }));
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            res.statusCode = 500;
            res.end(JSON.stringify({ error: msg }));
          }
        });
      });

      server.middlewares.use("/api/projects/delete", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          return res.end();
        }
        const chunks: Buffer[] = [];
        req.on("data", (chunk: Buffer) => chunks.push(chunk));
        req.on("end", () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
            const safeId = String(body.id || "").trim().replace(/[^a-zA-Z0-9_-]/g, "_");
            if (!safeId) {
              res.statusCode = 400;
              return res.end(JSON.stringify({ error: "id is required" }));
            }
            const projectRoot = path.resolve(__dirname, "..");
            const projDir = path.join(projectRoot, "projects", safeId);
            if (fs.existsSync(projDir)) {
              fs.rmSync(projDir, { recursive: true, force: true });
            }
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: true }));
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            res.statusCode = 500;
            res.end(JSON.stringify({ error: msg }));
          }
        });
      });

      server.middlewares.use("/api/projects", (req, res, next) => {
        const pathname = (req.url || "").split("?")[0];
        if (pathname && pathname !== "/") {
          return next();
        }
        if (req.method !== "GET") {
          res.statusCode = 405;
          return res.end();
        }
        try {
          const projectRoot = path.resolve(__dirname, "..");
          const projectsRoot = path.join(projectRoot, "projects");
          fs.mkdirSync(projectsRoot, { recursive: true });
          const entries = fs.readdirSync(projectsRoot, { withFileTypes: true });
          const projects = entries
            .filter((d) => d.isDirectory())
            .map((d) => {
              const projDir = path.join(projectsRoot, d.name);
              const meta = readJsonIfExists<Record<string, unknown>>(path.join(projDir, "project.json"));
              if (!meta) return null;
              const scenes = readJsonIfExists<{ total_scenes?: number; scenes?: unknown[] }>(
                path.join(projDir, "scenes.json")
              );
              const sceneCount = scenes?.total_scenes ?? scenes?.scenes?.length ?? 0;
              return {
                id: String(meta.id || d.name),
                name: String(meta.name || d.name),
                created_at: String(meta.created_at || ""),
                updated_at: String(meta.updated_at || meta.created_at || ""),
                scene_count: sceneCount,
                has_audio: Boolean(meta.audio_file) || fs.existsSync(path.join(projDir, "beats.json")),
                has_timeline: fs.existsSync(path.join(projDir, "timeline.json")),
              };
            })
            .filter((p): p is NonNullable<typeof p> => p !== null)
            .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ projects }));
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          res.statusCode = 500;
          res.end(JSON.stringify({ error: msg }));
        }
      });

      // Stream uploaded browser-dropped files into projects/<id>/media/<filename> or cache/library/<batchId>/<filename>
      server.middlewares.use("/api/upload-library-file", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          return res.end();
        }
        try {
          const urlObj = new URL(req.url || "", "http://localhost:1420");
          const projectId = urlObj.searchParams.get("projectId");
          const rawBatch = urlObj.searchParams.get("batchId") || "default";
          const rawName = urlObj.searchParams.get("filename") || "media.bin";
          const expectedSize = Number(urlObj.searchParams.get("size") || "-1");
          const safeBatch = rawBatch.replace(/[^a-zA-Z0-9_-]/g, "_");
          const safeName = path.basename(rawName).replace(/[/\\]/g, "_");

          const projectRoot = path.resolve(__dirname, "..");
          const batchDir = projectId
            ? path.join(resolveProjectCacheDir(projectRoot, projectId), "media")
            : path.join(projectRoot, "cache", "library", safeBatch);
          fs.mkdirSync(batchDir, { recursive: true });
          const destPath = path.join(batchDir, safeName);

          if (expectedSize > 0 && fs.existsSync(destPath)) {
            const stat = fs.statSync(destPath);
            if (stat.size === expectedSize) {
              req.resume();
              res.setHeader("Content-Type", "application/json");
              return res.end(JSON.stringify({ ok: true, path: destPath, batchDir, reused: true }));
            }
          }

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
            const cacheDir = resolveProjectCacheDir(projectRoot, body.projectId);
            const thumbsDir = path.join(cacheDir, "thumbnails");
            fs.mkdirSync(thumbsDir, { recursive: true });

            const cliArgs = [scriptPath, "analyze-scenes", dirPath, "--thumbs", thumbsDir, "--cache-dir", cacheDir];
            if (typeof body.detectorThreshold === "number") {
              cliArgs.push("--threshold", String(body.detectorThreshold));
            }
            if (typeof body.maxSceneDuration === "number") {
              cliArgs.push("--max-scene-duration", String(body.maxSceneDuration));
            }
            if (typeof body.targetWindowDuration === "number") {
              cliArgs.push("--target-window-duration", String(body.targetWindowDuration));
            }
            if (typeof body.minWindowDuration === "number") {
              cliArgs.push("--min-window-duration", String(body.minWindowDuration));
            }

            const isStream = Boolean(body.stream);
            if (isStream) {
              cliArgs.push("--stream");
            }

            const proc = spawn(pythonBin, cliArgs, {
              cwd: projectRoot,
              env: { ...process.env, PYTHONPATH: projectRoot, PYTHONUNBUFFERED: "1" },
            });

            if (isStream) {
              res.setHeader("Content-Type", "application/x-ndjson");
              res.setHeader("Cache-Control", "no-cache");
              let stderr = "";
              proc.stdout.on("data", (d: Buffer) => {
                res.write(d);
              });
              proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
              proc.on("close", (code: number) => {
                if (code !== 0 && !res.writableEnded) {
                  res.write(JSON.stringify({ event: "error", error: stderr || "Scene analysis failed" }) + "\n");
                }
                res.end();
              });
              return;
            }

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

      // API to run static analysis on a single asset or custom [startTime, endTime] segment
      server.middlewares.use("/api/analyze-segment", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          return res.end();
        }
        const chunks: Buffer[] = [];
        req.on("data", (chunk: Buffer) => chunks.push(chunk));
        req.on("end", async () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
            let sourceFile = body.sourceFile || "";
            if (!sourceFile) {
              res.statusCode = 400;
              return res.end(JSON.stringify({ error: "sourceFile is required" }));
            }
            const projectRoot = path.resolve(__dirname, "..");
            if (sourceFile.startsWith("~")) {
              sourceFile = path.join(os.homedir(), sourceFile.slice(1));
            } else if (!path.isAbsolute(sourceFile)) {
              sourceFile = path.resolve(projectRoot, sourceFile);
            }
            if (!fs.existsSync(sourceFile)) {
              res.statusCode = 404;
              return res.end(JSON.stringify({ error: `File not found: ${sourceFile}` }));
            }

            const pythonBin = path.join(projectRoot, "engine", ".venv", "bin", "python");
            const scriptPath = path.join(projectRoot, "engine", "main.py");
            const cacheDir = resolveProjectCacheDir(projectRoot, body.projectId);
            const thumbsDir = path.join(cacheDir, "thumbnails");
            fs.mkdirSync(thumbsDir, { recursive: true });

            const args = [
              scriptPath,
              "analyze-segment",
              sourceFile,
              "--start",
              String(body.startTime ?? 0.0),
              "--end",
              String(body.endTime ?? 0.0),
              "--samples",
              String(body.sampleFrames ?? 5),
              "--scene-id",
              String(body.sceneId ?? 0),
              "--thumbs",
              thumbsDir,
            ];

            const proc = spawn(pythonBin, args, {
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
                res.end(JSON.stringify({ error: stderr || "Segment analysis failed" }));
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

      // API to invoke Python/Gemini AI Director with beats + scenes + prompt
      server.middlewares.use("/api/direct", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          return res.end();
        }
        const chunks: Buffer[] = [];
        req.on("data", (chunk: Buffer) => chunks.push(chunk));
        req.on("end", async () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
            const { beats, scenes, prompt, projectTitle, targetAudio } = body;
            if (!beats || !scenes) {
              res.statusCode = 400;
              return res.end(JSON.stringify({ error: "beats and scenes are required" }));
            }

            const projectRoot = path.resolve(__dirname, "..");
            const cacheDir = path.join(projectRoot, "cache");
            fs.mkdirSync(cacheDir, { recursive: true });
            const beatsPath = path.join(cacheDir, "direct_beats.json");
            const scenesPath = path.join(cacheDir, "direct_scenes.json");
            fs.writeFileSync(beatsPath, JSON.stringify(beats, null, 2));
            fs.writeFileSync(scenesPath, JSON.stringify(scenes, null, 2));

            const pythonBin = path.join(projectRoot, "engine", ".venv", "bin", "python");
            const scriptPath = path.join(projectRoot, "engine", "main.py");
            const args = [
              scriptPath,
              "direct",
              "--beats",
              beatsPath,
              "--scenes",
              scenesPath,
              "--prompt",
              String(prompt || ""),
              "--title",
              String(projectTitle || "AMV Project"),
              "--audio",
              String(targetAudio || "soundtrack.wav"),
            ];

            const proc = spawn(pythonBin, args, {
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
                res.end(JSON.stringify({ error: stderr || "AI Director failed" }));
              }
            });
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            res.statusCode = 500;
            res.end(JSON.stringify({ error: msg }));
          }
        });
      });

      server.middlewares.use("/api/shortlist-clips", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          return res.end();
        }
        const chunks: Buffer[] = [];
        req.on("data", (chunk: Buffer) => chunks.push(chunk));
        req.on("end", async () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
            const { beats, scenes, startMs, endMs, cueNote, limit } = body;
            if (!beats || !scenes || startMs === undefined || endMs === undefined) {
              res.statusCode = 400;
              return res.end(
                JSON.stringify({ error: "beats, scenes, startMs, and endMs are required" })
              );
            }

            const projectRoot = path.resolve(__dirname, "..");
            const cacheDir = path.join(projectRoot, "cache");
            fs.mkdirSync(cacheDir, { recursive: true });
            const beatsPath = path.join(cacheDir, "shortlist_beats.json");
            const scenesPath = path.join(cacheDir, "shortlist_scenes.json");
            fs.writeFileSync(beatsPath, JSON.stringify(beats, null, 2));
            fs.writeFileSync(scenesPath, JSON.stringify(scenes, null, 2));

            const pythonBin = path.join(projectRoot, "engine", ".venv", "bin", "python");
            const scriptPath = path.join(projectRoot, "engine", "main.py");
            const args = [
              scriptPath,
              "shortlist-clips",
              "--beats",
              beatsPath,
              "--scenes",
              scenesPath,
              "--start-ms",
              String(Math.round(Number(startMs))),
              "--end-ms",
              String(Math.round(Number(endMs))),
              "--limit",
              String(limit ?? 8),
            ];
            if (cueNote) {
              const cuePath = path.join(cacheDir, "shortlist_cue.json");
              fs.writeFileSync(cuePath, JSON.stringify(cueNote, null, 2));
              args.push("--cue-note-file", cuePath);
            }

            const proc = spawn(pythonBin, args, {
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
                res.end(JSON.stringify({ error: stderr || "Shortlist failed" }));
              }
            });
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            res.statusCode = 500;
            res.end(JSON.stringify({ error: msg }));
          }
        });
      });

      server.middlewares.use("/api/index-semantics", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          return res.end();
        }
        const chunks: Buffer[] = [];
        req.on("data", (chunk: Buffer) => chunks.push(chunk));
        req.on("end", () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
            const { scenes, force, projectId } = body;
            if (!scenes) {
              res.statusCode = 400;
              return res.end(JSON.stringify({ error: "scenes is required" }));
            }
            const projectRoot = path.resolve(__dirname, "..");
            const cacheDir = resolveProjectCacheDir(projectRoot, projectId);
            fs.mkdirSync(cacheDir, { recursive: true });
            const scenesPath = path.join(cacheDir, "semantic_scenes.json");
            fs.writeFileSync(scenesPath, JSON.stringify(scenes, null, 2));

            const pythonBin = path.join(projectRoot, "engine", ".venv", "bin", "python");
            const scriptPath = path.join(projectRoot, "engine", "main.py");
            const args = [scriptPath, "index-semantics", "--scenes", scenesPath, "--cache-dir", cacheDir];
            if (force) args.push("--force");

            const proc = spawn(pythonBin, args, {
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
                res.end(JSON.stringify({ error: stderr || "Semantic indexing failed" }));
              }
            });
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            res.statusCode = 500;
            res.end(JSON.stringify({ error: msg }));
          }
        });
      });

      server.middlewares.use("/api/search-clips", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          return res.end();
        }
        const chunks: Buffer[] = [];
        req.on("data", (chunk: Buffer) => chunks.push(chunk));
        req.on("end", () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
            const { scenes, query, projectId } = body;
            if (!scenes || !query) {
              res.statusCode = 400;
              return res.end(JSON.stringify({ error: "scenes and query are required" }));
            }
            const projectRoot = path.resolve(__dirname, "..");
            const cacheDir = resolveProjectCacheDir(projectRoot, projectId);
            fs.mkdirSync(cacheDir, { recursive: true });
            const scenesPath = path.join(cacheDir, "semantic_scenes.json");
            const queryPath = path.join(cacheDir, "search_query.json");
            fs.writeFileSync(scenesPath, JSON.stringify(scenes, null, 2));
            fs.writeFileSync(queryPath, JSON.stringify(query, null, 2));

            const pythonBin = path.join(projectRoot, "engine", ".venv", "bin", "python");
            const scriptPath = path.join(projectRoot, "engine", "main.py");
            const args = [
              scriptPath,
              "search-clips",
              "--scenes",
              scenesPath,
              "--query-file",
              queryPath,
              "--cache-dir",
              cacheDir,
            ];
            const proc = spawn(pythonBin, args, {
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
                res.end(JSON.stringify({ error: stderr || "Clip search failed" }));
              }
            });
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            res.statusCode = 500;
            res.end(JSON.stringify({ error: msg }));
          }
        });
      });

      server.middlewares.use("/api/semantic-search", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          return res.end();
        }
        const chunks: Buffer[] = [];
        req.on("data", (chunk: Buffer) => chunks.push(chunk));
        req.on("end", () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
            const { scenes, query, topK, projectId } = body;
            if (!scenes || !query) {
              res.statusCode = 400;
              return res.end(JSON.stringify({ error: "scenes and query are required" }));
            }
            const projectRoot = path.resolve(__dirname, "..");
            const cacheDir = resolveProjectCacheDir(projectRoot, projectId);
            fs.mkdirSync(cacheDir, { recursive: true });
            const scenesPath = path.join(cacheDir, "semantic_scenes.json");
            fs.writeFileSync(scenesPath, JSON.stringify(scenes, null, 2));

            const pythonBin = path.join(projectRoot, "engine", ".venv", "bin", "python");
            const scriptPath = path.join(projectRoot, "engine", "main.py");
            const args = [
              scriptPath,
              "semantic-search",
              "--scenes",
              scenesPath,
              "--query",
              String(query),
              "--cache-dir",
              cacheDir,
              "--top-k",
              String(topK ?? 25),
            ];
            const proc = spawn(pythonBin, args, {
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
                res.end(JSON.stringify({ error: stderr || "Semantic search failed" }));
              }
            });
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            res.statusCode = 500;
            res.end(JSON.stringify({ error: msg }));
          }
        });
      });

      // API to render timeline to MP4 via FFmpeg & Python CLI (streams NDJSON progress)
      server.middlewares.use("/api/render", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          return res.end();
        }
        const chunks: Buffer[] = [];
        req.on("data", (chunk: Buffer) => chunks.push(chunk));
        req.on("end", async () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
            const { timeline, outputPath, options } = body;
            if (!timeline || !Array.isArray(timeline.cuts) || timeline.cuts.length === 0) {
              res.statusCode = 400;
              return res.end(JSON.stringify({ error: "timeline with cuts is required" }));
            }

            const projectRoot = path.resolve(__dirname, "..");
            const cacheDir = path.join(projectRoot, "cache");
            fs.mkdirSync(cacheDir, { recursive: true });

            // Resolve target_audio if it's a relative/filename from browser upload
            const resolvedTimeline = { ...timeline };
            const rawAudio = String(resolvedTimeline.target_audio || "");
            if (rawAudio && !fs.existsSync(rawAudio)) {
              const candidates = [
                path.join(projectRoot, rawAudio),
                path.join(os.homedir(), "Downloads", path.basename(rawAudio)),
                path.join(projectRoot, "export", "browser_upload_audio.mp3"),
              ];
              const found = candidates.find((c) => fs.existsSync(c));
              if (found) resolvedTimeline.target_audio = found;
            }

            const timelinePath = path.join(cacheDir, "render_timeline.json");
            fs.writeFileSync(timelinePath, JSON.stringify(resolvedTimeline, null, 2));

            let outFile = String(outputPath || "export/amv_final.mp4");
            if (outFile.startsWith("~")) {
              outFile = path.join(os.homedir(), outFile.slice(1));
            } else if (!path.isAbsolute(outFile)) {
              outFile = path.resolve(projectRoot, outFile);
            }
            fs.mkdirSync(path.dirname(outFile), { recursive: true });

            const pythonBin = path.join(projectRoot, "engine", ".venv", "bin", "python");
            const scriptPath = path.join(projectRoot, "engine", "main.py");
            const args = [scriptPath, "render", timelinePath, "--output", outFile, "--json"];
            if (options?.codec) args.push("--codec", String(options.codec));
            if (options?.hwaccel !== undefined) args.push(options.hwaccel ? "--hwaccel" : "--no-hwaccel");
            if (options?.preset) args.push("--preset", String(options.preset));
            if (options?.resolution) args.push("--resolution", String(options.resolution));
            if (options?.fps) args.push("--fps", String(options.fps));

            const proc = spawn(pythonBin, args, {
              cwd: projectRoot,
              env: { ...process.env, PYTHONPATH: projectRoot, PYTHONUNBUFFERED: "1" },
            });

            res.setHeader("Content-Type", "application/x-ndjson");
            res.setHeader("Cache-Control", "no-cache");
            let stderr = "";
            proc.stdout.on("data", (d: Buffer) => res.write(d));
            proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
            proc.on("close", (code: number) => {
              if (code !== 0 && !res.writableEnded) {
                res.write(JSON.stringify({ type: "error", error: stderr || "Render failed" }) + "\n");
              }
              res.end();
            });
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            res.statusCode = 500;
            res.end(JSON.stringify({ error: msg }));
          }
        });
      });

      // API to export timeline to OTIO / FCPXML via Python CLI
      server.middlewares.use("/api/export-project", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          return res.end();
        }
        const chunks: Buffer[] = [];
        req.on("data", (chunk: Buffer) => chunks.push(chunk));
        req.on("end", async () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
            const { timeline, outputPath, format } = body;
            if (!timeline) {
              res.statusCode = 400;
              return res.end(JSON.stringify({ error: "timeline is required" }));
            }

            const projectRoot = path.resolve(__dirname, "..");
            const cacheDir = path.join(projectRoot, "cache");
            fs.mkdirSync(cacheDir, { recursive: true });
            const timelinePath = path.join(cacheDir, "export_timeline.json");
            fs.writeFileSync(timelinePath, JSON.stringify(timeline, null, 2));

            let outFile = String(outputPath || "export/amv_project.otio");
            if (outFile.startsWith("~")) {
              outFile = path.join(os.homedir(), outFile.slice(1));
            } else if (!path.isAbsolute(outFile)) {
              outFile = path.resolve(projectRoot, outFile);
            }
            fs.mkdirSync(path.dirname(outFile), { recursive: true });

            const pythonBin = path.join(projectRoot, "engine", ".venv", "bin", "python");
            const scriptPath = path.join(projectRoot, "engine", "main.py");
            const args = [
              scriptPath,
              "export-project",
              timelinePath,
              "--output",
              outFile,
              "--format",
              String(format || "auto"),
              "--json",
            ];

            const proc = spawn(pythonBin, args, {
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
                res.end(JSON.stringify({ error: stderr || "Project export failed" }));
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
          } else if (!path.isAbsolute(filePath)) {
            filePath = path.resolve(__dirname, "..", filePath);
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
            ".m4a": "video/mp4",
            ".mkv": "video/x-matroska",
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

      // Serve cache/thumbnails and projects/<id>/thumbnails for keyframe previews in browser
      server.middlewares.use("/cache/thumbnails", (req, res, next) => {
        const projectRoot = path.resolve(__dirname, "..");
        const urlObj = new URL(req.url || "", "http://localhost:1420");
        const thumbName = decodeURIComponent(path.basename(urlObj.pathname));
        const projectId = urlObj.searchParams.get("projectId");
        const candidates: string[] = [];
        if (projectId) {
          candidates.push(path.join(resolveProjectCacheDir(projectRoot, projectId), "thumbnails", thumbName));
        }
        candidates.push(path.join(projectRoot, "cache", "thumbnails", thumbName));
        const projectsRoot = path.join(projectRoot, "projects");
        if (fs.existsSync(projectsRoot)) {
          for (const entry of fs.readdirSync(projectsRoot, { withFileTypes: true })) {
            if (entry.isDirectory()) {
              candidates.push(path.join(projectsRoot, entry.name, "thumbnails", thumbName));
            }
          }
        }
        for (const thumbPath of candidates) {
          if (fs.existsSync(thumbPath)) {
            res.setHeader("Content-Type", "image/jpeg");
            return fs.createReadStream(thumbPath).pipe(res);
          }
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
    exclude: ["node_modules/**", "e2e/**"],
  },
});
