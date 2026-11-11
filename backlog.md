# AMV Maker: Project Backlog

## Overview
AMV Maker is an automated Anime Music Video creation suite that uses deterministic audio beat detection (Phase 1), an LLM Director via Gemini structured outputs (Phase 2), and a local FFmpeg / OpenTimelineIO assembler (Phase 3), wrapped in a Tauri v2 + React desktop shell.

---

## Milestone 1: Python Media Engine (`engine/`)
Core processing library and CLI sidecar.

- [ ] **1.1: Project Setup & Package Configuration**
  - Initialize Python project with `pyproject.toml` (compatible with `uv` and standard venv).
  - Configure dependencies: `librosa`, `soundfile`, `scenedetect[opencv]`, `pydantic`, `ffmpeg-python`, `google-genai`, `numpy`.
  - Implement typed Pydantic models matching `specs/schemas.json`.

- [ ] **1.2: Audio Analyzer (`engine/audio_analyzer.py`)**
  - Extract waveform, compute tempo (`tempo_bpm`), and detect beat frames with `librosa.beat.beat_track`.
  - Extract downbeats using onset strength and musical bar tracking (4/4 time signature).
  - Calculate RMS dynamic energy across sliding windows (e.g., 2-second windows) to partition into segments: `intro`, `verse`, `build`, `drop`, `chorus`, `outro`.
  - Output standardized `beats.json`.

- [ ] **1.3: Visual Segmenter (`engine/visual_analyzer.py`)**
  - Run PySceneDetect (`ContentDetector` / `AdaptiveDetector`) on source video directory or files.
  - Export representative keyframe thumbnails into a cache folder.
  - Compute frame metrics: sharpness score (Laplacian variance), basic color brightness, and scene duration.
  - Output standardized `scenes.json`.

- [ ] **1.4: LLM Director (`engine/director.py`)**
  - Connect to Gemini 2.0 / 1.5 Flash using the Google GenAI SDK.
  - Formulate structured prompt ingesting `beats.json`, `scenes.json`, and narrative creative directives.
  - Enforce `response_schema` adhering to `Timeline` schema.
  - Match intense high-energy scenes / cuts to musical drops and downbeats; generate `timeline.json`.

---

## Milestone 2: Assembler & Exporter (`engine/stitcher.py`)
Deterministic timeline assembly and NLE interchange.

- [ ] **2.1: FFmpeg Stitcher**
  - Implement deterministic filter complexes (`concat`, `trim`, `setpts`) to assemble cuts frame-accurately.
  - Add audio muxing aligning `target_audio` exactly with video timeline.
  - Support hardware acceleration flags (e.g. VideoToolbox on macOS).

- [ ] **2.2: OpenTimelineIO / FCPXML Exporter**
  - Export timeline cuts to `.otio` and `.fcpxml` formats.
  - Verify import compatibility with DaVinci Resolve and Final Cut Pro.

- [ ] **2.3: CLI Sidecar Interface (`engine/main.py`)**
  - Build CLI commands (`analyze-audio`, `analyze-video`, `direct`, `render`, `export-otio`).
  - Ensure stdout streaming progress and JSON results for IPC sidecar integration with Tauri.

---

## Milestone 3: Tauri Desktop Shell (`app/`)
Desktop application interface for visual editing and scrubbing.

- [ ] **3.1: Tauri v2 + Vite + React Setup**
  - Initialize Tauri v2 shell with React, TypeScript, and Tailwind CSS.
  - Configure sidecar permissions for executing `amv-engine` binaries.

- [ ] **3.2: Media Import & Drop Zones**
  - Drag-and-drop zones for audio tracks and source video folders.
  - Status indicators for background analysis progress.

- [ ] **3.3: Timeline & Waveform Visualizer**
  - Render audio waveform with detected beat markers and downbeat ticks.
  - Display scene cuts arranged along the timeline ruler.

- [ ] **3.4: Video Preview & Export Controls**
  - Scrubbable video player with frame-accurate preview.
  - One-click trigger for headless FFmpeg export or OTIO project save.
