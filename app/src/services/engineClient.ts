/**
 * Strongly-Typed IPC Client for AMV Maker Media Engine.
 * Supports both Tauri v2 native execution (via @tauri-apps/plugin-shell / invoke)
 * and an interactive offline mock mode for browser testing and frontend development.
 */

import type {
  AudioCueNote,
  BeatsData,
  ClipSearchHit,
  ClipSearchQuery,
  ProjectData,
  ProjectSummary,
  ScenesCatalog,
  SceneCut,
  SegmentShortlist,
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
  private activeProjectId: string | null = null;

  constructor(config?: EngineClientConfig) {
    if (config?.forceMock !== undefined) {
      this.forceMock = config.forceMock;
    }
  }

  setActiveProjectId(projectId: string | null) {
    this.activeProjectId = projectId;
  }

  getActiveProjectId(): string | null {
    return this.activeProjectId;
  }

  async listProjects(): Promise<ProjectSummary[]> {
    if (!this.isMockMode) return [];
    try {
      const res = await fetch("/api/projects");
      if (res.ok) {
        const data = (await res.json()) as { projects?: ProjectSummary[] };
        return data.projects || [];
      }
    } catch (e) {
      console.warn("listProjects failed:", e);
    }
    return [];
  }

  async createProject(name: string): Promise<ProjectData | null> {
    if (!this.isMockMode) return null;
    try {
      const res = await fetch("/api/projects/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        const data = (await res.json()) as { project?: ProjectData };
        if (data.project) {
          this.activeProjectId = data.project.id;
          return data.project;
        }
      }
    } catch (e) {
      console.warn("createProject failed:", e);
    }
    return null;
  }

  async loadProject(id: string): Promise<ProjectData | null> {
    if (!this.isMockMode) return null;
    try {
      const res = await fetch(`/api/projects/load?id=${encodeURIComponent(id)}`);
      if (res.ok) {
        const data = (await res.json()) as { project?: ProjectData };
        if (data.project) {
          this.activeProjectId = data.project.id;
          return data.project;
        }
      }
    } catch (e) {
      console.warn("loadProject failed:", e);
    }
    return null;
  }

  async saveProject(payload: {
    id: string;
    name?: string;
    audio_file?: string | null;
    user_prompt?: string;
    audio_notes?: AudioCueNote[];
    beats?: BeatsData | null;
    scenes?: ScenesCatalog | null;
    timeline?: Timeline | null;
  }): Promise<boolean> {
    if (!this.isMockMode) return false;
    try {
      const res = await fetch("/api/projects/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      return res.ok;
    } catch (e) {
      console.warn("saveProject failed:", e);
      return false;
    }
  }

  async deleteProject(id: string): Promise<boolean> {
    if (!this.isMockMode) return false;
    try {
      const res = await fetch("/api/projects/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (res.ok && this.activeProjectId === id) {
        this.activeProjectId = null;
      }
      return res.ok;
    } catch (e) {
      console.warn("deleteProject failed:", e);
      return false;
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

  private async runAnalyzeScenesRequest(
    dirPath: string,
    thumbsDir: string | undefined,
    options?: {
      detectorThreshold?: number;
      maxSceneDuration?: number;
      targetWindowDuration?: number;
      minWindowDuration?: number;
    },
    onProgress?: (partialCatalog: ScenesCatalog, pendingFiles: string[]) => void
  ): Promise<ScenesCatalog | null> {
    const useStream = Boolean(onProgress);
    const res = await fetch("/api/analyze-scenes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dirPath,
        projectId: this.activeProjectId,
        thumbsDir: thumbsDir || "cache/thumbnails",
        stream: useStream,
        ...options,
      }),
    });
    if (!res.ok) return null;

    if (!useStream || !res.body) {
      const data = await res.json();
      return this.normalizeCatalogThumbnails(data as ScenesCatalog);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let sourceFiles: string[] = [];
    let pending = new Set<string>();
    let accumulatedScenes: SceneCut[] = [];
    let finalCatalog: ScenesCatalog | null = null;

    const processLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith("{")) return;
      const evt = JSON.parse(trimmed) as {
        event: string;
        source_files?: string[];
        source_file?: string;
        scenes?: SceneCut[];
        catalog?: ScenesCatalog;
        error?: string;
      };
      if (evt.event === "discovered" && evt.source_files) {
        sourceFiles = evt.source_files;
        pending = new Set(evt.source_files);
        onProgress?.(
          this.normalizeCatalogThumbnails({
            source_files: sourceFiles,
            total_scenes: 0,
            scenes: [],
          }),
          Array.from(pending)
        );
      } else if (evt.event === "file_done" && evt.source_file) {
        pending.delete(evt.source_file);
        const newScenes = evt.scenes || [];
        accumulatedScenes = [...accumulatedScenes, ...newScenes];
        const partial = this.normalizeCatalogThumbnails({
          source_files: sourceFiles.length ? sourceFiles : [evt.source_file],
          total_scenes: accumulatedScenes.length,
          scenes: accumulatedScenes,
        });
        onProgress?.(partial, Array.from(pending));
      } else if (evt.event === "complete" && evt.catalog) {
        finalCatalog = this.normalizeCatalogThumbnails(evt.catalog);
        onProgress?.(finalCatalog, []);
      } else if (evt.event === "error") {
        throw new Error(evt.error || "Streaming scene analysis failed");
      }
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nlIdx = buffer.indexOf("\n");
      while (nlIdx >= 0) {
        const line = buffer.slice(0, nlIdx);
        buffer = buffer.slice(nlIdx + 1);
        processLine(line);
        nlIdx = buffer.indexOf("\n");
      }
    }
    if (buffer.trim()) {
      processLine(buffer);
    }

    return (
      finalCatalog ||
      this.normalizeCatalogThumbnails({
        source_files: sourceFiles,
        total_scenes: accumulatedScenes.length,
        scenes: accumulatedScenes,
      })
    );
  }

  /**
   * Run scene detection & keyframe extraction on source videos directory or single file.
   */
  async analyzeScenes(
    videoDir: string,
    thumbsDir?: string,
    files?: File[],
    options?: {
      detectorThreshold?: number;
      maxSceneDuration?: number;
      targetWindowDuration?: number;
      minWindowDuration?: number;
    },
    onProgress?: (partialCatalog: ScenesCatalog, pendingFiles: string[]) => void
  ): Promise<ScenesCatalog> {
    if (this.isMockMode) {
      // 1. If browser files were dropped/selected, upload them into cache/library/<batchId> and run real Python analysis
      if (files && files.length > 0) {
        try {
          const batchId = `batch_${Date.now()}`;
          let batchDir = "";
          for (const file of files) {
            const projParam = this.activeProjectId
              ? `&projectId=${encodeURIComponent(this.activeProjectId)}`
              : "";
            const upRes = await fetch(
              `/api/upload-library-file?batchId=${encodeURIComponent(batchId)}&filename=${encodeURIComponent(file.name)}&size=${file.size}${projParam}`,
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
            const result = await this.runAnalyzeScenesRequest(
              batchDir,
              thumbsDir,
              options,
              onProgress
            );
            if (result) return result;
          }
        } catch (e) {
          console.warn("Dev server upload & scene analysis failed, using fallback:", e);
        }
      }

      // 2. Try real Python PySceneDetect engine via Vite Dev Server API if given a filesystem directory or file path
      const isDirPath = videoDir.includes("/") || videoDir.startsWith("~") || videoDir.includes("\\");
      if (isDirPath) {
        try {
          const result = await this.runAnalyzeScenesRequest(
            videoDir,
            thumbsDir,
            options,
            onProgress
          );
          if (result) return result;
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
      if (typeof options?.detectorThreshold === "number") {
        args.push("--threshold", String(options.detectorThreshold));
      }
      if (typeof options?.maxSceneDuration === "number") {
        args.push("--max-scene-duration", String(options.maxSceneDuration));
      }
      if (typeof options?.targetWindowDuration === "number") {
        args.push("--target-window-duration", String(options.targetWindowDuration));
      }
      if (typeof options?.minWindowDuration === "number") {
        args.push("--min-window-duration", String(options.minWindowDuration));
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
      body: JSON.stringify({
        sourceFile,
        startTime,
        endTime,
        sampleFrames,
        sceneId,
        projectId: this.activeProjectId,
      }),
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
    projectTitle: string = "AMV Project",
    targetAudio?: string
  ): Promise<Timeline> {
    if (this.isMockMode) {
      try {
        const res = await fetch("/api/direct", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            beats,
            scenes: catalog,
            prompt,
            projectTitle,
            targetAudio: targetAudio || "soundtrack.wav",
          }),
        });
        if (res.ok) {
          return (await res.json()) as Timeline;
        }
      } catch (e) {
        console.warn("Dev server AI Director failed, falling back to procedural:", e);
      }
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
   * Shortlist best-matching clips for an audio segment [startMs, endMs]
   * using Gemini tool-calling over the indexed ScenesCatalog (with deterministic fallback).
   */
  async shortlistClips(
    beats: BeatsData,
    catalog: ScenesCatalog,
    startMs: number,
    endMs: number,
    cueNote?: AudioCueNote | null,
    limit: number = 8
  ): Promise<SegmentShortlist> {
    if (this.isMockMode) {
      try {
        const res = await fetch("/api/shortlist-clips", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            beats,
            scenes: catalog,
            startMs,
            endMs,
            cueNote: cueNote || undefined,
            limit,
          }),
        });
        if (res.ok) {
          return (await res.json()) as SegmentShortlist;
        }
      } catch (e) {
        console.warn("Dev server shortlist-clips failed, using local fallback:", e);
      }
    } else {
      try {
        const { Command } = await import("@tauri-apps/plugin-shell");
        const args = [
          "shortlist-clips",
          "--beats", "cache/beats.json",
          "--scenes", "cache/scenes.json",
          "--start-ms", String(Math.round(startMs)),
          "--end-ms", String(Math.round(endMs)),
          "--limit", String(limit),
        ];
        const cmd = Command.sidecar("binaries/amv-engine", args);
        const output = await cmd.execute();
        if (output.code === 0) {
          return JSON.parse(output.stdout) as SegmentShortlist;
        }
      } catch (err) {
        console.warn("Tauri sidecar shortlist-clips failed, using local fallback:", err);
      }
    }

    // Pure client-side fallback when neither Vite dev middleware nor Tauri sidecar is reachable
    const tokens = new Set(
      `${cueNote?.note || ""} ${(cueNote?.tags || []).join(" ")}`
        .toLowerCase()
        .split(/[\s,]+/)
        .filter((t) => t.length >= 2)
    );
    const pinnedIds = new Set(cueNote?.pinned_scene_ids || []);
    const candidates = catalog.scenes
      .map((s) => {
        let score = 0.25;
        const matched: string[] = [];
        if (pinnedIds.has(s.scene_id)) {
          score += 0.55;
          matched.push("pinned_scene");
        }
        const hay = `${s.source_file} ${s.user_note || ""} ${s.user_tags?.join(" ") || ""} ${s.visual_mood || ""} ${s.color_mood || ""}`.toLowerCase();
        for (const tok of tokens) {
          if (hay.includes(tok)) {
            score += 0.12;
            matched.push(tok);
          }
        }
        return {
          scene_id: s.scene_id,
          source_file: s.source_file,
          start_time: s.start_time,
          end_time: s.end_time,
          score: Number(Math.min(1, score).toFixed(3)),
          reason: matched.length > 0 ? `Matches: ${matched.join(", ")}` : `${s.visual_mood || "balanced"} clip`,
          matched_criteria: matched,
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return {
      start_ms: startMs,
      end_ms: endMs,
      segment_summary: `${(startMs / 1000).toFixed(2)}s–${(endMs / 1000).toFixed(2)}s`,
      candidates,
    };
  }

  /**
   * Run local SigLIP semantic indexing on analyzed scene keyframes.
   */
  async indexSemantics(catalog: ScenesCatalog, force: boolean = false): Promise<ScenesCatalog> {
    if (this.isMockMode) {
      try {
        const res = await fetch("/api/index-semantics", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scenes: catalog, force, projectId: this.activeProjectId }),
        });
        if (res.ok) {
          return (await res.json()) as ScenesCatalog;
        }
      } catch (e) {
        console.warn("Dev server index-semantics failed:", e);
      }
      return catalog;
    }

    try {
      const { Command } = await import("@tauri-apps/plugin-shell");
      const args = ["index-semantics", "--scenes", "cache/scenes.json"];
      if (force) args.push("--force");
      const cmd = Command.sidecar("binaries/amv-engine", args);
      const output = await cmd.execute();
      if (output.code === 0) {
        return JSON.parse(output.stdout) as ScenesCatalog;
      }
    } catch (err) {
      console.warn("Tauri sidecar index-semantics failed:", err);
    }
    return catalog;
  }

  /**
   * Unified clip search & filter interface shared with the AI agent's tool calls.
   */
  async searchClips(
    catalog: ScenesCatalog,
    query: ClipSearchQuery
  ): Promise<ClipSearchHit[]> {
    if (this.isMockMode) {
      try {
        const res = await fetch("/api/search-clips", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scenes: catalog, query, projectId: this.activeProjectId }),
        });
        if (res.ok) {
          const data = (await res.json()) as {
            results?: ClipSearchHit[];
          };
          return data.results || [];
        }
      } catch (e) {
        console.warn("Dev server search-clips failed:", e);
      }
    }
    return [];
  }

  /**
   * Query cached SigLIP embeddings for natural-language vibe/expression search.
   */
  async semanticSearch(
    catalog: ScenesCatalog,
    query: string,
    topK: number = 25
  ): Promise<Array<{ scene_id: number; score: number }>> {
    if (!query.trim()) return [];
    if (this.isMockMode) {
      try {
        const res = await fetch("/api/semantic-search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scenes: catalog, query, topK, projectId: this.activeProjectId }),
        });
        if (res.ok) {
          const data = (await res.json()) as {
            results?: Array<{ scene_id: number; score: number }>;
          };
          return data.results || [];
        }
      } catch (e) {
        console.warn("Dev server semantic-search failed:", e);
      }
    }
    return [];
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
      try {
        const res = await fetch("/api/render", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ timeline, outputPath, options }),
        });
        if (res.ok && res.body) {
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          let completedResult: RenderResult | null = null;

          const handleLine = (line: string) => {
            const trimmed = line.trim();
            if (!trimmed.startsWith("{")) return;
            const data = JSON.parse(trimmed) as RenderProgress | RenderResult | { type: "error"; error?: string };
            if (data.type === "progress") {
              onProgress?.(data as RenderProgress);
            } else if (data.type === "completed") {
              completedResult = data as RenderResult;
            } else if (data.type === "error") {
              throw new Error((data as { error?: string }).error || "Render failed");
            }
          };

          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let nl = buffer.indexOf("\n");
            while (nl >= 0) {
              const line = buffer.slice(0, nl);
              buffer = buffer.slice(nl + 1);
              handleLine(line);
              nl = buffer.indexOf("\n");
            }
          }
          if (buffer.trim()) handleLine(buffer);
          if (completedResult) return completedResult;
        }
      } catch (err) {
        if (err instanceof Error && !err.message.includes("Failed to fetch")) {
          throw err;
        }
        console.warn("Dev server render unavailable, falling back to simulation:", err);
      }

      // Fallback simulation if dev server API is unreachable
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
    timeline: Timeline,
    outputPath: string,
    format: "otio" | "fcpxml" | "auto" = "auto"
  ): Promise<ExportResult> {
    if (this.isMockMode) {
      try {
        const res = await fetch("/api/export-project", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ timeline, outputPath, format }),
        });
        if (res.ok) {
          return (await res.json()) as ExportResult;
        }
      } catch (err) {
        console.warn("Dev server export-project unavailable, falling back:", err);
      }
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
