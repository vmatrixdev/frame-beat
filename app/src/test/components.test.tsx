import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DropZones } from "../components/DropZones";
import { WaveformVisualizer } from "../components/WaveformVisualizer";
import { TimelineTrack } from "../components/TimelineTrack";
import { VideoPreview, formatTimecode } from "../components/VideoPreview";
import { ExportModal } from "../components/ExportModal";
import { DEMO_BEATS, DEMO_TIMELINE } from "../services/mockData";

describe("React UI Components", () => {
  describe("DropZones Component", () => {
    it("renders drop zones and triggers load demo fixtures callback", () => {
      const handleLoadDemo = vi.fn();
      const handleSelectAudio = vi.fn();
      const handleSelectVideoDir = vi.fn();

      render(
        <DropZones
          audioFile={null}
          videoDir={null}
          onSelectAudio={handleSelectAudio}
          onSelectVideoDir={handleSelectVideoDir}
          onLoadDemoFixtures={handleLoadDemo}
        />
      );

      const demoBtn = screen.getByTestId("load-demo-button");
      expect(demoBtn).toBeInTheDocument();
      fireEvent.click(demoBtn);
      expect(handleLoadDemo).toHaveBeenCalledTimes(1);

      const audioZone = screen.getByTestId("audio-drop-zone");
      fireEvent.click(audioZone);
      expect(handleSelectAudio).toHaveBeenCalled();
    });

    it("displays audio bpm and duration when provided", () => {
      render(
        <DropZones
          audioFile="synthwave_120bpm.wav"
          videoDir="anime_raws"
          audioBpm={120}
          audioDuration={16.0}
          totalScenes={6}
          onSelectAudio={vi.fn()}
          onSelectVideoDir={vi.fn()}
          onLoadDemoFixtures={vi.fn()}
        />
      );

      expect(screen.getByText("120 BPM")).toBeInTheDocument();
      expect(screen.getByText("16.0s")).toBeInTheDocument();
      expect(screen.getByText("6 scenes")).toBeInTheDocument();
    });
  });

  describe("WaveformVisualizer Component", () => {
    it("renders energy segment labels and playhead", () => {
      const handleSeek = vi.fn();

      render(
        <WaveformVisualizer
          beatsData={DEMO_BEATS}
          currentTime={4.0}
          duration={16.0}
          onSeek={handleSeek}
        />
      );

      const visualizer = screen.getByTestId("waveform-visualizer");
      expect(visualizer).toBeInTheDocument();

      // Energy segment labels
      expect(screen.getByText("Intro - Atmospheric Build")).toBeInTheDocument();
      expect(screen.getByText("Chorus Drop - Maximum Energy")).toBeInTheDocument();

      const playhead = screen.getByTestId("waveform-playhead");
      expect(playhead).toBeInTheDocument();
      expect(screen.getByText("4.00s")).toBeInTheDocument();
    });

    it("calls onSeek when clicked", () => {
      const handleSeek = vi.fn();
      render(
        <WaveformVisualizer
          beatsData={DEMO_BEATS}
          currentTime={0.0}
          duration={16.0}
          onSeek={handleSeek}
        />
      );

      const visualizer = screen.getByTestId("waveform-visualizer");
      fireEvent.pointerDown(visualizer, { clientX: 100 });
      expect(handleSeek).toHaveBeenCalled();
    });
  });

  describe("TimelineTrack Component", () => {
    it("renders all cuts with transition badges and duration", () => {
      const handleSeek = vi.fn();
      const handleSelectCut = vi.fn();

      render(
        <TimelineTrack
          timeline={DEMO_TIMELINE}
          currentTime={2.5}
          duration={16.0}
          onSeek={handleSeek}
          onSelectCut={handleSelectCut}
        />
      );

      expect(screen.getByTestId("timeline-track")).toBeInTheDocument();
      expect(screen.getByTestId("timeline-cut-0")).toBeInTheDocument();
      expect(screen.getByTestId("timeline-cut-1")).toBeInTheDocument();

      // Click cut 1
      fireEvent.click(screen.getByTestId("timeline-cut-1"));
      expect(handleSelectCut).toHaveBeenCalledWith(1);
      expect(handleSeek).toHaveBeenCalledWith(2.0);
    });
  });

  describe("VideoPreview Component", () => {
    it("formats timecode with millisecond precision", () => {
      expect(formatTimecode(0)).toBe("00:00.000");
      expect(formatTimecode(65.432)).toBe("01:05.432");
    });

    it("triggers play/pause and transport controls", () => {
      const handlePlayPause = vi.fn();
      const handleSeek = vi.fn();
      const handleChangeRate = vi.fn();

      render(
        <VideoPreview
          timeline={DEMO_TIMELINE}
          currentTime={5.0}
          isPlaying={false}
          playbackRate={1.0}
          duration={16.0}
          onPlayPause={handlePlayPause}
          onSeek={handleSeek}
          onChangePlaybackRate={handleChangeRate}
        />
      );

      const playBtn = screen.getByLabelText("Play");
      fireEvent.click(playBtn);
      expect(handlePlayPause).toHaveBeenCalledTimes(1);

      // Change rate to 1.5x
      const rateBtn = screen.getByText("1.5x");
      fireEvent.click(rateBtn);
      expect(handleChangeRate).toHaveBeenCalledWith(1.5);
    });
  });

  describe("ExportModal Component", () => {
    it("renders export format tabs and handles format change", () => {
      const handleClose = vi.fn();

      render(
        <ExportModal
          isOpen={true}
          timeline={DEMO_TIMELINE}
          initialFormat="mp4"
          onClose={handleClose}
        />
      );

      expect(screen.getByTestId("export-modal")).toBeInTheDocument();
      expect(screen.getByText("Export AMV Project")).toBeInTheDocument();

      // Switch to OTIO
      const otioBtn = screen.getByText("OpenTimelineIO");
      fireEvent.click(otioBtn);
      expect(screen.getByDisplayValue("export/amv_project.otio")).toBeInTheDocument();
    });
  });
});
