# AMV Maker

Automated Anime Music Video generation platform powered by deterministic audio beat analysis, an LLM Director (Gemini 2.0 / 1.5 Flash), and a local FFmpeg / OpenTimelineIO assembler, wrapped in a Tauri v2 + React desktop shell.

## Architecture

```
[Raw Audio & Video Files]
           │
           ▼
┌────────────────────────────────────────────────────────┐
│  Phase 1: Python Media Engine (engine/)                │
│  - Librosa / Soundfile ──► beats.json (BPM, onsets)    │
│  - PySceneDetect       ──► scenes.json (keyframes)     │
└──────────────────────────────────┬─────────────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────┐
│  Phase 2: LLM Director (Gemini Structured Outputs)     │
│  - Ingests beats.json + scenes.json + user prompt      │
│  - Emits timeline.json (clip selections & transitions) │
└──────────────────────────────────┬─────────────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────┐
│  Phase 3: Assembly & Export (engine/stitcher.py)       │
│  - Deterministic FFmpeg Stitcher                       │
│  - OpenTimelineIO (.otio) & FCPXML Exporter            │
└────────────────────────────────────────────────────────┘
```

## Project Layout

- `engine/`: Python CLI sidecar (media analysis, Gemini Director, FFmpeg & OTIO stitcher).
  - `audio_analyzer.py`: Librosa-based tempo, beats, downbeats, and RMS energy detection.
  - `visual_analyzer.py`: PySceneDetect cuts detection and keyframe metrics.
  - `director.py`: Gemini Flash structured JSON timeline generation.
  - `stitcher.py`: Frame-accurate cut concatenation & OpenTimelineIO export.
  - `main.py`: Sidecar CLI interface.
- `app/`: Tauri v2 desktop frontend (Vite + React + TypeScript + Tailwind CSS).
- `specs/schemas.json`: Strict JSON schema contract connecting Python engine and frontend.
- `backlog.md`: Detailed milestones, implementation roadmap, and tasks.
- `.antigravity/instructions.md` & `GEMINI.md`: Agent guidelines and architectural principles.

## Quickstart

### 1. Engine Setup
```bash
cd engine
# Using uv (or python -m venv)
uv venv
source .venv/bin/activate
uv pip install -e .
```

### 2. Desktop App Setup
```bash
cd app
npm install
npm run dev
```
