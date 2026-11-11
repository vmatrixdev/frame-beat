/**
 * Strongly-Typed IPC Client for AMV Maker Media Engine.
 * Supports both Tauri v2 native execution (via @tauri-apps/plugin-shell / invoke)
 * and an interactive offline mock mode for browser testing and frontend development.
 */

import type {
  BeatsData,
  ScenesCatalog,
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
} from "./mockData";

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
  async analyzeSoundtrack(audioPath: string): Promise<BeatsData> {
    if (this.isMockMode) {
      // Simulate realistic analysis delay (150ms)
      await new Promise((resolve) => setTimeout(resolve, 150));
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
   * Run scene detection & keyframe extraction on source videos directory.
   */
  async analyzeScenes(videoDir: string, thumbsDir?: string): Promise<ScenesCatalog> {
    if (this.isMockMode) {
      await new Promise((resolve) => setTimeout(resolve, 200));
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
