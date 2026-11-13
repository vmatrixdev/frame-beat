# AMV Maker: Project Backlog

## Overview
AMV Maker is an automated Anime Music Video creation suite that uses deterministic audio beat detection (Phase 1), an LLM Director via Gemini structured outputs (Phase 2), and a local FFmpeg / OpenTimelineIO assembler (Phase 3), wrapped in a Tauri v2 + React desktop shell.

---

## Milestone 1: Python Media Engine (`engine/`)
Core processing library and CLI sidecar.

- [x] **1.1: Project Setup & Package Configuration**
  - Initialize Python project with `pyproject.toml` (compatible with `uv` and standard venv).
  - Configure dependencies: `librosa`, `soundfile`, `scenedetect[opencv]`, `pydantic`, `ffmpeg-python`, `google-genai`, `numpy`.
  - Implement typed Pydantic models matching `specs/schemas.json`.

- [x] **1.2: Audio Analyzer (`engine/audio_analyzer.py`)**
  - Extract waveform, compute tempo (`tempo_bpm`), and detect beat frames with `librosa.beat.beat_track`.
  - Extract downbeats using onset strength and musical bar tracking (4/4 time signature).
  - Calculate RMS dynamic energy across sliding windows (e.g., 2-second windows) to partition into segments: `intro`, `verse`, `build`, `drop`, `chorus`, `outro`.
  - Output standardized `beats.json`.

- [x] **1.3: Visual Segmenter (`engine/visual_analyzer.py`)**
  - Run PySceneDetect (`ContentDetector` / `AdaptiveDetector`) on source video directory or files.
  - Export representative keyframe thumbnails into a cache folder.
  - Compute frame metrics: sharpness score (Laplacian variance), basic color brightness, and scene duration.
  - Output standardized `scenes.json`.

- [x] **1.4: LLM Director (`engine/director.py`)**
  - Connect to Gemini 2.0 / 1.5 Flash using the Google GenAI SDK.
  - Formulate structured prompt ingesting `beats.json`, `scenes.json`, and narrative creative directives.
  - Enforce `response_schema` adhering to `Timeline` schema.
  - Match intense high-energy scenes / cuts to musical drops and downbeats; generate `timeline.json`.
  - Offline deterministic fallback mode when `GEMINI_API_KEY` is not present.

---

## Milestone 2: Assembler & Exporter (`engine/stitcher.py`)
Deterministic timeline assembly and NLE interchange.

- [x] **2.1: FFmpeg Stitcher**
  - Implement deterministic filter complexes (`concat`, `trim`, `setpts`) to assemble cuts frame-accurately.
  - Add audio muxing aligning `target_audio` exactly with video timeline.
  - Support hardware acceleration flags (e.g. VideoToolbox on macOS).

- [x] **2.2: OpenTimelineIO / FCPXML Exporter**
  - Export timeline cuts to `.otio` and `.fcpxml` formats.
  - Verify import compatibility with DaVinci Resolve and Final Cut Pro.

- [x] **2.3: CLI Sidecar Interface (`engine/main.py`)**
  - Build CLI commands (`analyze-audio`, `analyze-video`, `direct`, `render`, `export-otio`).
  - Ensure stdout streaming progress and JSON results for IPC sidecar integration with Tauri.

---

## Milestone 3: Tauri Desktop Shell (`app/`)
Desktop application interface for visual editing and scrubbing.

- [x] **3.1: Tauri v2 + Vite + React Setup**
  - Initialize Tauri v2 shell with React, TypeScript, and Tailwind CSS.
  - Configure sidecar permissions for executing `amv-engine` binaries.

- [x] **3.2: Media Import & Drop Zones**
  - Drag-and-drop zones for audio tracks and source video folders.
  - Status indicators for background analysis progress.

- [x] **3.3: Timeline & Waveform Visualizer**
  - Render audio waveform with detected beat markers and downbeat ticks.
  - Display scene cuts arranged along the timeline ruler.

