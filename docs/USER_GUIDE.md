# AMV Maker: Complete User Guide

Welcome to **AMV Maker**, an autonomous Anime Music Video creation suite. This guide covers using both the desktop user interface and the command-line interface (CLI), hardware acceleration options, and importing exported projects into professional video editing software (DaVinci Resolve, Final Cut Pro, Adobe Premiere Pro).

---

## Table of Contents
1. [Prerequisites & System Setup](#prerequisites--system-setup)
2. [Desktop Application Guide](#desktop-application-guide)
3. [Command-Line Interface (CLI) Guide](#command-line-interface-cli-guide)
4. [Hardware Acceleration & Codecs](#hardware-acceleration--codecs)
5. [Professional NLE Workflows](#professional-nle-workflows)
6. [Autonomous Demo Pipeline](#autonomous-demo-pipeline)
7. [Troubleshooting & FAQ](#troubleshooting--faq)

---

## 1. Prerequisites & System Setup

### Media Tooling
- **FFmpeg & FFprobe**: Required for media analysis and video stitching.
  - **macOS**: `brew install ffmpeg`
  - **Ubuntu/Debian**: `sudo apt-get install ffmpeg libsndfile1`
  - **Windows**: Install via `winget install Gyan.FFmpeg` or download from [ffmpeg.org](https://ffmpeg.org).

### Python Media Engine
```bash
# From project root
cd engine
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
pip install -e .
```

### Desktop UI (Tauri v2 + React)
```bash
cd app
npm install
npm run dev
```

### Optional: Gemini API Key (for Cloud AI Director)
If you want to use Google Gemini Flash for AI-directed AMV cuts:
```bash
export GEMINI_API_KEY="your-gemini-api-key"
```
*Note: If no API key is set, AMV Maker automatically uses its deterministic offline director.*

---

## 2. Desktop Application Guide

### Workflow Overview

```
1. Add Soundtrack ➔ 2. Add Video Clips ➔ 3. Write Director Prompt ➔ 4. Direct Timeline ➔ 5. Render / Export
```

### Step 1: Import Soundtrack
- Drag and drop your audio track (`.mp3`, `.wav`, `.flac`, `.aac`, `.m4a`) into the **Soundtrack DropZone**.
- The engine automatically detects:
  - Musical tempo (BPM)
  - Beat onsets and measure downbeats
  - Dynamic energy sections (intro, verses, chorus drops, outro)
- The interactive timeline ruler immediately populates with beat and downbeat tick marks.

### Step 2: Import Video Footage
- Drag and drop your source video files (`.mp4`, `.mov`, `.mkv`, `.webm`) into the **Source Videos DropZone**.
- The engine performs cinematic scene detection using PySceneDetect and extracts keyframe thumbnails with sharpness and brightness metrics.

### Step 3: Configure Creative Direction
- Select or type a creative directive in the **Director Prompt** panel:
  - *"High energy electronic beat cuts with sharp action drops"*
  - *"Emotional storytelling pacing focusing on character closeups in verses"*
  - *"Cyberpunk neon aesthetic with rapid downbeat cuts during the chorus"*
- Choose your **Pacing Preset**:
  - `Fast (Every Beat)`: Rapid-fire cuts on every single beat.
  - `Balanced (Downbeats)`: Standard 4-beat bar synchronization.
  - `Slow (Long Takes)`: 8-beat or 16-beat cinematic holds.

### Step 4: Review and Edit Interactive Timeline
- Click **Direct AMV** to generate the timeline cut list.
- Inspect the interactive timeline:
  - Visual clip blocks color-coded by source clip.
  - Beat alignment markers showing exact snap points.
  - Keyframe thumbnails embedded directly inside timeline blocks.
  - Zoom and scrub controls for frame-accurate navigation.

### Step 5: Render and Export
- Click **Export AMV** in the header to open the Export Modal.
- Choose your preferred export target:
  - **Direct MP4 Render**: Encodes the final AMV directly to disk using hardware acceleration.
  - **OpenTimelineIO (`.otio`)**: Export for DaVinci Resolve or Adobe Premiere.
  - **Final Cut Pro XML (`.fcpxml`)**: Export for Apple Final Cut Pro X.

---

## 3. Command-Line Interface (CLI) Guide

The engine provides a JSON-first CLI for terminal power users, automation pipelines, and CI/CD.

```bash
# Using the sidecar binary wrapper
./app/src-tauri/binaries/amv-engine [COMMAND] [OPTIONS]

# Or using the Python entrypoint directly
python engine/main.py [COMMAND] [OPTIONS]
```

### 1. Analyze Audio Track
```bash
python engine/main.py analyze-soundtrack my_song.wav --output export/beats.json
```
**Output JSON structure:**
```json
{
  "duration_sec": 184.2,
  "tempo_bpm": 128.0,
  "time_signature": "4/4",
  "downbeats": [0.0, 1.875, 3.75, ...],
  "beats": [0.0, 0.468, 0.937, 1.406, 1.875, ...],
  "energy_segments": [
    { "start": 0.0, "end": 16.0, "level": "intro", "label": "intro" },
    { "start": 16.0, "end": 48.0, "level": "high", "label": "chorus_1" }
  ]
}
```

### 2. Analyze Source Videos
```bash
python engine/main.py analyze-scenes /path/to/raw_videos/ --output export/scenes.json --thumbs cache/thumbnails/
```

### 3. Direct AMV Timeline
```bash
python engine/main.py direct \
  --beats export/beats.json \
  --scenes export/scenes.json \
  --prompt "Fast paced action drops" \
  --title "Neon Overdrive" \
  --output export/timeline.json
```

### 4. Render Video via FFmpeg
```bash
python engine/main.py render export/timeline.json \
  --output export/final_amv.mp4 \
  --resolution 1920x1080 \
  --fps 24.0 \
  --hwaccel
```

### 5. Export NLE Interchange Project
```bash
# Export OpenTimelineIO for DaVinci Resolve
python engine/main.py export-project export/timeline.json \
  --output export/project.otio \
  --format otio

# Export Final Cut Pro XML
python engine/main.py export-project export/timeline.json \
  --output export/project.fcpxml \
  --format fcpxml
```

---

## 4. Hardware Acceleration & Codecs

AMV Maker automatically detects available hardware acceleration on your workstation.

### Supported Video Formats & Codecs
| Category | Formats & Codecs | Support Level |
| :--- | :--- | :--- |
| **Input Video** | H.264 (AVC), H.265 (HEVC), ProRes, VP9, AV1 | Native (Decoded via FFmpeg) |
| **Input Audio** | WAV, FLAC, MP3, AAC, OGG, M4A | Native (Librosa & PySoundFile) |
| **Render Output**| H.264 / AAC in MP4 container | Industry standard compatibility |

### Hardware Acceleration Options

| Flag | Platform | Encoder | Description |
| :--- | :--- | :--- | :--- |
| `--hwaccel` | macOS (Apple Silicon & Intel) | `h264_videotoolbox` | Fast hardware encoding via Apple VideoToolbox (default). |
| `--no-hwaccel` | All platforms | `libx264` | CPU-based software encoding with configurable presets. |
| `--preset <val>` | Software `libx264` | `ultrafast`, `fast`, `medium`, `slow` | Balances encoding speed and file size. |

---

## 5. Professional NLE Workflows

Rather than forcing you to finish your project in a closed tool, AMV Maker exports standard interchange files so you can apply color grading, VFX, sound design, and text graphics in industry-standard NLEs.

### DaVinci Resolve Workflow
1. In AMV Maker, export your project as **OpenTimelineIO (`.otio`)**:
   ```bash
   python engine/main.py export-project export/timeline.json -o export/resolve.otio
   ```
2. Open **DaVinci Resolve** (Studio or Free version).
3. In the menu, go to **File ➔ Import ➔ Timeline...**
4. Select `export/resolve.otio`.
5. Resolve recreates the multitrack timeline with:
   - Synchronized cuts mapped to exact source media timestamps.
   - Master soundtrack placed on Audio Track 1.
   - All source clips linked to their local file paths.
6. Perform your color grade, audio mastering with Fairlight, and render from Resolve's Deliver page.

### Final Cut Pro X Workflow
1. In AMV Maker, export your project as **Final Cut Pro XML (`.fcpxml`)**:
   ```bash
   python engine/main.py export-project export/timeline.json -o export/fcpx.fcpxml
   ```
2. Open **Final Cut Pro**.
3. Select **File ➔ Import ➔ XML...**
4. Choose `export/fcpx.fcpxml`.
5. Final Cut Pro automatically creates a new Event and Project with all cuts placed on the magnetic timeline.

---

## 6. Autonomous Demo Pipeline

You can run the full pipeline autonomously from scratch using our built-in demo script:

```bash
PYTHONPATH=. engine/.venv/bin/python scripts/demo_pipeline.py
```

This single command:
1. Creates synthetic 128 BPM electronic WAV audio and multi-scene test video clips in `demo_assets/`.
2. Analyzes audio beats and downbeats (`export/demo_beats.json`).
3. Detects visual cuts and keyframes (`export/demo_scenes.json`).
4. Directs an AMV timeline (`export/demo_timeline.json`).
5. Renders a final MP4 video (`export/demo_amv.mp4`).
6. Generates `.otio` and `.fcpxml` project interchange files.
7. Validates stream integrity using `ffprobe`.

---

## 7. Troubleshooting & FAQ

### Q: FFmpeg or FFprobe cannot be found?
**A**: Ensure FFmpeg is installed and accessible in your shell path. On macOS, AMV Maker automatically searches `/opt/homebrew/bin`, `/usr/local/bin`, and `/usr/bin`. You can verify by running:
```bash
which ffmpeg && which ffprobe
```

### Q: Can I use AMV Maker completely offline?
**A**: Yes! AMV Maker has a built-in deterministic director algorithm. If no internet connection or `GEMINI_API_KEY` is available, it automatically uses the offline mathematical director.

### Q: What if my video clips have different frame rates or dimensions?
**A**: AMV Maker's FFmpeg filter complex automatically conforms all footage to a uniform resolution (e.g. 1920x1080) and frame rate (e.g. 24 fps), adding centered letterboxing/pillarboxing where necessary without stretching or distorting aspect ratios.
