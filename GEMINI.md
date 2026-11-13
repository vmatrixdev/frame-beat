# Antigravity Agent Guidelines: AMV Maker (Beat-Synced Montage & Music Video Studio)

## Core Principles
1. **Universal Beat-Synchronized Visual Storytelling**: The engine directs any combination of photos and video clips to music—including life milestones (weddings, children growing up, anniversaries), celebrations (birthdays, graduations), travel recaps, and high-energy music videos (AMVs, sports/action).
2. **Deterministic Timing**: Audio beats and visual cuts must align using millisecond-accurate mathematical markers. Never approximate frame timings with arbitrary sleep loops.
3. **Local Processing for Heavy Media**: Raw 4K/HEVC videos, high-res photos, and FLAC/WAV audio stay local. Only lightweight metadata, timestamps, manual annotations, and low-res 480px keyframes are passed to cloud LLM APIs.
4. **Decoupled Architecture**: Keep the media analysis engine (Python CLI/sidecar) strictly decoupled from the UI layer (Tauri/React). Communication happens via typed JSON schemas over stdout, Tauri IPC, or Vite dev-server HTTP/NDJSON endpoints.

## Technology Stack
- **Sidecar/Engine**: Python 3.9+/3.11+, `uv` package manager, `librosa` (beats + HPSS vocal/percussive/bass/spectral mood), `scenedetect` + `opencv-python` (Visual Highlight Windowing, Farneback optical-flow fluidity, contrast/saturation/dramatism/color mood), `mediapipe` (`FaceLandmarker` 52 blendshapes, 8 facial expressions + emotion scores), `ffmpeg-python`, `pydantic`, `google-genai`.
- **Desktop Shell**: Tauri v2, Rust 1.78+.
- **Frontend**: Vite, React, TypeScript, Tailwind CSS, Lucide icons, Vitest + Testing Library.
- **LLM Director**: `gemini-3.5-flash-lite` (default, configurable via `GEMINI_MODEL`) via structured JSON output (`response_schema=Timeline`) with multimodal keyframe thumbnails and millisecond-level user tags/notes.

See detailed specifications in `AGENTS.md`, `.antigravity/instructions.md`, `docs/ARCHITECTURE.md`, `specs/schemas.json`, and `backlog.md`.
