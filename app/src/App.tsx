import React, { useState } from "react";
import { 
  Music, 
  Film, 
  Sparkles, 
  Play, 
  Download, 
  Sliders, 
  Layers, 
  CheckCircle2, 
  AlertCircle 
} from "lucide-react";
import type { BeatsData, ScenesCatalog, Timeline } from "./types/schemas";

export default function App() {
  const [audioFile, setAudioFile] = useState<string | null>(null);
  const [videoDir, setVideoDir] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<string>("Dynamic action cuts timed with chorus beat drops");
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [beats, setBeats] = useState<BeatsData | null>(null);
  const [scenes, setScenes] = useState<ScenesCatalog | null>(null);
  const [timeline, setTimeline] = useState<Timeline | null>(null);

  return (
    <div className="flex flex-col h-screen bg-slate-950 text-slate-100">
      {/* Top Navigation Bar */}
      <header className="h-14 border-b border-slate-800 px-6 flex items-center justify-between bg-slate-900/60 backdrop-blur">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center font-bold text-white shadow-lg shadow-indigo-500/30">
            AMV
          </div>
          <h1 className="font-semibold text-lg tracking-tight">AMV Maker</h1>
          <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
            v0.1.0 • Phase 1
          </span>
        </div>

        <div className="flex items-center gap-3">
          <button 
            disabled={!timeline}
            className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:hover:bg-emerald-600 text-sm font-medium transition shadow"
          >
            <Download className="w-4 h-4" /> Export Video (FFmpeg)
          </button>
          <button 
            disabled={!timeline}
            className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-sm font-medium border border-slate-700 transition"
          >
            <Layers className="w-4 h-4" /> Export OTIO
          </button>
        </div>
      </header>

      {/* Main Workspace Body */}
      <main className="flex-1 flex overflow-hidden">
        {/* Left Control Panel */}
        <section className="w-96 border-r border-slate-800 p-6 flex flex-col gap-6 overflow-y-auto bg-slate-900/20">
          <div>
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
              1. Source Inputs
            </h2>
            <div className="space-y-3">
              {/* Music Drop Zone */}
              <div 
                className="p-4 rounded-xl border border-dashed border-slate-700 hover:border-indigo-500 bg-slate-900/50 cursor-pointer transition group"
                onClick={() => setAudioFile("/path/to/sample_track.mp3")}
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-indigo-500/10 flex items-center justify-center text-indigo-400 group-hover:scale-105 transition">
                    <Music className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">
                      {audioFile ? audioFile.split("/").pop() : "Select Audio Track"}
                    </div>
                    <div className="text-xs text-slate-400">MP3, WAV, or FLAC</div>
                  </div>
                </div>
              </div>

              {/* Video Folder Drop Zone */}
              <div 
                className="p-4 rounded-xl border border-dashed border-slate-700 hover:border-indigo-500 bg-slate-900/50 cursor-pointer transition group"
                onClick={() => setVideoDir("/path/to/anime_raws")}
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-indigo-500/10 flex items-center justify-center text-indigo-400 group-hover:scale-105 transition">
                    <Film className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">
                      {videoDir ? videoDir.split("/").pop() : "Select Raw Videos Directory"}
                    </div>
                    <div className="text-xs text-slate-400">Folder with MP4, MKV, MOV</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Director Creative Prompt */}
          <div>
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
              2. Director Directive
            </h2>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              placeholder="Tell the Gemini Director how to pace and cut the AMV..."
              className="w-full text-sm rounded-lg bg-slate-900 border border-slate-800 p-3 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-slate-200 placeholder-slate-500 resize-none"
            />
          </div>

          {/* Action Trigger */}
          <button
            onClick={() => setIsAnalyzing(!isAnalyzing)}
            className="w-full py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-sm flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/20 transition active:scale-[0.99]"
          >
            <Sparkles className="w-4 h-4" />
            Generate AMV Timeline
          </button>

          {/* Engine Status info */}
          <div className="mt-auto p-3.5 rounded-lg bg-slate-900/80 border border-slate-800/80 text-xs text-slate-400 flex flex-col gap-1.5">
            <div className="flex items-center justify-between font-medium text-slate-300">
              <span>Engine Status</span>
              <span className="text-emerald-400 flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" /> Ready
              </span>
            </div>
            <div>Decoupled Python sidecar connected via JSON IPC.</div>
          </div>
        </section>

        {/* Center / Right Preview & Timeline Area */}
        <section className="flex-1 flex flex-col">
          {/* Main Video Scrubbing Stage */}
          <div className="flex-1 flex items-center justify-center p-8 bg-slate-950/60">
            <div className="w-full max-w-3xl aspect-video rounded-2xl border border-slate-800 bg-slate-900/80 flex flex-col items-center justify-center shadow-2xl relative overflow-hidden group">
              <Play className="w-12 h-12 text-slate-600 group-hover:text-indigo-400 transition" />
              <span className="mt-3 text-sm text-slate-400 font-medium">Video Preview Stage</span>
              <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between text-xs text-slate-500 bg-slate-950/80 backdrop-blur px-3 py-1.5 rounded-lg border border-slate-800">
                <span>00:00:00 / 00:03:02</span>
                <span>1080p 24fps • Deterministic Cuts</span>
              </div>
            </div>
          </div>

          {/* Timeline and Waveform Drawer */}
          <div className="h-56 border-t border-slate-800 bg-slate-900/40 p-4 flex flex-col gap-2">
            <div className="flex items-center justify-between text-xs text-slate-400 px-2">
              <div className="flex items-center gap-4">
                <span className="font-semibold text-slate-300">Timeline Ruler</span>
                <span>Tempo: 128.0 BPM</span>
                <span>Time Signature: 4/4</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-indigo-500"></span> Beats
                <span className="w-2 h-2 rounded-full bg-emerald-500 ml-2"></span> Downbeats
              </div>
            </div>

            {/* Timeline Waveform representation */}
            <div className="flex-1 rounded-xl border border-slate-800 bg-slate-950 p-3 flex flex-col justify-center relative overflow-hidden">
              <div className="h-12 w-full flex items-center gap-1 opacity-70">
                {Array.from({ length: 64 }).map((_, i) => (
                  <div
                    key={i}
                    className={`flex-1 rounded-full ${
                      i % 4 === 0 ? "bg-emerald-500 h-10" : "bg-indigo-500/60 h-6"
                    }`}
                  />
                ))}
              </div>
              <div className="mt-2 text-xs text-slate-500 text-center">
                Audio waveform with detected beat frames and downbeat markers
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
