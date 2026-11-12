import type { BeatsData, SceneCut, TimelineCut, TransitionType } from "../types/schemas";

const MIN_CLIP_DURATION = 0.2;
const TRANSITIONS_ORDER: TransitionType[] = [
  "cut",
  "crossfade",
  "flash_white",
  "zoom_in",
  "whip_pan",
];

function roundMs(val: number): number {
  return Number(val.toFixed(3));
}

/**
 * Snaps a timestamp to the nearest musical beat if within thresholdSec.
 */
export function snapToBeat(
  timeSec: number,
  beats: BeatsData | null | undefined,
  thresholdSec = 0.14
): number {
  if (!beats || beats.beats.length === 0) return roundMs(Math.max(0, timeSec));
  let closest = timeSec;
  let minDiff = thresholdSec;
  for (const b of beats.beats) {
    const diff = Math.abs(b - timeSec);
    if (diff <= minDiff) {
      minDiff = diff;
      closest = b;
    }
  }
  return roundMs(Math.max(0, closest));
}

/**
 * Builds a TimelineCut from a SceneCut at a specific timelineStart and trackIndex.
 */
export function buildCutFromScene(
  scene: SceneCut,
  timelineStart: number,
  trackIndex = 0,
  transition: TransitionType = "cut"
): TimelineCut {
  const isImg = Boolean(scene.is_still_image || scene.media_type === "image");
  const clipDuration = isImg ? 3.0 : scene.duration > 0 ? scene.duration : 4.0;
  const sourceIn = scene.scene_id < 0 ? 0.0 : scene.start_time;
  const sourceOut = isImg ? 0.0 : roundMs(sourceIn + clipDuration);

  return {
    source_file: scene.source_file,
    source_in: roundMs(sourceIn),
    source_out: sourceOut,
    timeline_start: roundMs(Math.max(0, timelineStart)),
    timeline_end: roundMs(Math.max(0, timelineStart) + clipDuration),
    transition,
    scene_id: scene.scene_id,
    keyframe_path: scene.keyframe_path,
    track_index: trackIndex,
  };
}

/**
 * Moves a cut horizontally along the timeline and/or vertically across video tracks (preserving clip duration).
 */
export function moveCut(
  cuts: TimelineCut[],
  cutIndex: number,
  newTimelineStart: number,
  beats?: BeatsData | null,
  snapEnabled = false,
  newTrackIndex?: number
): TimelineCut[] {
  const target = cuts[cutIndex];
  if (!target) return cuts;
  const dur = Math.max(MIN_CLIP_DURATION, target.timeline_end - target.timeline_start);
  let clampedStart = Math.max(0, newTimelineStart);
  if (snapEnabled) {
    clampedStart = snapToBeat(clampedStart, beats);
  }
  return cuts.map((cut, i) =>
    i === cutIndex
      ? {
          ...cut,
          timeline_start: roundMs(clampedStart),
          timeline_end: roundMs(clampedStart + dur),
          ...(newTrackIndex !== undefined ? { track_index: Math.max(0, newTrackIndex) } : {}),
        }
      : cut
  );
}

/**
 * Trims/stretches the left edge of a cut, adjusting timeline_start and source_in.
 */
export function trimCutLeft(
  cuts: TimelineCut[],
  cutIndex: number,
  deltaSec: number,
  options?: {
    isStillImage?: boolean;
    beats?: BeatsData | null;
    snapEnabled?: boolean;
  }
): TimelineCut[] {
  const target = cuts[cutIndex];
  if (!target) return cuts;
  const isImg = Boolean(options?.isStillImage);

  let nextStart = target.timeline_start + deltaSec;
  if (options?.snapEnabled) {
    nextStart = snapToBeat(nextStart, options.beats);
  }

  // Clamp so timeline_start >= 0 and clip keeps at least MIN_CLIP_DURATION
  nextStart = Math.max(0, Math.min(target.timeline_end - MIN_CLIP_DURATION, nextStart));

  if (isImg) {
    return cuts.map((cut, i) =>
      i === cutIndex ? { ...cut, timeline_start: roundMs(nextStart) } : cut
    );
  }

  // For video, ensure source_in >= 0
  const appliedDelta = nextStart - target.timeline_start;
  let nextSourceIn = target.source_in + appliedDelta;
  if (nextSourceIn < 0) {
    const overflow = -nextSourceIn;
    nextSourceIn = 0;
    nextStart += overflow;
  }

  return cuts.map((cut, i) =>
    i === cutIndex
      ? {
          ...cut,
          timeline_start: roundMs(nextStart),
          source_in: roundMs(nextSourceIn),
        }
      : cut
  );
}

/**
 * Trims/stretches the right edge of a cut, adjusting timeline_end and source_out.
 */
