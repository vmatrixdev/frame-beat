# Agent Guidelines: AMV Maker (Beat-Synced Montage & Music Video Studio)

## Core Principles
1. **Universal Beat-Synchronized Visual Storytelling**: Directs any mix of photos and video clips to music—weddings, family milestones, travel recaps, celebrations, and high-energy AMVs/action reels.
2. **Deterministic Timing**: Audio beats, millisecond cue notes, and visual cuts align using exact timestamps. Never approximate frame timings with arbitrary sleep loops.
3. **Local Processing for Heavy Media**: Raw video, high-res photos, and audio stay local. Only typed metadata (`BeatsData`, `ScenesCatalog`), user annotations (`user_tags`, `user_note`, `audio_notes`), and low-res 480px JPEG keyframes are sent to cloud LLM APIs.
4. **Decoupled Architecture**: The Python engine (`engine/`) communicates with the React/Tauri frontend (`app/`) strictly via typed JSON/NDJSON schemas matching `specs/schemas.json` and `app/src/types/schemas.ts`.

## Technology Stack & Architecture
- **Python Engine (`engine/`)**: `librosa` (BPM, beats, downbeats, HPSS vocal/percussive/bass energy, spectral brightness, audio mood), `scenedetect` + `opencv-python` (parameterized Visual Highlight Windowing, Farneback optical-flow fluidity, contrast, saturation, dramatism, color & visual mood), `mediapipe` (`FaceLandmarker` blendshapes for 8 expressions + `emotion_scores`), `ffmpeg-python` (deterministic `filter_complex` + VideoToolbox/x264, OTIO/FCPXML export), `google-genai` (`gemini-3.5-flash-lite` with `response_schema=Timeline` + multimodal keyframes).
- **Frontend (`app/`)**: Vite, React, TypeScript, Tailwind CSS, Vitest. Features multi-track video/audio timeline, cursor-anchored `Shift+Wheel` zoom, draggable/trimmable clips clamped to source duration, streaming raw-asset discovery, `Clip Highlights...` parameter tuning, millisecond-level `AnnotationPanel` (clip/image/cut tags + audio cue pins), and `localStorage` persistence.
- **IPC Bridges**: Tauri v2 shell sidecar (`binaries/amv-engine`) in native builds, and Vite dev-server middleware (`/api/analyze-soundtrack`, `/api/analyze-scenes`, `/api/analyze-segment`, `/api/direct`, `/api/render`, `/api/export-project`, `/api/media-stream`, `/api/thumb`) in browser dev mode.

## Verification Commands
- Python engine tests: `PYTHONPATH=. engine/.venv/bin/pytest tests/test_audio_analyzer.py tests/test_visual_analyzer.py tests/test_director.py tests/test_models.py tests/test_stitcher.py -v`
- Frontend tests & build: `cd app && npm test -- --run && npm run build`
