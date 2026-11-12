import React, { useRef, useState } from "react";
import { Music, Film, Sparkles, CheckCircle2, Loader2, FolderOpen, RefreshCw } from "lucide-react";

export interface DropZonesProps {
  audioFile: string | null;
  videoDir: string | null;
  isAnalyzingAudio?: boolean;
  isAnalyzingScenes?: boolean;
  audioDuration?: number;
  audioBpm?: number;
  totalScenes?: number;
  onSelectAudio: (path: string, file?: File) => void;
  onSelectVideoDir: (path: string, files?: File[]) => void;
  onLoadDemoFixtures: () => void;
}

export const DropZones: React.FC<DropZonesProps> = ({
  audioFile,
  videoDir,
  isAnalyzingAudio = false,
  isAnalyzingScenes = false,
  audioDuration,
  audioBpm,
  totalScenes,
  onSelectAudio,
  onSelectVideoDir,
  onLoadDemoFixtures,
}) => {
  const audioInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const [isDraggingAudio, setIsDraggingAudio] = useState(false);
  const [isDraggingVideo, setIsDraggingVideo] = useState(false);

  const handleAudioDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingAudio(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      onSelectAudio(file.name, file);
    }
  };

  const handleVideoDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingVideo(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const files = Array.from(e.dataTransfer.files);
      const dirName = files[0].webkitRelativePath
        ? files[0].webkitRelativePath.split("/")[0]
        : files.length > 1
        ? `${files.length} media items`
        : files[0].name;
      onSelectVideoDir(dirName, files);
    }
  };

  return (
    <div className="space-y-4">
      {/* Demo Fixtures Fast-Track Button */}
      <div className="p-3 rounded-xl bg-gradient-to-r from-indigo-950/60 to-purple-950/60 border border-indigo-500/30 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-indigo-500/20 text-indigo-400 flex items-center justify-center">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <div className="text-xs font-semibold text-indigo-200">Interactive Demo Pack</div>
            <div className="text-[11px] text-slate-400">120 BPM Synthwave + 6 Action Scenes</div>
          </div>
        </div>
        <button
          onClick={onLoadDemoFixtures}
          className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-xs font-medium text-white shadow-md shadow-indigo-600/30 transition flex items-center gap-1.5"
          data-testid="load-demo-button"
        >
          <Sparkles className="w-3.5 h-3.5" />
          Load Fixtures
        </button>
      </div>

      <div className="space-y-3">
        {/* Audio Track Drop Zone */}
        <div
          data-testid="audio-drop-zone"
          onDragOver={(e) => {
            e.preventDefault();
            setIsDraggingAudio(true);
          }}
          onDragLeave={() => setIsDraggingAudio(false)}
          onDrop={handleAudioDrop}
          onClick={() => {
            audioInputRef.current?.click();
            if (!audioFile) {
              onSelectAudio("audio/synthwave_120bpm.wav");
            }
          }}
          className={`p-3.5 rounded-xl border transition cursor-pointer relative overflow-hidden group ${
            isDraggingAudio
              ? "border-indigo-400 bg-indigo-950/60 ring-2 ring-indigo-500 scale-[1.01]"
              : audioFile
              ? "border-indigo-500/50 bg-indigo-950/20"
              : "border-dashed border-slate-700 hover:border-indigo-500 bg-slate-900/40"
          }`}
        >
          <div className="flex items-center gap-3">
            <div
              className={`w-10 h-10 rounded-lg flex items-center justify-center transition ${
                isAnalyzingAudio
                  ? "bg-indigo-500/20 text-indigo-400 animate-pulse"
                  : audioFile
                  ? "bg-indigo-600/30 text-indigo-300"
                  : "bg-slate-800 text-slate-400 group-hover:text-indigo-400"
              }`}
            >
              {isAnalyzingAudio ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Music className="w-5 h-5" />
              )}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium truncate text-slate-200">
                  {audioFile ? audioFile.split("/").pop() : "Select Audio Soundtrack"}
                </span>
                {audioFile && !isAnalyzingAudio && (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                )}
              </div>
              <div className="text-xs text-slate-400 mt-0.5 flex items-center gap-2">
                {isAnalyzingAudio ? (
                  <span className="text-indigo-400 font-mono">Computing tempo & beats...</span>
                ) : audioFile ? (
                  <>
                    <span>{audioDuration ? `${audioDuration.toFixed(1)}s` : "WAV / MP3"}</span>
                    {audioBpm && (
                      <span className="text-indigo-300 font-mono bg-indigo-950/60 px-1.5 py-0.2 rounded border border-indigo-800/50">
                        {audioBpm.toFixed(0)} BPM
                      </span>
                    )}
                  </>
                ) : (
                  <span>WAV, MP3, FLAC • Beats detection</span>
                )}
              </div>
            </div>

            {audioFile && (
              <button
                title="Change Audio"
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectAudio("audio/cyberpunk_drive.wav");
                }}
                className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <input
            type="file"
            ref={audioInputRef}
            accept="audio/*,.mp3,.wav,.flac,.m4a,.aac,.ogg,.opus"
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.[0]) onSelectAudio(e.target.files[0].name, e.target.files[0]);
            }}
          />
        </div>

        {/* Video Directory Drop Zone */}
        <div
          data-testid="video-drop-zone"
          onDragOver={(e) => {
            e.preventDefault();
            setIsDraggingVideo(true);
          }}
          onDragLeave={() => setIsDraggingVideo(false)}
          onDrop={handleVideoDrop}
          onClick={() => {
            videoInputRef.current?.click();
            if (!videoDir) {
              onSelectVideoDir("anime_raws_1080p");
            }
          }}
          className={`p-3.5 rounded-xl border transition cursor-pointer relative overflow-hidden group ${
            isDraggingVideo
              ? "border-purple-400 bg-purple-950/60 ring-2 ring-purple-500 scale-[1.01]"
              : videoDir
              ? "border-purple-500/50 bg-purple-950/20"
              : "border-dashed border-slate-700 hover:border-purple-500 bg-slate-900/40"
          }`}
        >
          <div className="flex items-center gap-3">
            <div
              className={`w-10 h-10 rounded-lg flex items-center justify-center transition ${
                isAnalyzingScenes
                  ? "bg-purple-500/20 text-purple-400 animate-pulse"
                  : videoDir
                  ? "bg-purple-600/30 text-purple-300"
                  : "bg-slate-800 text-slate-400 group-hover:text-purple-400"
              }`}
            >
              {isAnalyzingScenes ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Film className="w-5 h-5" />
              )}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium truncate text-slate-200">
                  {videoDir ? videoDir.split("/").pop() : "Select Source Videos or Images"}
                </span>
                {videoDir && !isAnalyzingScenes && (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                )}
              </div>
              <div className="text-xs text-slate-400 mt-0.5 flex items-center gap-2">
                {isAnalyzingScenes ? (
                  <span className="text-purple-400 font-mono">Running Scene Detect & Metrics...</span>
                ) : videoDir ? (
                  <>
                    <span>Media source</span>
                    {totalScenes !== undefined && (
                      <span className="text-purple-300 font-mono bg-purple-950/60 px-1.5 py-0.2 rounded border border-purple-800/50">
                        {totalScenes} scenes
                      </span>
                    )}
                  </>
                ) : (
                  <span>MP4, MKV, MOV, JPG, PNG</span>
                )}
              </div>
            </div>

            {videoDir && (
              <button
                title="Change Directory"
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectVideoDir("anime_action_clips");
                }}
                className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition"
              >
                <FolderOpen className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <input
            type="file"
            ref={videoInputRef}
            multiple
            accept="video/*,image/*,.mp4,.mkv,.mov,.avi,.webm,.jpg,.jpeg,.png,.webp"
            className="hidden"
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                const files = Array.from(e.target.files);
                const count = files.length;
                const label = count === 1 ? files[0].name : `${count} media items`;
                onSelectVideoDir(label, files);
              }
            }}
          />
        </div>
      </div>
    </div>
  );
};