export function trimCutRight(
  cuts: TimelineCut[],
  cutIndex: number,
  deltaSec: number,
  options?: {
    isStillImage?: boolean;
    maxSourceDuration?: number;
    beats?: BeatsData | null;
    snapEnabled?: boolean;
  }
): TimelineCut[] {
  const target = cuts[cutIndex];
  if (!target) return cuts;
  const isImg = Boolean(options?.isStillImage);

  let nextEnd = target.timeline_end + deltaSec;
  if (options?.snapEnabled) {
    nextEnd = snapToBeat(nextEnd, options.beats);
  }

  nextEnd = Math.max(target.timeline_start + MIN_CLIP_DURATION, nextEnd);

  if (isImg) {
    return cuts.map((cut, i) =>
      i === cutIndex ? { ...cut, timeline_end: roundMs(nextEnd) } : cut
    );
  }

  const appliedDelta = nextEnd - target.timeline_end;
  let nextSourceOut = target.source_out + appliedDelta;
  if (options?.maxSourceDuration && nextSourceOut > options.maxSourceDuration) {
    const excess = nextSourceOut - options.maxSourceDuration;
    nextSourceOut = options.maxSourceDuration;
    nextEnd = Math.max(target.timeline_start + MIN_CLIP_DURATION, nextEnd - excess);
  }

  return cuts.map((cut, i) =>
    i === cutIndex
      ? {
          ...cut,
          timeline_end: roundMs(nextEnd),
          source_out: roundMs(Math.max(target.source_in + MIN_CLIP_DURATION, nextSourceOut)),
        }
      : cut
  );
}

/**
 * Splits a cut into two adjacent clips at splitTime (in timeline seconds).
 */
export function splitCutAtTime(
  cuts: TimelineCut[],
  cutIndex: number,
  splitTime: number
): TimelineCut[] {
  const target = cuts[cutIndex];
  if (!target) return cuts;
  if (
    splitTime <= target.timeline_start + MIN_CLIP_DURATION ||
    splitTime >= target.timeline_end - MIN_CLIP_DURATION
  ) {
    return cuts;
  }

  const offset = splitTime - target.timeline_start;
  const isImg = target.source_out <= target.source_in;
  const splitSource = isImg ? target.source_in : roundMs(target.source_in + offset);

  const firstHalf: TimelineCut = {
    ...target,
    timeline_end: roundMs(splitTime),
    source_out: isImg ? target.source_out : splitSource,
  };

  const secondHalf: TimelineCut = {
    ...target,
    timeline_start: roundMs(splitTime),
    source_in: splitSource,
    transition: "cut",
  };

  return [...cuts.slice(0, cutIndex), firstHalf, secondHalf, ...cuts.slice(cutIndex + 1)];
}

/**
 * Cycles the transition type on a cut.
 */
export function cycleCutTransition(cuts: TimelineCut[], cutIndex: number): TimelineCut[] {
  const target = cuts[cutIndex];
  if (!target) return cuts;
  const idx = TRANSITIONS_ORDER.indexOf(target.transition);
  const nextTransition = TRANSITIONS_ORDER[(idx + 1) % TRANSITIONS_ORDER.length];
  return cuts.map((c, i) => (i === cutIndex ? { ...c, transition: nextTransition } : c));
}

/**
 * Duplicates a cut onto another video track for experimenting with alternate versions.
 */
export function duplicateCutToTrack(
  cuts: TimelineCut[],
  cutIndex: number,
  targetTrackIndex: number
): TimelineCut[] {
  const target = cuts[cutIndex];
  if (!target) return cuts;
  return [
    ...cuts,
    {
      ...target,
      track_index: targetTrackIndex,
    },
  ];
}

export interface ZoomAnchor {
  mouseXInViewport: number;
  ratio: number;
}

/**
 * Captures the horizontal content ratio under the pointer so zooming keeps
 * the pointed timeline position anchored under the cursor.
 */
export function computeZoomAnchor(
  scrollLeft: number,
  viewportWidth: number,
  contentWidth: number,
  pointerOffsetX: number
): ZoomAnchor {
  const clampedX = Math.max(0, Math.min(viewportWidth, pointerOffsetX));
  const safeContentWidth = Math.max(1, contentWidth);
  return {
    mouseXInViewport: clampedX,
    ratio: (scrollLeft + clampedX) / safeContentWidth,
  };
}

/**
 * Computes the new scrollLeft after a zoom change so `anchor` remains at
 * `anchor.mouseXInViewport` inside the viewport.
 */
export function computeZoomScrollLeft(
  anchor: ZoomAnchor,
  newContentWidth: number,
  viewportWidth: number
): number {
  const maxScroll = Math.max(0, newContentWidth - viewportWidth);
  const target = anchor.ratio * newContentWidth - anchor.mouseXInViewport;
  return Math.max(0, Math.min(maxScroll, target));
}
