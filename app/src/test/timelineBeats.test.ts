import { describe, it, expect } from "vitest";
import {
  DEMO_BEATS,
  DEMO_SCENES,
  generateProceduralTimeline,
} from "../services/mockData";

describe("Timeline Beat & Synchronization Calculations", () => {
  it("calculates exact beat intervals from BPM", () => {
    const bpm = DEMO_BEATS.tempo_bpm; // 120.0
    const beatInterval = 60.0 / bpm; // 0.5s
    expect(beatInterval).toBe(0.5);

    // Verify synthetic beat array has 0.5s steps
    for (let i = 1; i < DEMO_BEATS.beats.length; i++) {
      const diff = DEMO_BEATS.beats[i] - DEMO_BEATS.beats[i - 1];
      expect(Math.abs(diff - 0.5)).toBeLessThan(1e-5);
    }
  });

  it("identifies measure downbeats correctly for 4/4 time signature", () => {
    const downbeats = DEMO_BEATS.downbeats;
    // At 120 BPM, 4/4 downbeats occur every 2.0s
    expect(downbeats[0]).toBe(0.0);
    expect(downbeats[1]).toBe(2.0);
    expect(downbeats[2]).toBe(4.0);
    expect(downbeats[3]).toBe(6.0);

    for (let i = 1; i < downbeats.length; i++) {
      const barDuration = downbeats[i] - downbeats[i - 1];
      expect(barDuration).toBeCloseTo(2.0, 5);
    }
  });

  it("partitions dynamic energy into contiguous musical segments", () => {
    const segments = DEMO_BEATS.energy_segments;
    expect(segments.length).toBeGreaterThan(0);

    // Verify first segment starts at 0
    expect(segments[0].start).toBe(0.0);

    // Verify contiguity
    for (let i = 1; i < segments.length; i++) {
      expect(segments[i].start).toBe(segments[i - 1].end);
    }

    // Verify last segment matches audio duration
    expect(segments[segments.length - 1].end).toBe(DEMO_BEATS.duration_sec);
  });

  it("generates contiguous, gapless timeline cuts synchronized with beats", () => {
    const timeline = generateProceduralTimeline(
      DEMO_BEATS,
      DEMO_SCENES,
      "High energy action drops",
      "Test Project"
    );

    expect(timeline.cuts.length).toBeGreaterThan(0);
    expect(timeline.project_title).toBe("Test Project");

    // First cut starts at 0
    expect(timeline.cuts[0].timeline_start).toBe(0.0);

    // Gapless verification
    for (let i = 1; i < timeline.cuts.length; i++) {
      const prevCut = timeline.cuts[i - 1];
      const curCut = timeline.cuts[i];
      expect(curCut.timeline_start).toBeCloseTo(prevCut.timeline_end, 3);
    }

    // Last cut ends at or near audio duration
    const lastCut = timeline.cuts[timeline.cuts.length - 1];
    expect(lastCut.timeline_end).toBeCloseTo(DEMO_BEATS.duration_sec, 1);
  });

  it("applies faster pacing intervals for action/drop prompts", () => {
    const actionTimeline = generateProceduralTimeline(
      DEMO_BEATS,
      DEMO_SCENES,
      "Rapid action cuts and frantic drops",
      "Action"
    );

    const normalTimeline = generateProceduralTimeline(
      DEMO_BEATS,
      DEMO_SCENES,
      "Slow atmospheric cinematic journey",
      "Cinematic"
    );

    // Action timeline should have more cuts (shorter cut durations)
    expect(actionTimeline.cuts.length).toBeGreaterThan(normalTimeline.cuts.length);
  });
});
