# Antigravity Agent Guidelines: AMV Maker

## Core Principles
1. **Deterministic Timing**: Audio beats, millisecond audio cues, and visual cuts align using exact timestamps. Never approximate frame timings with arbitrary sleep loops.
2. **Local Processing for Heavy Media**: Raw 4K/HEVC videos, photos, and FLAC/WAV audio stay local. Only low-resolution 480px keyframes, static metadata, user tags/notes, and mathematical timestamps are passed to cloud LLM APIs.
3. **Decoupled Architecture**: Keep the media analysis engine (Python CLI/sidecar) strictly decoupled from the UI layer (Tauri/React). Communication happens via typed JSON/NDJSON schemas over stdout, Tauri IPC, or Vite dev-server HTTP endpoints.

## Technology Stack
- **Sidecar/Engine**: Python 3.9+/3.11+, `uv` package manager, `librosa`, `scenedetect`, `opencv-python`, `mediapipe`, `ffmpeg-python`, `pydantic`, `google-genai`.
- **Desktop Shell**: Tauri v2, Rust 1.78+.
- **Frontend**: Vite, React, TypeScript, Tailwind CSS, Lucide icons.
- **LLM Director**: `gemini-3.5-flash-lite` (default, configurable via `GEMINI_MODEL`) via structured JSON output (`response_schema`).

## Pipeline Architecture
1. **Phase 1: Python CLI Engine (`engine/`)**:
   - `audio_analyzer.py`: `librosa` + HPSS -> `beats.json` (BPM, beats, downbeats, RMS energy, vocal/percussive/bass energy, spectral brightness, audio mood, optional `audio_notes`).
   - `visual_analyzer.py` + `face_analyzer.py`: `scenedetect` + Visual Highlight Windowing + OpenCV + MediaPipe `FaceLandmarker` -> `scenes.json` (cuts, 480px keyframes, sharpness, motion, fluidity, contrast, saturation, dramatism, color/visual mood, 8 facial expressions + `emotion_scores`).
2. **Phase 2: LLM Director (`engine/director.py`)**:
   - Ingests `beats.json` (with millisecond `audio_notes`) + `scenes.json` (with `user_tags`/`user_note`) + 480px keyframes + user narrative prompt.
   - Outputs `timeline.json` (beat-synced clip selections, transitions, multi-track cuts).
3. **Phase 3: Assembly & Export (`engine/stitcher.py`)**:
   - Deterministic FFmpeg `filter_complex` stitcher (VideoToolbox / libx264) with streaming NDJSON progress.
   - FCPXML / OpenTimelineIO (OTIO) exporter for DaVinci Resolve & Final Cut Pro.
