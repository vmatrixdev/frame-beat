import React, { useRef, useState } from "react";
import {
  Music,
  Film,
  Loader2,
  FileJson,
  Upload,
} from "lucide-react";

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
  onImportScenesCatalog?: (file: File) => void;
  onViewHighlights?: () => void;
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
  onImportScenesCatalog,
  onViewHighlights,
}) => {
  const audioInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const catalogInputRef = useRef<HTMLInputElement>(null);

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

      if (files.length === 1 && files[0].name.toLowerCase().endsWith(".json")) {
        if (onImportScenesCatalog) {
          onImportScenesCatalog(files[0]);
          return;
        }
      }

      const dirName = files[0].webkitRelativePath
        ? files[0].webkitRelativePath.split("/")[0]
        : files.length > 1
        ? `${files.length} media items`
        : files[0].name;
      onSelectVideoDir(dirName, files);
    }
  };

  const handleCatalogFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      if (onImportScenesCatalog) {
        onImportScenesCatalog(file);
      }
      e.target.value = "";
    }
  };

  return (
    <div className="space-y-2">
      {/* Compact Drop & Import Grid */}
      <div className="grid grid-cols-2 gap-2">
        {/* Audio Drop / Pick */}
        <div
          data-testid="audio-drop-zone"
          onDragOver={(e) => {
            e.preventDefault();
            setIsDraggingAudio(true);
          }}
          onDragLeave={() => setIsDraggingAudio(false)}
          onDrop={handleAudioDrop}
          onClick={() => audioInputRef.current?.click()}
          className={`px-2.5 py-2 rounded-lg border transition cursor-pointer flex items-center gap-2 ${
            isDraggingAudio
              ? "border-indigo-400 bg-indigo-950/60"
              : audioFile
              ? "border-indigo-500/40 bg-indigo-950/20"
              : "border-dashed border-slate-700 hover:border-indigo-500 bg-slate-900/50"
          }`}
          title="Drop or pick soundtrack audio (WAV, MP3, FLAC)"
        >
          {isAnalyzingAudio ? (
            <Loader2 className="w-4 h-4 text-indigo-400 animate-spin shrink-0" />
          ) : (
            <Music className="w-4 h-4 text-indigo-400 shrink-0" />
          )}
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-medium text-slate-200 truncate">
              {isAnalyzingAudio ? "Analyzing..." : audioFile ? audioFile.split("/").pop() : "+ Audio"}
            </div>
            <div className="text-[10px] font-mono text-slate-400 truncate">
              {audioBpm ? `${audioBpm.toFixed(0)} BPM` : "Drop/Pick"}
              {audioDuration ? ` • ${audioDuration.toFixed(1)}s` : ""}
            </div>
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

        {/* Video / Photo Drop / Pick */}
        <div
          data-testid="video-drop-zone"
          onDragOver={(e) => {
            e.preventDefault();
            setIsDraggingVideo(true);
          }}
          onDragLeave={() => setIsDraggingVideo(false)}
          onDrop={handleVideoDrop}
          onClick={() => videoInputRef.current?.click()}
          className={`px-2.5 py-2 rounded-lg border transition cursor-pointer flex items-center gap-2 ${
            isDraggingVideo
              ? "border-purple-400 bg-purple-950/60"
              : videoDir
              ? "border-purple-500/40 bg-purple-950/20"
              : "border-dashed border-slate-700 hover:border-purple-500 bg-slate-900/50"
          }`}
          title="Drop or pick videos & photos for static analysis"
        >
          {isAnalyzingScenes ? (
            <Loader2 className="w-4 h-4 text-purple-400 animate-spin shrink-0" />
          ) : (
            <Upload className="w-4 h-4 text-purple-400 shrink-0" />
          )}
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-medium text-slate-200 truncate">
              {isAnalyzingScenes ? "Analyzing..." : "+ Media"}
            </div>
            <div className="text-[10px] font-mono text-slate-400 truncate">
              {totalScenes !== undefined ? `${totalScenes} scenes` : "Videos / Photos"}
            </div>
          </div>
          <input
            type="file"
            ref={videoInputRef}
            multiple
            accept="video/*,image/*,.json,.mp4,.mkv,.mov,.avi,.webm,.jpg,.jpeg,.png,.webp"
            className="hidden"
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                const files = Array.from(e.target.files);
                if (files.length === 1 && files[0].name.toLowerCase().endsWith(".json")) {
                  if (onImportScenesCatalog) {
                    onImportScenesCatalog(files[0]);
                    return;
                  }
                }
                const count = files.length;
                const label = count === 1 ? files[0].name : `${count} media items`;
                onSelectVideoDir(label, files);
              }
            }}
          />
        </div>
      </div>

      {/* Compact Secondary Action Row: Import Catalog JSON & Inspect Highlights */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => catalogInputRef.current?.click()}
          className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1 rounded-md bg-slate-900 hover:bg-slate-800 text-[11px] font-medium text-purple-300 border border-slate-800 transition"
          title="Import pre-analyzed PySceneDetect scenes catalog JSON"
          data-testid="import-catalog-button"
        >
          <FileJson className="w-3.5 h-3.5 text-purple-400" />
          Import Catalog (.json)
        </button>

        {totalScenes !== undefined && totalScenes > 0 && onViewHighlights && (
          <button
            type="button"
            onClick={onViewHighlights}
            className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-purple-950/50 hover:bg-purple-900/50 border border-purple-500/30 text-[11px] font-medium text-purple-300 transition"
          >
            <Film className="w-3.5 h-3.5 text-purple-400" />
            Highlights ({totalScenes})
          </button>
        )}

        <input
          type="file"
          ref={catalogInputRef}
          accept=".json,application/json"
          className="hidden"
          onChange={handleCatalogFileChange}
        />
      </div>
    </div>
  );
};
