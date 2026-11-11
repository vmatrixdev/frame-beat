# Antigravity Agent Guidelines: AMV Maker

## Core Principles
1. **Deterministic Timing**: Audio beats and visual cuts must align using millisecond-accurate mathematical markers. Never approximate frame timings with arbitrary sleep loops.
2. **Local Processing for Heavy Media**: Raw 4K/HEVC videos and FLAC/WAV audio stay local. Only low-resolution keyframes, metadata, and timestamps are passed to cloud LLM APIs.
3. **Decoupled Architecture**: Keep the media analysis engine (Python CLI/sidecar) strictly decoupled from the UI layer (Tauri/React). Communication happens via typed JSON schemas over stdout or IPC.

## Technology Stack
- **Sidecar/Engine**: Python 3.11+, `uv` package manager, `librosa`, `scenedetect`, `ffmpeg-python`, `pydantic`, `google-genai`.
- **Desktop Shell**: Tauri v2, Rust 1.78+.
- **Frontend**: Vite, React, TypeScript, Tailwind CSS, Lucide icons.
- **LLM Director**: Gemini 2.0 / 1.5 Flash via structured JSON output (`response_schema`).

## Pipeline Architecture
1. **Phase 1: Python CLI Engine (`engine/`)**:
   - `librosa` / `soundfile` -> `beats.json` (BPM, onsets, drops, energy segments).
   - `scenedetect` -> `scenes.json` (scene cuts, keyframe thumbnails, motion/sharpness scores).
2. **Phase 2: LLM Director (`engine/director.py`)**:
   - Ingests `beats.json` + `scenes.json` + user narrative prompt.
   - Outputs `timeline.json` (clip selections, cut transitions, beat pacing).
3. **Phase 3: Assembly & Export (`engine/stitcher.py`)**:
   - Deterministic FFmpeg stitcher / Remotion preview.
   - FCPXML / OpenTimelineIO (OTIO) exporter for DaVinci Resolve & Final Cut Pro.
