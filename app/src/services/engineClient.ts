/**
 * Strongly-Typed IPC Client for AMV Maker Media Engine.
 * Supports both Tauri v2 native execution (via @tauri-apps/plugin-shell / invoke)
 * and an interactive offline mock mode for browser testing and frontend development.
 */

import type {
  BeatsData,
  ScenesCatalog,
  SceneCut,
  Timeline,
  RenderOptions,
  RenderProgress,
  RenderResult,
  ExportResult,
} from "../types/schemas";
import {
  DEMO_BEATS,
  DEMO_SCENES,
  DEMO_TIMELINE,
  generateProceduralTimeline,
  generateBeatsForDuration,
} from "./mockData";
import { analyzeAudioFileInBrowser } from "./audioEngine";

export interface EngineClientConfig {
  forceMock?: boolean;
}

/**
 * Check if the current runtime is running inside the Tauri shell window.
 */
export function isTauriEnvironment(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean(
    (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ ||
    (window as unknown as { __TAURI__?: unknown }).__TAURI__
  );
}

class EngineClient {
  private forceMock: boolean = false;

  constructor(config?: EngineClientConfig) {
    if (config?.forceMock !== undefined) {
      this.forceMock = config.forceMock;
    }
  }

  public setForceMock(mock: boolean): void {
    this.forceMock = mock;
  }

  public get isMockMode(): boolean {
    return this.forceMock || !isTauriEnvironment();
  }

  /**
   * Run media analysis on an audio soundtrack file.
   */
  async analyzeSoundtrack(audioPath: string, durationSec?: number, audioFile?: File): Promise<BeatsData> {
    if (this.isMockMode) {
      // 1. Try real Python engine via Vite Dev Server API if file is provided
      if (audioFile) {
        try {
          const res = await fetch("/api/analyze-soundtrack", {
            method: "POST",
            body: audioFile,
          });
          if (res.ok) {
            const data = await res.json();
            return data as BeatsData;
          }
        } catch {
          // Dev server endpoint unreachable; fall through to browser Web Audio
        }

        // 2. Real Web Audio API decoding in browser (extracts real RMS energy across PCM samples)
        try {
          return await analyzeAudioFileInBrowser(audioFile);
        } catch (e) {
          console.warn("Browser Web Audio decoding failed, using synthetic beats:", e);
        }
      }

      // 3. Fallback for demo fixtures
      await new Promise((resolve) => setTimeout(resolve, 150));
      if (durationSec && durationSec > 0) {
        return generateBeatsForDuration(durationSec, 128.0);
      }
      return {
        ...DEMO_BEATS,
      };
    }

    try {
      const { Command } = await import("@tauri-apps/plugin-shell");
      const cmd = Command.sidecar("binaries/amv-engine", [
        "analyze-soundtrack",
        audioPath,
      ]);
      const output = await cmd.execute();
      if (output.code !== 0) {
        throw new Error(output.stderr || "Audio analysis failed");
      }
      return JSON.parse(output.stdout) as BeatsData;
    } catch (err) {
      console.warn("Tauri sidecar call failed, falling back to mock:", err);
      return DEMO_BEATS;
    }
  }

  /**
   * Normalize catalog keyframe thumbnail paths for web display.
   */
  public normalizeCatalogThumbnails(catalog: ScenesCatalog): ScenesCatalog {
    return {
      ...catalog,
      scenes: (catalog.scenes || []).map((s) => ({
        ...s,
        keyframe_path: s.keyframe_path
          ? s.keyframe_path.startsWith("blob:") || s.keyframe_path.startsWith("http")
            ? s.keyframe_path
            : `/cache/thumbnails/${s.keyframe_path.split(/[\\/]/).pop()}`
          : undefined,
      })),
    };
  }

  /**
   * Parse, validate, and normalize an existing ScenesCatalog JSON string or object.
   */
  public importScenesCatalog(jsonContent: string | unknown): ScenesCatalog {
    let data: unknown;
    if (typeof jsonContent === "string") {
      try {
        data = JSON.parse(jsonContent);
      } catch (e) {
        throw new Error(`Invalid JSON syntax in scenes catalog: ${e instanceof Error ? e.message : String(e)}`);
      }
    } else {
      data = jsonContent;
    }

    if (!data || typeof data !== "object") {
      throw new Error("Invalid scenes catalog: root must be a JSON object");
    }

    const rawScenes = (data as { scenes?: unknown }).scenes;
    if (!Array.isArray(rawScenes) || rawScenes.length === 0) {
      throw new Error("Invalid scenes catalog: 'scenes' array is missing or empty");
    }

    const scenes: SceneCut[] = rawScenes.map((rawCut, idx) => {
      const cut = rawCut as Record<string, unknown>;
      const isImg =
        cut.is_still_image === true ||
        cut.media_type === "image" ||
        (typeof cut.source_file === "string" && /\.(jpg|jpeg|png|webp)$/i.test(cut.source_file));

      return {
        scene_id: typeof cut.scene_id === "number" ? cut.scene_id : idx,
        source_file: String(cut.source_file || `clip_${idx}`),
        start_time: typeof cut.start_time === "number" ? cut.start_time : 0.0,
        end_time: typeof cut.end_time === "number" ? cut.end_time : isImg ? 0.0 : 8.0,
        duration: typeof cut.duration === "number" ? cut.duration : isImg ? 0.0 : 8.0,
        keyframe_path: cut.keyframe_path ? String(cut.keyframe_path) : undefined,
        sharpness_score: typeof cut.sharpness_score === "number" ? cut.sharpness_score : 100.0,
        motion_score: typeof cut.motion_score === "number" ? cut.motion_score : isImg ? 0.0 : 50.0,
        brightness_score: typeof cut.brightness_score === "number" ? cut.brightness_score : 100.0,
        media_type: isImg ? "image" : "video",
        is_still_image: isImg,
        has_faces: typeof cut.has_faces === "boolean" ? cut.has_faces : undefined,
        face_count: typeof cut.face_count === "number" ? cut.face_count : undefined,
        dominant_expression: typeof cut.dominant_expression === "string" ? cut.dominant_expression : undefined,
        smile_score: typeof cut.smile_score === "number" ? cut.smile_score : undefined,
        subject_prominence:
          cut.subject_prominence === "close_up" ||
          cut.subject_prominence === "medium_shot" ||
          cut.subject_prominence === "wide_shot" ||
          cut.subject_prominence === "scenic"
            ? cut.subject_prominence
            : undefined,
      };
    });

    const sourceFiles = Array.isArray((data as { source_files?: unknown }).source_files)
      ? ((data as { source_files: unknown[] }).source_files.map(String))
      : Array.from(new Set(scenes.map((s) => s.source_file)));

    const catalog: ScenesCatalog = {
      source_files: sourceFiles,
      total_scenes: typeof (data as { total_scenes?: unknown }).total_scenes === "number"
        ? (data as { total_scenes: number }).total_scenes
        : scenes.length,
      scenes,
    };

    return this.normalizeCatalogThumbnails(catalog);
  }

  /**
   * Run scene detection & keyframe extraction on source videos directory.
   */
  async analyzeScenes(videoDir: string, thumbsDir?: string, files?: File[]): Promise<ScenesCatalog> {
    if (this.isMockMode) {
      // 1. If browser files were dropped/selected, upload them into cache/library/<batchId> and run real Python analysis
      if (files && files.length > 0) {
        try {
          const batchId = `batch_${Date.now()}`;
          let batchDir = "";
          for (const file of files) {
            const upRes = await fetch(
              `/api/upload-library-file?batchId=${encodeURIComponent(batchId)}&filename=${encodeURIComponent(file.name)}`,
              {
                method: "POST",
                body: file,
              }
            );
            if (!upRes.ok) {
              throw new Error(`Upload failed for ${file.name}: ${upRes.status}`);
            }
            const upData = (await upRes.json()) as { batchDir?: string };
            if (upData.batchDir) batchDir = upData.batchDir;
          }
          if (batchDir) {
            const res = await fetch("/api/analyze-scenes", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ dirPath: batchDir, thumbsDir: thumbsDir || "cache/thumbnails" }),
            });
            if (res.ok) {
              const data = await res.json();
              return this.normalizeCatalogThumbnails(data as ScenesCatalog);
            }
          }
        } catch (e) {
          console.warn("Dev server upload & scene analysis failed, using fallback:", e);
        }
      }

      // 2. Try real Python PySceneDetect engine via Vite Dev Server API if given a filesystem directory path
      const isDirPath = videoDir.includes("/") || videoDir.startsWith("~") || videoDir.includes("\\");
      if (isDirPath) {
        try {
          const res = await fetch("/api/analyze-scenes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ dirPath: videoDir, thumbsDir: thumbsDir || "cache/thumbnails" }),
          });
          if (res.ok) {
            const data = await res.json();
            return this.normalizeCatalogThumbnails(data as ScenesCatalog);
          }
        } catch (e) {
          console.warn("Dev server scene analysis failed, using fallback:", e);
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 200));

      if (files && files.length > 0) {
        const scenes: SceneCut[] = files.map((file, idx) => {
          const isImage = file.type.startsWith("image/") || /\.(jpg|jpeg|png|webp)$/i.test(file.name);
          const keyframeUrl = isImage ? URL.createObjectURL(file) : undefined;

          return {
            scene_id: idx,
            source_file: file.name,
            start_time: 0.0,
            end_time: isImage ? 0.0 : 8.0,
            duration: isImage ? 0.0 : 8.0,
            keyframe_path: keyframeUrl,
            sharpness_score: 110 + (idx % 6) * 15,
            motion_score: isImage ? 0 : 35 + (idx % 4) * 20,
            brightness_score: 95 + (idx % 5) * 25,
            media_type: isImage ? "image" : "video",
            is_still_image: isImage,
          };
        });

        return {
          source_files: files.map((f) => f.name),
          total_scenes: files.length,
          scenes,
        };
      }

      return {
        ...DEMO_SCENES,
      };
    }

    try {
      const { Command } = await import("@tauri-apps/plugin-shell");
      const args = ["analyze-scenes", videoDir];
      if (thumbsDir) {
        args.push("--thumbs", thumbsDir);
      }
      const cmd = Command.sidecar("binaries/amv-engine", args);
      const output = await cmd.execute();
      if (output.code !== 0) {
        throw new Error(output.stderr || "Scene analysis failed");
      }
      return JSON.parse(output.stdout) as ScenesCatalog;
    } catch (err) {
      console.warn("Tauri sidecar call failed, falling back to mock:", err);
      return DEMO_SCENES;
    }
  }

  /**
   * Run static visual + MediaPipe face/emotion analysis on a single asset or custom [start, end] segment.
   */
  async analyzeSegment(
    sourceFile: string,
    startTime = 0.0,
    endTime = 0.0,
    sampleFrames = 5,
    sceneId = 0
  ): Promise<SceneCut> {
    const res = await fetch("/api/analyze-segment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceFile, startTime, endTime, sampleFrames, sceneId }),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Segment analysis failed (${res.status}): ${errText}`);
    }
    const cut = (await res.json()) as SceneCut;
    const normalized = this.normalizeCatalogThumbnails({
      source_files: [cut.source_file],
      total_scenes: 1,
      scenes: [cut],
    });
    return normalized.scenes[0];
  }

  /**
   * Direct an AMV timeline based on musical beats, detected scenes, and director prompt.
   */
  async directAmv(
    beats: BeatsData,
    catalog: ScenesCatalog,
    prompt: string,
    projectTitle: string = "AMV Project"
  ): Promise<Timeline> {
    if (this.isMockMode) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      return generateProceduralTimeline(beats, catalog, prompt, projectTitle);
    }

    try {
      const { Command } = await import("@tauri-apps/plugin-shell");
      // In native mode, if temporary files or direct IPC is used
      const args = [
        "direct",
        "--beats", "cache/beats.json",
        "--scenes", "cache/scenes.json",
        "--prompt", prompt,
        "--title", projectTitle,
      ];
      const cmd = Command.sidecar("binaries/amv-engine", args);
      const output = await cmd.execute();
      if (output.code !== 0) {
        throw new Error(output.stderr || "AMV Direction failed");
      }
      return JSON.parse(output.stdout) as Timeline;
    } catch (err) {
      console.warn("Tauri sidecar direct failed, falling back to procedural:", err);
      return generateProceduralTimeline(beats, catalog, prompt, projectTitle);
    }
  }

  /**
   * Render final AMV video using FFmpeg filter complex.
   */
  async renderTimeline(
    timeline: Timeline,
    outputPath: string,
    options?: RenderOptions,
    onProgress?: (progress: RenderProgress) => void
  ): Promise<RenderResult> {
    if (this.isMockMode) {
      // Simulate real-time progress events
      const totalSteps = 10;
      const totalTime = timeline.cuts.length > 0 ? timeline.cuts[timeline.cuts.length - 1].timeline_end : 16.0;
      for (let i = 1; i <= totalSteps; i++) {
        await new Promise((r) => setTimeout(r, 80));
        const percent = (i / totalSteps) * 100;
        const curTime = (percent / 100) * totalTime;
        onProgress?.({
          type: "progress",
          percent,
          currentTime: curTime,
          totalTime,
          fps: 48.2,
          speed: "2.1x",
          frame: Math.round(curTime * (options?.fps || 24)),
        });
      }
      return {
        type: "completed",
        status: "success",
        outputPath: outputPath || "export/amv_final.mp4",
        duration: totalTime,
      };
    }

    try {
      const { Command } = await import("@tauri-apps/plugin-shell");
      const args = [
        "render",
        "cache/timeline.json",
        "--output", outputPath,
        "--json",
      ];
      if (options?.codec) args.push("--codec", options.codec);
      if (options?.hwaccel !== undefined) args.push(options.hwaccel ? "--hwaccel" : "--no-hwaccel");
      if (options?.preset) args.push("--preset", options.preset);
      if (options?.resolution) args.push("--resolution", options.resolution);
      if (options?.fps) args.push("--fps", String(options.fps));

      const cmd = Command.sidecar("binaries/amv-engine", args);

      return new Promise<RenderResult>((resolve, reject) => {
        cmd.stdout.on("data", (line: string) => {
          try {
            const data = JSON.parse(line.trim());
            if (data.type === "progress") {
              onProgress?.(data);
            } else if (data.type === "completed") {
              resolve(data);
            } else if (data.type === "error") {
              reject(new Error(data.error));
            }
          } catch {
            // Ignore non-json lines
          }
        });

        cmd.stderr.on("data", (errLine: string) => {
          console.warn("[FFmpeg stderr]", errLine);
        });

        cmd.spawn().catch(reject);
      });
    } catch (err) {
      throw new Error(`Render failed: ${err}`);
    }
  }

  /**
   * Export timeline cuts to OpenTimelineIO (.otio) or Final Cut Pro XML (.fcpxml).
   */
  async exportProject(
    _timeline: Timeline,
    outputPath: string,
    format: "otio" | "fcpxml" | "auto" = "auto"
  ): Promise<ExportResult> {
    if (this.isMockMode) {
      await new Promise((r) => setTimeout(r, 120));
      const detected = outputPath.endsWith(".fcpxml") || format === "fcpxml" ? "fcpxml" : "otio";
      return {
        type: "completed",
        status: "success",
        outputPath,
        format: detected,
      };
    }

    try {
      const { Command } = await import("@tauri-apps/plugin-shell");
      const args = [
        "export-project",
        "cache/timeline.json",
        "--output", outputPath,
        "--format", format,
        "--json",
      ];
      const cmd = Command.sidecar("binaries/amv-engine", args);
      const output = await cmd.execute();
      if (output.code !== 0) {
        throw new Error(output.stderr || "Project export failed");
      }
      return JSON.parse(output.stdout) as ExportResult;
    } catch (err) {
      throw new Error(`Export failed: ${err}`);
    }
  }

  /**
   * Pre-packaged demo fixtures for instantaneous preview and exploration.
   */
  loadDemoFixtures(): {
    beats: BeatsData;
    scenes: ScenesCatalog;
    timeline: Timeline;
  } {
    return {
      beats: DEMO_BEATS,
      scenes: DEMO_SCENES,
      timeline: DEMO_TIMELINE,
    };
  }
}

export const engineClient = new EngineClient();
export { EngineClient };
