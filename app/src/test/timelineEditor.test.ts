import { describe, it, expect } from "vitest";
import {
  moveCut,
  trimCutLeft,
  trimCutRight,
  splitCutAtTime,
  cycleCutTransition,
  duplicateCutToTrack,
  buildCutFromScene,
  snapToBeat,
} from "../utils/timelineEditor";
import type { BeatsData, SceneCut, TimelineCut } from "../types/schemas";

const MOCK_BEATS: BeatsData = {
  duration_sec: 10.0,
  tempo_bpm: 120.0,
  time_signature: "4/4",
  downbeats: [0.0, 2.0, 4.0, 6.0, 8.0],
  beats: [0.0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0],
  energy_segments: [],
};

const BASE_CUTS: TimelineCut[] = [
  {
    source_file: "/media/clip1.mp4",
    source_in: 2.0,
    source_out: 6.0,
    timeline_start: 0.0,
    timeline_end: 4.0,
    transition: "cut",
    track_index: 0,
  },
];

describe("NLE timelineEditor utilities", () => {
  it("snaps timestamps to nearest beat within threshold", () => {
    expect(snapToBeat(1.46, MOCK_BEATS, 0.14)).toBe(1.5);
    expect(snapToBeat(1.75, MOCK_BEATS, 0.1)).toBe(1.75);
  });

  it("moves a cut horizontally while preserving duration", () => {
    const moved = moveCut(BASE_CUTS, 0, 2.48, MOCK_BEATS, true);
    expect(moved[0].timeline_start).toBe(2.5);
    expect(moved[0].timeline_end).toBe(6.5);
  });

  it("trims left edge and adjusts source_in without going negative", () => {
    const trimmed = trimCutLeft(BASE_CUTS, 0, 1.0);
    expect(trimmed[0].timeline_start).toBe(1.0);
    expect(trimmed[0].source_in).toBe(3.0);
    expect(trimmed[0].timeline_end).toBe(4.0);
  });

  it("stretches and trims right edge of video and still image", () => {
    const stretched = trimCutRight(BASE_CUTS, 0, 1.5);
    expect(stretched[0].timeline_end).toBe(5.5);
    expect(stretched[0].source_out).toBe(7.5);

    const imgCut: TimelineCut[] = [
      {
        source_file: "/media/photo.jpg",
        source_in: 0.0,
        source_out: 0.0,
        timeline_start: 0.0,
        timeline_end: 3.0,
        transition: "crossfade",
        track_index: 0,
      },
    ];
    const stretchedImg = trimCutRight(imgCut, 0, 2.0, { isStillImage: true });
    expect(stretchedImg[0].timeline_end).toBe(5.0);
    expect(stretchedImg[0].source_out).toBe(0.0);
  });

  it("splits a cut at playhead into two contiguous segments", () => {
    const split = splitCutAtTime(BASE_CUTS, 0, 1.5);
    expect(split).toHaveLength(2);
    expect(split[0].timeline_start).toBe(0.0);
    expect(split[0].timeline_end).toBe(1.5);
    expect(split[0].source_in).toBe(2.0);
    expect(split[0].source_out).toBe(3.5);

    expect(split[1].timeline_start).toBe(1.5);
    expect(split[1].timeline_end).toBe(4.0);
    expect(split[1].source_in).toBe(3.5);
    expect(split[1].source_out).toBe(6.0);
  });

  it("cycles transitions, duplicates to track V2, and builds cuts from SceneCut", () => {
    const cycled = cycleCutTransition(BASE_CUTS, 0);
    expect(cycled[0].transition).toBe("crossfade");

    const duped = duplicateCutToTrack(BASE_CUTS, 0, 1);
    expect(duped).toHaveLength(2);
    expect(duped[1].track_index).toBe(1);

    const scene: SceneCut = {
      scene_id: 2,
      source_file: "/media/raw.mp4",
      start_time: 1.0,
      end_time: 5.0,
      duration: 4.0,
      media_type: "video",
      is_still_image: false,
    };
    const built = buildCutFromScene(scene, 6.0, 1);
    expect(built.timeline_start).toBe(6.0);
    expect(built.timeline_end).toBe(10.0);
    expect(built.source_in).toBe(1.0);
    expect(built.source_out).toBe(5.0);
    expect(built.track_index).toBe(1);
  });
});
