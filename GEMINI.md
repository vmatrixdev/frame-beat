# Antigravity Agent Guidelines: AMV Maker (Beat-Synced Montage & Music Video Studio)

## Core Principles
1. **Universal Beat-Synchronized Visual Storytelling**: The engine directs any combination of photos and video clips to music—including life milestones (weddings, children growing up, anniversaries), celebrations (birthdays, graduations), travel recaps, and high-energy music videos (AMVs, sports/action).
2. **Deterministic Timing**: Audio beats and visual cuts must align using millisecond-accurate mathematical markers. Never approximate frame timings with arbitrary sleep loops.
3. **Local Processing for Heavy Media**: Raw 4K/HEVC videos, high-res photos, and FLAC/WAV audio stay local. Only lightweight metadata, timestamps, and low-res keyframes are passed to cloud LLM APIs.
4. **Decoupled Architecture**: Keep the media analysis engine (Python CLI/sidecar) strictly decoupled from the UI layer (Tauri/React). Communication happens via typed JSON schemas over stdout or IPC.

## Technology Stack
- **Sidecar/Engine**: Python 3.11+, `uv` package manager, `librosa`, `scenedetect`, `ffmpeg-python`, `pydantic`, `google-genai`.
- **Desktop Shell**: Tauri v2, Rust 1.78+.
- **Frontend**: Vite, React, TypeScript, Tailwind CSS, Lucide icons.
- **LLM Director**: Gemini 2.0 / 1.5 Flash via structured JSON output (`response_schema`).

See detailed specifications in `.antigravity/instructions.md`, `specs/schemas.json`, and `backlog.md`.
