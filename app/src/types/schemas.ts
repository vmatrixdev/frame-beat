/**
 * TypeScript Data Contracts for AMV Maker UI
 * Generated from specs/schemas.json and engine CLI IPC contracts
 */

export type EnergyLevel = "low" | "medium" | "high" | "drop" | "outro" | "intro" | "build";

export interface PinnedVideoRange {
  source_file: string;
  start_sec: number;
  end_sec: number;
}

export interface AudioCueNote {
  id: string;
  timestamp_ms: number;
  end_ms?: number;
  tags: string[];
  note: string;
  pinned_scene_ids?: number[];
  pinned_ranges?: PinnedVideoRange[];
}

export interface ShortlistCandidate {
  scene_id: number;
  source_file: string;
  start_time: number;
  end_time: number;
  score: number;
  reason: string;
  matched_criteria?: string[];
}

export interface SegmentShortlist {
  start_ms: number;
  end_ms: number;
  segment_summary?: string;
  candidates: ShortlistCandidate[];
}

export interface EnergySegment {
  start: number;
  end: number;
  level: EnergyLevel;
  label: string;
  vocal_energy?: number;
  percussive_energy?: number;
  bass_energy?: number;
  spectral_brightness?: number;
  audio_mood?: string;
}

export interface BeatsData {
  duration_sec: number;
  tempo_bpm: number;
  time_signature: string;
  downbeats: number[];
  beats: number[];
  energy_segments: EnergySegment[];
  audio_notes?: AudioCueNote[];
}

export interface SceneCut {
  scene_id: number;
  source_file: string;
  start_time: number;
  end_time: number;
  duration: number;
  media_type?: "video" | "image";
  is_still_image?: boolean;
  keyframe_path?: string;
  sharpness_score?: number;
  motion_score?: number;
  brightness_score?: number;
  contrast_score?: number;
  saturation_score?: number;
  fluidity_score?: number;
  dramatism_score?: number;
  color_mood?: string;
  visual_mood?: string;
  has_faces?: boolean;
  face_count?: number;
  dominant_expression?: string;
  smile_score?: number;
  emotion_scores?: Record<string, number>;
  subject_prominence?: "close_up" | "medium_shot" | "wide_shot" | "scenic";
  user_tags?: string[];
  user_note?: string;
  semantic_tags?: string[];
  vibe_scores?: Record<string, number>;
}

export interface ScenesCatalog {
  source_files: string[];
  total_scenes: number;
  scenes: SceneCut[];
}

export type TransitionType = "cut" | "crossfade" | "flash_white" | "zoom_in" | "whip_pan";

export interface TimelineCut {
  source_file: string;
  source_in: number;
  source_out: number;
  timeline_start: number;
  timeline_end: number;
  transition: TransitionType;
  pacing_beat_interval?: number;
  scene_id?: number;
  keyframe_path?: string;
  track_index?: number;
  user_tags?: string[];
  user_note?: string;
  semantic_tags?: string[];
  vibe_scores?: Record<string, number>;
}

export interface AudioTrackItem {
  id: string;
  name: string;
  audioFile: string;
  beats: BeatsData | null;
  muted: boolean;
  solo: boolean;
}

export interface Timeline {
  project_title: string;
  target_audio: string;
  cuts: TimelineCut[];
}

export interface RenderOptions {
  codec?: string;
  hwaccel?: boolean;
  preset?: string;
  resolution?: string;
  fps?: number;
}

export interface RenderProgress {
  type: "progress";
  percent: number;
  currentTime: number;
  totalTime: number;
  fps: number;
  speed: string;
  frame?: number;
}

export interface RenderResult {
  type: "completed";
  status: "success" | "failed";
  outputPath: string;
  duration?: number;
  error?: string;
}

export interface ExportResult {
  type: "completed";
  status: "success" | "failed";
  outputPath: string;
  format?: string;
  error?: string;
}

export type ClipSearchSortBy =
  | "relevance"
  | "index"
  | "sharpness"
  | "brightness"
  | "fluidity"
  | "dramatism";

export interface ClipSearchQuery {
  query_text?: string;
  tags?: string[];
  semantic_tag?: string;
  visual_mood?: string;
  color_mood?: string;
  expression?: string;
  min_duration?: number;
  max_duration?: number;
  min_fluidity?: number;
  min_dramatism?: number;
  has_faces?: boolean;
  media_type?: "video" | "image";
  source_file?: string;
  sort_by?: ClipSearchSortBy;
  limit?: number;
}

export interface ClipSearchHit {
  scene_id: number;
  match_score: number;
  semantic_score?: number;
}

export interface ProjectSummary {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  scene_count: number;
  has_audio: boolean;
  has_timeline: boolean;
}

export interface ProjectData {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  audio_file?: string | null;
  user_prompt?: string;
  audio_notes?: AudioCueNote[];
  beats?: BeatsData | null;
  scenes?: ScenesCatalog | null;
  timeline?: Timeline | null;
}
