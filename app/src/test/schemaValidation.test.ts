import { describe, it, expect } from "vitest";
import { DEMO_BEATS, DEMO_SCENES, DEMO_TIMELINE } from "../services/mockData";
import type {
  BeatsData,
  ScenesCatalog,
  Timeline,
  TransitionType,
} from "../types/schemas";

const VALID_TRANSITIONS: TransitionType[] = [
  "cut",
  "crossfade",
  "flash_white",
  "zoom_in",
  "whip_pan",
];

describe("Schema Validation (specs/schemas.json Contracts)", () => {
  it("validates BeatsData conforming to schema specification", () => {
    const beats: BeatsData = DEMO_BEATS;

    expect(typeof beats.duration_sec).toBe("number");
    expect(beats.duration_sec).toBeGreaterThan(0);

    expect(typeof beats.tempo_bpm).toBe("number");
    expect(beats.tempo_bpm).toBeGreaterThan(0);

    expect(typeof beats.time_signature).toBe("string");
    expect(beats.time_signature).toMatch(/^\d+\/\d+$/);

    expect(Array.isArray(beats.downbeats)).toBe(true);
    expect(Array.isArray(beats.beats)).toBe(true);
    expect(Array.isArray(beats.energy_segments)).toBe(true);

    beats.energy_segments.forEach((seg) => {
      expect(typeof seg.start).toBe("number");
      expect(typeof seg.end).toBe("number");
      expect(seg.end).toBeGreaterThan(seg.start);
      expect([
        "low",
        "medium",
        "high",
        "drop",
        "outro",
        "intro",
        "build",
      ]).toContain(seg.level);
      expect(typeof seg.label).toBe("string");
    });
  });

  it("validates ScenesCatalog conforming to schema specification", () => {
    const catalog: ScenesCatalog = DEMO_SCENES;

    expect(Array.isArray(catalog.source_files)).toBe(true);
    expect(catalog.source_files.length).toBeGreaterThan(0);
    expect(typeof catalog.total_scenes).toBe("number");
    expect(catalog.total_scenes).toBe(catalog.scenes.length);

    catalog.scenes.forEach((cut) => {
      expect(typeof cut.scene_id).toBe("number");
      expect(typeof cut.source_file).toBe("string");
      expect(typeof cut.start_time).toBe("number");
      expect(typeof cut.end_time).toBe("number");
      expect(cut.end_time).toBeGreaterThan(cut.start_time);
      expect(typeof cut.duration).toBe("number");
      expect(cut.duration).toBeCloseTo(cut.end_time - cut.start_time, 3);
    });
  });

  it("validates Timeline conforming to schema specification", () => {
    const timeline: Timeline = DEMO_TIMELINE;

    expect(typeof timeline.project_title).toBe("string");
    expect(typeof timeline.target_audio).toBe("string");
    expect(Array.isArray(timeline.cuts)).toBe(true);
    expect(timeline.cuts.length).toBeGreaterThan(0);

    timeline.cuts.forEach((cut) => {
      expect(typeof cut.source_file).toBe("string");
      expect(typeof cut.source_in).toBe("number");
      expect(typeof cut.source_out).toBe("number");
      expect(cut.source_out).toBeGreaterThan(cut.source_in);

      expect(typeof cut.timeline_start).toBe("number");
      expect(typeof cut.timeline_end).toBe("number");
      expect(cut.timeline_end).toBeGreaterThan(cut.timeline_start);

      expect(VALID_TRANSITIONS).toContain(cut.transition);
    });
  });
});
