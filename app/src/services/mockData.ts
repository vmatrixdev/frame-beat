import type { BeatsData, ScenesCatalog, Timeline, TimelineCut, TransitionType } from "../types/schemas";

/**
 * Generates an SVG data URL keyframe for synthetic/demo scenes.
 */
export function createSvgThumbnail(
  label: string,
  color: string,
  sharpness: number,
  motion: number
): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180">
    <defs>
      <linearGradient id="grad-${label.replace(/\s+/g, "_")}" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${color}" stop-opacity="0.85"/>
        <stop offset="100%" stop-color="#090d16" stop-opacity="0.95"/>
      </linearGradient>
    </defs>
    <rect width="320" height="180" fill="url(#grad-${label.replace(/\s+/g, "_")})" rx="8"/>
    <circle cx="160" cy="80" r="38" fill="${color}" opacity="0.35"/>
    <polygon points="152,65 174,80 152,95" fill="#ffffff" opacity="0.8"/>
    <text x="160" y="132" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif" font-size="13" font-weight="600" fill="#f8fafc" text-anchor="middle">${label}</text>
    <text x="160" y="152" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif" font-size="10.5" fill="#94a3b8" text-anchor="middle">Sharpness: ${sharpness.toFixed(1)} • Motion: ${motion.toFixed(1)}</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export const DEMO_BEATS: BeatsData = {
  duration_sec: 16.0,
  tempo_bpm: 120.0,
  time_signature: "4/4",
  downbeats: [0.0, 2.0, 4.0, 6.0, 8.0, 10.0, 12.0, 14.0],
  beats: [
    0.0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5,
    4.0, 4.5, 5.0, 5.5, 6.0, 6.5, 7.0, 7.5,
    8.0, 8.5, 9.0, 9.5, 10.0, 10.5, 11.0, 11.5,
    12.0, 12.5, 13.0, 13.5, 14.0, 14.5, 15.0, 15.5
  ],
  energy_segments: [
    { start: 0.0, end: 4.0, level: "intro", label: "Intro - Atmospheric Build" },
    { start: 4.0, end: 8.0, level: "medium", label: "Verse 1 - Rhythmic Drive" },
    { start: 8.0, end: 12.0, level: "build", label: "Pre-Chorus Build" },
    { start: 12.0, end: 16.0, level: "drop", label: "Chorus Drop - Maximum Energy" },
  ],
};

/**
 * Generates dynamic beat markers and energy segments for any given duration.
 */
export function generateBeatsForDuration(durationSec: number, tempoBpm = 128.0): BeatsData {
  const beatInterval = 60.0 / tempoBpm;
  const beats: number[] = [];
  const downbeats: number[] = [];

  for (let t = 0; t < durationSec; t += beatInterval) {
    beats.push(Number(t.toFixed(3)));
  }
  for (let t = 0; t < durationSec; t += beatInterval * 4) {
    downbeats.push(Number(t.toFixed(3)));
  }

  // Divide into 5 dynamic musical segments
  const segDur = durationSec / 5;
  const energy_segments = [
    { start: 0, end: Number(segDur.toFixed(2)), level: "intro" as const, label: "Intro - Atmospheric Build" },
    { start: Number(segDur.toFixed(2)), end: Number((segDur * 2).toFixed(2)), level: "medium" as const, label: "Verse 1 - Rhythmic Drive" },
    { start: Number((segDur * 2).toFixed(2)), end: Number((segDur * 3).toFixed(2)), level: "build" as const, label: "Pre-Chorus Build" },
    { start: Number((segDur * 3).toFixed(2)), end: Number((segDur * 4.2).toFixed(2)), level: "drop" as const, label: "Chorus Drop - Maximum Energy" },
    { start: Number((segDur * 4.2).toFixed(2)), end: Number(durationSec.toFixed(2)), level: "outro" as const, label: "Outro - Resolution" },
  ];

  return {
    duration_sec: Number(durationSec.toFixed(2)),
    tempo_bpm: tempoBpm,
    time_signature: "4/4",
    downbeats,
    beats,
    energy_segments,
  };
}

