/**
 * TypeScript Data Contracts for AMV Maker UI
 * Generated from specs/schemas.json and engine CLI IPC contracts
 */

export type EnergyLevel = "low" | "medium" | "high" | "drop" | "outro" | "intro" | "build";

export interface EnergySegment {
  start: number;
  end: number;
  level: EnergyLevel;
  label: string;
}

export interface BeatsData {
  duration_sec: number;
  tempo_bpm: number;
  time_signature: string;
  downbeats: number[];
  beats: number[];
  energy_segments: EnergySegment[];
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
  has_faces?: boolean;
  face_count?: number;
  dominant_expression?: string;
  smile_score?: number;
  subject_prominence?: "close_up" | "medium_shot" | "wide_shot" | "scenic";
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