- [x] **3.4: Video Preview & Export Controls**
  - Scrubbable video player with frame-accurate preview.
  - One-click trigger for headless FFmpeg export or OTIO project save.

---

## Milestone 4: Production Readiness, Automation & Packaging
Autonomous verification, packaging scripts, CI/CD, and developer documentation.

- [x] **4.1: Autonomous End-to-End Demo Pipeline (`scripts/demo_pipeline.py`)**
  - Generates synthetic 128 BPM electronic WAV audio and multi-scene MP4 clips.
  - Runs full pipeline: audio analysis -> scene detection -> timeline direction -> FFmpeg stitching -> OTIO & FCPXML project export.
  - Validates stream integrity (H.264 video, AAC audio) using FFprobe.

- [x] **4.2: Sidecar Packaging & Distribution (`scripts/bundle_sidecar.sh`)**
  - Generates platform-specific sidecar binaries (`amv-engine-$TARGET`) for Tauri v2 bundle integration.
  - Implements executable wrapper script routing IPC commands directly to the Python engine.

- [x] **4.3: Cross-Platform CI / Automation (`.github/workflows/ci.yml`)**
  - Automated testing across Linux (Ubuntu) and macOS.
  - Python test suite execution with pytest and Node test suite execution with vitest.
  - Production Vite application build verification.

- [x] **4.4: Technical Architecture & User Documentation**
  - Comprehensive 3-phase deterministic architecture specification (`docs/ARCHITECTURE.md`).
  - User and developer guide detailing CLI usage, Desktop UI, codecs, and NLE workflows (`docs/USER_GUIDE.md`).

---

## Phase 5: Manual Segmenting, Contextual Analyzers & Annotations
- [x] **5.1: Manual Highlight / Segment Creation & Multi-Track Timeline**
  - Multi-track video (`V1`, `V2`+) and audio (`A1`, `A2`+) timeline with drag-and-drop across tracks, left/right trimming clamped to source duration, split at playhead, beat snapping, non-collapsing delete, cursor-centered `Shift+Wheel` zoom, and resizable sidebar/timeline panels.
  - On-demand `[start, end]` segment analysis via `analyze-segment` (`/api/analyze-segment`).
- [x] **5.2: Contextual Menus for On-Demand Static Analysis**
  - Right-click / contextual menus in `MediaLibraryTree` on raw videos, cuts, and photos: `Clip Highlights...`, `Analyze Faces (5 frames)`, `Deep Face Scan (15 frames)`, and `Add to Timeline`.
  - Streaming raw-asset discovery and progressive highlight updates (`--stream` NDJSON).
- [x] **5.3: Configurable Sampling Rate & Analyzer Settings**
  - `ClipHighlightsModal` and `HighlightsList` settings for Target Highlight Length (`0.5s Quick`, `1.5s Fast`, `3.5s Balanced`, `5.0s Slow` presets), Max Scene Before Split, Minimum Cut Length, and Scene Cut Threshold, plus `5`/`15`-frame face scan options.
- [x] **5.4: Richer Local Static Analyzers**
  - Visual Highlight Windowing, Farneback optical-flow `fluidity_score`, `contrast_score`, `saturation_score`, `dramatism_score`, `color_mood`, `visual_mood`, MediaPipe 8 facial expressions + `emotion_scores`, and `librosa` HPSS `vocal_energy`/`percussive_energy`/`bass_energy`/`spectral_brightness`/`audio_mood`.
- [x] **5.5: Manual User Annotations & Millisecond Audio Cues**
  - `AnnotationPanel` (`Tags & Cues`) and `WaveformVisualizer` millisecond audio cue pins for adding `user_tags`, `user_note`, and `audio_notes` (`timestamp_ms`) persisted in `localStorage` and forwarded to the AI Director.

---

## Phase 6: Scoped AI Director & Advanced AI Integration
- [ ] **6.1: AI Integration Design & Scoped Directing**
  - Dedicated AI integration architecture (full-timeline vs. localized section re-direction, iterative AI refinement, and annotation-driven pacing).