export const DEMO_SCENES: ScenesCatalog = {
  source_files: [
    "anime_raws/episode_01_cyber_city.mp4",
    "anime_raws/episode_02_katana_duel.mp4",
    "anime_raws/episode_03_neon_chase.mp4",
  ],
  total_scenes: 6,
  scenes: [
    {
      scene_id: 0,
      source_file: "anime_raws/episode_01_cyber_city.mp4",
      start_time: 1.0,
      end_time: 3.5,
      duration: 2.5,
      keyframe_path: createSvgThumbnail("Cyber City Skyline", "#6366f1", 185.4, 82.1),
      sharpness_score: 185.4,
      motion_score: 82.1,
      brightness_score: 142.0,
    },
    {
      scene_id: 1,
      source_file: "anime_raws/episode_01_cyber_city.mp4",
      start_time: 10.2,
      end_time: 12.7,
      duration: 2.5,
      keyframe_path: createSvgThumbnail("Neon Rain Alley", "#ec4899", 210.0, 94.6),
      sharpness_score: 210.0,
      motion_score: 94.6,
      brightness_score: 168.0,
    },
    {
      scene_id: 2,
      source_file: "anime_raws/episode_02_katana_duel.mp4",
      start_time: 45.0,
      end_time: 48.0,
      duration: 3.0,
      keyframe_path: createSvgThumbnail("Katana Stance Close-Up", "#06b6d4", 160.2, 71.3),
      sharpness_score: 160.2,
      motion_score: 71.3,
      brightness_score: 120.0,
    },
    {
      scene_id: 3,
      source_file: "anime_raws/episode_02_katana_duel.mp4",
      start_time: 88.5,
      end_time: 91.0,
      duration: 2.5,
      keyframe_path: createSvgThumbnail("Blade Clash Sparks", "#eab308", 240.8, 98.2),
      sharpness_score: 240.8,
      motion_score: 98.2,
      brightness_score: 190.5,
    },
    {
      scene_id: 4,
      source_file: "anime_raws/episode_03_neon_chase.mp4",
      start_time: 15.0,
      end_time: 18.0,
      duration: 3.0,
      keyframe_path: createSvgThumbnail("Motorcycle Drift", "#10b981", 175.0, 65.0),
      sharpness_score: 175.0,
      motion_score: 65.0,
      brightness_score: 110.0,
    },
    {
      scene_id: 5,
      source_file: "anime_raws/episode_03_neon_chase.mp4",
      start_time: 50.0,
      end_time: 53.0,
      duration: 3.0,
      keyframe_path: createSvgThumbnail("Explosion Aftermath", "#f97316", 230.5, 91.0),
      sharpness_score: 230.5,
      motion_score: 91.0,
      brightness_score: 175.0,
    },
  ],
};

export const DEMO_TIMELINE: Timeline = {
  project_title: "Neon Cybernetic Overdrive",
  target_audio: "/audio/synthwave_120bpm.wav",
  cuts: [
    {
      scene_id: 0,
      source_file: "anime_raws/episode_01_cyber_city.mp4",
      source_in: 1.0,
      source_out: 3.0,
      timeline_start: 0.0,
      timeline_end: 2.0,
      transition: "cut",
      pacing_beat_interval: 4,
      keyframe_path: createSvgThumbnail("Cyber City Skyline", "#6366f1", 185.4, 82.1),
    },
    {
      scene_id: 2,
      source_file: "anime_raws/episode_02_katana_duel.mp4",
      source_in: 45.0,
      source_out: 47.0,
      timeline_start: 2.0,
      timeline_end: 4.0,
      transition: "crossfade",
      pacing_beat_interval: 4,
      keyframe_path: createSvgThumbnail("Katana Stance Close-Up", "#06b6d4", 160.2, 71.3),
    },
    {
      scene_id: 1,
      source_file: "anime_raws/episode_01_cyber_city.mp4",
      source_in: 10.2,
      source_out: 12.2,
      timeline_start: 4.0,
      timeline_end: 6.0,
      transition: "cut",
      pacing_beat_interval: 4,
      keyframe_path: createSvgThumbnail("Neon Rain Alley", "#ec4899", 210.0, 94.6),
    },
    {
      scene_id: 4,
      source_file: "anime_raws/episode_03_neon_chase.mp4",
      source_in: 15.0,
      source_out: 17.0,
      timeline_start: 6.0,
      timeline_end: 8.0,
      transition: "zoom_in",
      pacing_beat_interval: 4,
      keyframe_path: createSvgThumbnail("Motorcycle Drift", "#10b981", 175.0, 65.0),
    },
    {
      scene_id: 3,
      source_file: "anime_raws/episode_02_katana_duel.mp4",
      source_in: 88.5,
      source_out: 90.5,
      timeline_start: 8.0,
      timeline_end: 10.0,
      transition: "cut",
      pacing_beat_interval: 4,
      keyframe_path: createSvgThumbnail("Blade Clash Sparks", "#eab308", 240.8, 98.2),
    },
    {
      scene_id: 5,
      source_file: "anime_raws/episode_03_neon_chase.mp4",
      source_in: 50.0,
      source_out: 51.0,
      timeline_start: 10.0,
      timeline_end: 11.0,
      transition: "flash_white",
      pacing_beat_interval: 2,
      keyframe_path: createSvgThumbnail("Explosion Aftermath", "#f97316", 230.5, 91.0),
    },
    {
      scene_id: 1,
      source_file: "anime_raws/episode_01_cyber_city.mp4",
      source_in: 11.0,
      source_out: 12.0,
      timeline_start: 11.0,
      timeline_end: 12.0,
      transition: "cut",
      pacing_beat_interval: 2,
      keyframe_path: createSvgThumbnail("Neon Rain Alley", "#ec4899", 210.0, 94.6),
    },
    {
      scene_id: 3,
      source_file: "anime_raws/episode_02_katana_duel.mp4",
      source_in: 89.0,
      source_out: 90.0,
      timeline_start: 12.0,
      timeline_end: 13.0,
      transition: "whip_pan",
      pacing_beat_interval: 2,
      keyframe_path: createSvgThumbnail("Blade Clash Sparks", "#eab308", 240.8, 98.2),
    },
    {
      scene_id: 5,
      source_file: "anime_raws/episode_03_neon_chase.mp4",
      source_in: 51.0,
      source_out: 52.0,
      timeline_start: 13.0,
      timeline_end: 14.0,
      transition: "flash_white",
      pacing_beat_interval: 2,
      keyframe_path: createSvgThumbnail("Explosion Aftermath", "#f97316", 230.5, 91.0),
    },
    {
      scene_id: 0,
      source_file: "anime_raws/episode_01_cyber_city.mp4",
      source_in: 1.5,
      source_out: 3.5,
      timeline_start: 14.0,
      timeline_end: 16.0,
      transition: "cut",
      pacing_beat_interval: 4,
      keyframe_path: createSvgThumbnail("Cyber City Skyline", "#6366f1", 185.4, 82.1),
    },
  ],
};

