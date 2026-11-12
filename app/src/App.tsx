import { useState, useEffect, useRef, useCallback } from "react";
import {
  Download,
  Layers,
  Sparkles,
  CheckCircle2,
  Loader2,
  Cpu,
} from "lucide-react";
import type { BeatsData, ScenesCatalog, Timeline } from "./types/schemas";
import { engineClient, isTauriEnvironment } from "./services/engineClient";
import { audioEngine } from "./services/audioEngine";
import { DropZones } from "./components/DropZones";
import { WaveformVisualizer } from "./components/WaveformVisualizer";
import { TimelineTrack } from "./components/TimelineTrack";
import { VideoPreview } from "./components/VideoPreview";
import { ExportModal, type ExportFormat } from "./components/ExportModal";

const PROMPT_PRESETS = [
  "Dynamic action cuts timed with chorus beat drops",
  "Rapid flash transitions on every 2nd beat",
  "Atmospheric slow pans building into high-motion drops",
  "High sharpness katana duels synchronized with 4/4 downbeats",
];

export default function App() {
  const [audioFile, setAudioFile] = useState<string | null>(null);
  const [videoDir, setVideoDir] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<string>(
    "Dynamic action cuts timed with chorus beat drops"
  );
  const [projectTitle, setProjectTitle] = useState<string>("Neon Cybernetic Overdrive");

  // Analysis & Engine state
  const [isAnalyzingAudio, setIsAnalyzingAudio] = useState<boolean>(false);
  const [isAnalyzingScenes, setIsAnalyzingScenes] = useState<boolean>(false);
  const [isDirecting, setIsDirecting] = useState<boolean>(false);
  const [beats, setBeats] = useState<BeatsData | null>(null);
  const [scenes, setScenes] = useState<ScenesCatalog | null>(null);
  const [timeline, setTimeline] = useState<Timeline | null>(null);

  // Playback & Scrubber state
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playbackRate, setPlaybackRate] = useState<number>(1.0);
  const [volume, setVolume] = useState<number>(0.8);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [selectedCutIndex, setSelectedCutIndex] = useState<number | null>(null);

  // Export Modal state
  const [isExportOpen, setIsExportOpen] = useState<boolean>(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("mp4");

  const isNativeTauri = isTauriEnvironment();
  const lastTimeRef = useRef<number | null>(null);
  const animFrameRef = useRef<number | null>(null);

  const duration =
    timeline?.cuts.length
      ? timeline.cuts[timeline.cuts.length - 1].timeline_end
      : beats?.duration_sec || 16.0;

  // Handle Audio Selection & Analysis
  const handleSelectAudio = async (path: string, file?: File) => {
    setAudioFile(path);
    let detectedDuration: number | undefined = undefined;

    if (file) {
      const objectUrl = URL.createObjectURL(file);
      detectedDuration = await audioEngine.loadAudioSource(objectUrl);
    }

    setIsAnalyzingAudio(true);
    try {
      const beatsResult = await engineClient.analyzeSoundtrack(path, detectedDuration, file);
      setBeats(beatsResult);
      if (!file) {
        audioEngine.setSyntheticBeats(beatsResult);
      }
    } catch (err) {
      console.error("Audio analysis failed:", err);
    } finally {
      setIsAnalyzingAudio(false);
    }
  };

  // Handle Video Selection & Scene Detection
  const handleSelectVideoDir = async (dir: string, files?: File[]) => {
    setVideoDir(dir);
    setIsAnalyzingScenes(true);
    try {
      const scenesResult = await engineClient.analyzeScenes(dir, undefined, files);
      setScenes(scenesResult);
    } catch (err) {
      console.error("Scene analysis failed:", err);
    } finally {
      setIsAnalyzingScenes(false);
    }
  };

  // Load Pre-Analyzed PySceneDetect Scenes (personal_scenes.json)
  const handleLoadAnalyzedScenes = async () => {
    try {
      const res = await fetch("/api/get-analyzed-scenes");
      if (res.ok) {
        const data = await res.json();
        const adjustedScenes = {
          ...data,
          scenes: data.scenes.map((s: { keyframe_path?: string }) => ({
            ...s,
            keyframe_path: s.keyframe_path
              ? `/cache/thumbnails/${s.keyframe_path.split("/").pop()}`
              : undefined,
          })),
        };
        setScenes(adjustedScenes);
        setVideoDir("Photos-1-001");
      }
    } catch (err) {
      console.error("Failed to load analyzed scenes:", err);
    }
  };

  // Instant Demo Fixtures Loader
  const handleLoadDemoFixtures = () => {
    const fixtures = engineClient.loadDemoFixtures();
    setAudioFile(fixtures.timeline.target_audio);
    setVideoDir("anime_raws_1080p");
    setBeats(fixtures.beats);
    setScenes(fixtures.scenes);
    setTimeline(fixtures.timeline);
    setProjectTitle(fixtures.timeline.project_title);
    setCurrentTime(0);
    setIsPlaying(false);
    audioEngine.stop();
    audioEngine.setSyntheticBeats(fixtures.beats);
  };

  // Direct AMV Timeline with Gemini LLM / Procedural Director
  const handleGenerateTimeline = async () => {
    if (!beats || !scenes) {
      // Auto-populate demo inputs if empty
      const fixtures = engineClient.loadDemoFixtures();
      setBeats(fixtures.beats);
      setScenes(fixtures.scenes);
      setAudioFile(fixtures.timeline.target_audio);
      setVideoDir("anime_raws_1080p");
      audioEngine.setSyntheticBeats(fixtures.beats);
    }

    const currentBeats = beats || engineClient.loadDemoFixtures().beats;
    const currentScenes = scenes || engineClient.loadDemoFixtures().scenes;

    setIsDirecting(true);
    try {
      const generated = await engineClient.directAmv(
        currentBeats,
        currentScenes,
        prompt,
        projectTitle
      );
      setTimeline(generated);
      setCurrentTime(0);
      setIsPlaying(false);
      audioEngine.stop();
    } catch (err) {
      console.error("Director generation failed:", err);
    } finally {
      setIsDirecting(false);
    }
  };

  // Playback & Audio Controls
  const handleTogglePlayPause = () => {
    setIsPlaying((prev) => {
      const next = !prev;
      if (next) {
        audioEngine.play(currentTime, playbackRate);
      } else {
        audioEngine.pause();
      }
      return next;
    });
  };

  const handleSeek = (time: number) => {
    setCurrentTime(time);
    audioEngine.seek(time);
    if (isPlaying) {
      audioEngine.play(time, playbackRate);
    }
  };

  const handleChangePlaybackRate = (rate: number) => {
    setPlaybackRate(rate);
    if (isPlaying) {
      audioEngine.play(currentTime, rate);
    }
  };

  const handleToggleMute = () => {
    const muted = audioEngine.toggleMute();
    setIsMuted(muted);
  };

  const handleChangeVolume = (v: number) => {
    setVolume(v);
    audioEngine.setVolume(v);
    if (isMuted && v > 0) {
      setIsMuted(false);
    }
  };

  // Playhead scrubber loop
  const updatePlayback = useCallback(
    (timestamp: number) => {
      if (lastTimeRef.current !== null && isPlaying) {
        const deltaSec = ((timestamp - lastTimeRef.current) / 1000) * playbackRate;
        setCurrentTime((prev) => {
          const next = prev + deltaSec;
          if (next >= duration) {
            setIsPlaying(false);
            audioEngine.stop();
            return 0;
          }
          return next;
        });
      }
      lastTimeRef.current = timestamp;
      if (isPlaying) {
        animFrameRef.current = requestAnimationFrame(updatePlayback);
      }
    },
    [isPlaying, playbackRate, duration]
  );

  useEffect(() => {
    if (isPlaying) {
      lastTimeRef.current = performance.now();
      animFrameRef.current = requestAnimationFrame(updatePlayback);
    } else {
      lastTimeRef.current = null;
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
      }
    }
    return () => {
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [isPlaying, updatePlayback]);

  // Spacebar hotkey to toggle Play/Pause
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      if (e.code === "Space") {
        e.preventDefault();
        handleTogglePlayPause();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [currentTime, playbackRate, isPlaying]);

  return (
    <div className="flex flex-col h-screen bg-slate-950 text-slate-100 select-none overflow-hidden">
      {/* Top Application Bar */}
      <header className="h-14 border-b border-slate-800 px-6 flex items-center justify-between bg-slate-900/80 backdrop-blur z-20">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-indigo-600 to-rose-500 flex items-center justify-center font-bold text-white shadow-lg shadow-indigo-500/20">
            AMV
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-bold text-base tracking-tight text-slate-100">AMV Maker</h1>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 font-medium">
                v0.1.0 • Phase 1
              </span>
            </div>
          </div>
        </div>

        {/* Runtime Environment Badge */}
        <div className="flex items-center gap-2 text-xs font-mono px-3 py-1 rounded-full bg-slate-950/70 border border-slate-800">
          <div
            className={`w-2 h-2 rounded-full ${
              isNativeTauri ? "bg-emerald-400 animate-pulse" : "bg-sky-400"
            }`}
          />
          <span className="text-slate-300">
            {isNativeTauri ? "Tauri v2 Desktop Shell" : "Browser Dev Mode (Simulated IPC)"}
          </span>
        </div>

        {/* Export Action Buttons */}
        <div className="flex items-center gap-2.5">
          <button
            disabled={!timeline || timeline.cuts.length === 0}
            onClick={() => {
              setExportFormat("mp4");
              setIsExportOpen(true);
            }}
            className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 active:scale-95 disabled:opacity-40 disabled:hover:bg-emerald-600 text-xs font-semibold transition shadow-md shadow-emerald-600/20"
          >
            <Download className="w-4 h-4" />
            Export MP4 (FFmpeg)
          </button>
          <button
            disabled={!timeline || timeline.cuts.length === 0}
            onClick={() => {
              setExportFormat("otio");
              setIsExportOpen(true);
            }}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 active:scale-95 disabled:opacity-40 text-xs font-medium border border-slate-700 transition"
          >
            <Layers className="w-4 h-4 text-indigo-400" />
            Export OTIO
          </button>
        </div>
      </header>

      {/* Main Studio Workspace */}
      <main className="flex-1 flex overflow-hidden">
        {/* Left Control Sidebar */}
        <aside className="w-96 border-r border-slate-800 p-5 flex flex-col gap-5 overflow-y-auto bg-slate-900/30 shrink-0">
          {/* Section 1: Source Inputs & DropZones */}
          <div>
            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2.5">
              1. Source Inputs
            </h2>
            <DropZones
              audioFile={audioFile}
              videoDir={videoDir}
              isAnalyzingAudio={isAnalyzingAudio}
              isAnalyzingScenes={isAnalyzingScenes}
              audioDuration={beats?.duration_sec}
              audioBpm={beats?.tempo_bpm}
              totalScenes={scenes?.total_scenes}
              onSelectAudio={handleSelectAudio}
              onSelectVideoDir={handleSelectVideoDir}
              onLoadDemoFixtures={handleLoadDemoFixtures}
              onLoadAnalyzedScenes={handleLoadAnalyzedScenes}
            />
          </div>

          {/* Section 2: LLM Director Directive */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                2. Director Directive
              </h2>
              <span className="text-[10px] text-indigo-400 font-mono">Gemini Flash</span>
            </div>

            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              placeholder="Tell the Gemini Director how to pace and cut the AMV..."
              className="w-full text-xs rounded-xl bg-slate-950 border border-slate-800 p-3 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-slate-200 placeholder-slate-500 resize-none"
            />

            {/* Quick Directive Chips */}
            <div className="flex flex-wrap gap-1.5">
              {PROMPT_PRESETS.map((p, idx) => (
                <button
                  key={idx}
                  onClick={() => setPrompt(p)}
                  className="text-[10px] px-2 py-1 rounded-md bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700/50 text-slate-300 transition text-left truncate max-w-full"
                >
                  {p}
                </button>
              ))}
            </div>

            {/* Generate Action Button */}
            <button
              onClick={handleGenerateTimeline}
              disabled={isDirecting}
              className="w-full py-2.5 mt-2 rounded-xl bg-gradient-to-r from-indigo-600 to-rose-600 hover:from-indigo-500 hover:to-rose-500 disabled:opacity-50 text-white font-semibold text-xs flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/25 transition active:scale-[0.99]"
            >
              {isDirecting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Generating Cuts & Transitions...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  Generate AMV Timeline
                </>
              )}
            </button>
          </div>

          {/* Section 3: Engine Connection Status */}
          <div className="mt-auto p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 text-xs text-slate-400 flex flex-col gap-2">
            <div className="flex items-center justify-between font-semibold text-slate-300">
              <span className="flex items-center gap-1.5">
                <Cpu className="w-3.5 h-3.5 text-indigo-400" />
                Python Sidecar Engine
              </span>
              <span className="text-emerald-400 flex items-center gap-1 text-[11px]">
                <CheckCircle2 className="w-3.5 h-3.5" /> Ready
              </span>
            </div>
            <div className="text-[11px] text-slate-400 leading-relaxed">
              Decoupled media analysis running librosa, PySceneDetect, and FFmpeg filter complexes.
            </div>
          </div>
        </aside>

        {/* Center / Right Stage */}
        <section className="flex-1 flex flex-col overflow-hidden bg-slate-950/40">
          {/* Main Video Monitor Stage */}
          <div className="flex-1 p-5 min-h-0 flex items-center justify-center">
            <div className="w-full h-full max-w-5xl">
              <VideoPreview
                timeline={timeline}
                currentTime={currentTime}
                isPlaying={isPlaying}
                playbackRate={playbackRate}
                duration={duration}
                volume={volume}
                isMuted={isMuted}
                onPlayPause={handleTogglePlayPause}
                onSeek={handleSeek}
                onChangePlaybackRate={handleChangePlaybackRate}
                onToggleMute={handleToggleMute}
                onChangeVolume={handleChangeVolume}
              />
            </div>
          </div>

          {/* Bottom Docked Timeline Drawer */}
          <div className="h-64 border-t border-slate-800 bg-slate-900/60 p-4 flex flex-col gap-3 shrink-0">
            {/* Header / Info bar */}
            <div className="flex items-center justify-between text-xs text-slate-400 px-1">
              <div className="flex items-center gap-4">
                <span className="font-semibold text-slate-200">
                  {timeline ? timeline.project_title : "No Active Timeline"}
                </span>
                {beats && (
                  <>
                    <span className="font-mono text-indigo-300">
                      Tempo: {beats.tempo_bpm.toFixed(1)} BPM
                    </span>
                    <span className="font-mono text-slate-400">
                      Time Sig: {beats.time_signature}
                    </span>
                  </>
                )}
              </div>

              {/* Legend */}
              <div className="flex items-center gap-3 text-[11px]">
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-400" /> Downbeats
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-indigo-400" /> Beats
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-rose-500" /> Drop Energy
                </span>
              </div>
            </div>

            {/* Waveform Visualizer */}
            <WaveformVisualizer
              beatsData={beats}
              currentTime={currentTime}
              duration={duration}
              onSeek={handleSeek}
            />

            {/* Cuts Track */}
            <TimelineTrack
              timeline={timeline}
              currentTime={currentTime}
              duration={duration}
              selectedCutIndex={selectedCutIndex}
              onSelectCut={(idx) => setSelectedCutIndex(idx)}
              onSeek={handleSeek}
            />
          </div>
        </section>
      </main>

      {/* Export Dialog Modal */}
      {timeline && (
        <ExportModal
          isOpen={isExportOpen}
          timeline={timeline}
          initialFormat={exportFormat}
          onClose={() => setIsExportOpen(false)}
        />
      )}
    </div>
  );
}