/**
 * Procedurally generates a timeline given beats, scenes catalog, and user prompt.
 * Used for deterministic offline mock direction when cloud LLM is not called.
 */
export function generateProceduralTimeline(
  beats: BeatsData,
  catalog: ScenesCatalog,
  prompt: string,
  title: string = "AMV Direct"
): Timeline {
  const cuts: TimelineCut[] = [];
  const scenes = catalog.scenes;
  if (!scenes.length || !beats.beats.length) {
    return {
      project_title: title,
      target_audio: "target_audio.wav",
      cuts: [],
    };
  }

  // Determine beat pacing interval based on prompt keyword or default to 4 (every measure)
  let pacingInterval = 4;
  const lowerPrompt = prompt.toLowerCase();
  if (lowerPrompt.includes("fast") || lowerPrompt.includes("action") || lowerPrompt.includes("drop")) {
    pacingInterval = 2;
  }
  if (lowerPrompt.includes("rapid") || lowerPrompt.includes("glitch") || lowerPrompt.includes("frenzy")) {
    pacingInterval = 1;
  }

  const duration = beats.duration_sec;
  const beatInterval = 60.0 / beats.tempo_bpm;
  let curTimelineTime = 0.0;
  let sceneIdx = 0;


  while (curTimelineTime < duration - 0.05) {
    // Determine current energy segment
    const curSeg = beats.energy_segments.find(
      (s) => curTimelineTime >= s.start && curTimelineTime < s.end
    );
    const isHighEnergy = curSeg?.level === "drop" || curSeg?.level === "high";

    // Adaptive cut duration: faster cuts during drops/high energy
    const effectiveInterval = isHighEnergy ? Math.max(1, Math.floor(pacingInterval / 2)) : pacingInterval;
    const cutDur = effectiveInterval * beatInterval;
    const nextTimelineTime = Math.min(curTimelineTime + cutDur, duration);

    // Pick scene: favor high sharpness/motion for high energy
    let chosenScene = scenes[sceneIdx % scenes.length];
    if (isHighEnergy) {
      const topSharpness = [...scenes].sort(
        (a, b) => (b.sharpness_score ?? 0) - (a.sharpness_score ?? 0)
      );
      chosenScene = topSharpness[sceneIdx % topSharpness.length];
    }

    const availableSceneDuration = chosenScene.duration;
    const clipDur = nextTimelineTime - curTimelineTime;
    const sourceIn = chosenScene.start_time;
    const sourceOut = sourceIn + Math.min(clipDur, availableSceneDuration);

    let transition: TransitionType = "cut";
    if (isHighEnergy) {
      transition = sceneIdx % 2 === 0 ? "flash_white" : "whip_pan";
    } else if (sceneIdx % 3 === 0) {
      transition = "crossfade";
    }

    cuts.push({
      scene_id: chosenScene.scene_id,
      source_file: chosenScene.source_file,
      source_in: Number(sourceIn.toFixed(3)),
      source_out: Number(sourceOut.toFixed(3)),
      timeline_start: Number(curTimelineTime.toFixed(3)),
      timeline_end: Number(nextTimelineTime.toFixed(3)),
      transition,
      pacing_beat_interval: effectiveInterval,
      keyframe_path: chosenScene.keyframe_path,
    });

    curTimelineTime = nextTimelineTime;
    sceneIdx++;
  }

  return {
    project_title: title,
    target_audio: "target_audio.wav",
    cuts,
  };
}
