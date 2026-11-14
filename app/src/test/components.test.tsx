import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DropZones } from "../components/DropZones";
import { MediaLibraryTree } from "../components/MediaLibraryTree";
import { HighlightsList } from "../components/HighlightsList";
import { WaveformVisualizer } from "../components/WaveformVisualizer";
import { CuesTrack } from "../components/CuesTrack";
import { TimelineTrack } from "../components/TimelineTrack";
import { VideoPreview, formatTimecode } from "../components/VideoPreview";
import {
  AnnotationPanel,
  formatMsTimecode,
  parseMsInput,
  parseTagTokens,
} from "../components/AnnotationPanel";
import { ExportModal } from "../components/ExportModal";
import { DEMO_BEATS, DEMO_TIMELINE } from "../services/mockData";

describe("React UI Components", () => {
  describe("DropZones Component", () => {
    it("renders compact drop zones and import catalog button without demo fixtures", () => {
      const handleSelectAudio = vi.fn();
      const handleSelectVideoDir = vi.fn();

      render(
        <DropZones
          audioFile={null}
          videoDir={null}
          onSelectAudio={handleSelectAudio}
          onSelectVideoDir={handleSelectVideoDir}
        />
      );

      expect(screen.queryByTestId("load-demo-button")).not.toBeInTheDocument();
      expect(screen.getByTestId("audio-drop-zone")).toBeInTheDocument();
      expect(screen.getByTestId("video-drop-zone")).toBeInTheDocument();
      expect(screen.getByText("+ Audio")).toBeInTheDocument();
      expect(screen.getByText("+ Media")).toBeInTheDocument();
    });

    it("displays audio bpm and duration when provided", () => {
      render(
        <DropZones
          audioFile="wedding_song.wav"
          videoDir="family_media"
          audioBpm={120}
          audioDuration={16.0}
          totalScenes={6}
          onSelectAudio={vi.fn()}
          onSelectVideoDir={vi.fn()}
        />
      );

      expect(screen.getByText("120 BPM • 16.0s")).toBeInTheDocument();
      expect(screen.getByText("6 scenes")).toBeInTheDocument();
    });

    it("renders inspect highlights button when totalScenes > 0", () => {
      const handleViewHighlights = vi.fn();
      render(
        <DropZones
          audioFile={null}
          videoDir="family_media"
          totalScenes={5}
          onSelectAudio={vi.fn()}
          onSelectVideoDir={vi.fn()}
          onViewHighlights={handleViewHighlights}
        />
      );

      expect(screen.queryByTestId("import-catalog-button")).not.toBeInTheDocument();
      const btn = screen.getByText("Inspect Highlights (5)");
      fireEvent.click(btn);
      expect(handleViewHighlights).toHaveBeenCalledTimes(1);
    });
  });

  describe("MediaLibraryTree Component", () => {
    it("renders hierarchical audio, raw videos with expandable cuts, and raw photos", () => {
      const handleSelectScene = vi.fn();
      const mockCatalog = {
        source_files: ["/media/clip1.mp4", "/media/photo1.jpg"],
        total_scenes: 3,
        scenes: [
          {
            scene_id: 0,
            source_file: "/media/clip1.mp4",
            start_time: 0.0,
            end_time: 2.5,
            duration: 2.5,
            media_type: "video" as const,
            is_still_image: false,
          },
          {
            scene_id: 1,
            source_file: "/media/clip1.mp4",
            start_time: 2.5,
            end_time: 6.0,
            duration: 3.5,
            media_type: "video" as const,
            is_still_image: false,
          },
          {
            scene_id: 2,
            source_file: "/media/photo1.jpg",
            start_time: 0.0,
            end_time: 0.0,
            duration: 0.0,
            media_type: "image" as const,
            is_still_image: true,
            has_faces: true,
            smile_score: 0.85,
          },
        ],
      };

      render(
        <MediaLibraryTree
          audioFile="/media/song.mp3"
          beats={DEMO_BEATS}
          catalog={mockCatalog}
          activeScene={null}
          onSelectScene={handleSelectScene}
        />
      );

      expect(screen.getByTestId("media-library-tree")).toBeInTheDocument();
      expect(screen.getByText("song.mp3")).toBeInTheDocument();
      expect(screen.getByText("clip1.mp4")).toBeInTheDocument();
      expect(screen.getByText("photo1.jpg")).toBeInTheDocument();

      // Clicking raw video selects full raw video (scene_id: -1)
      fireEvent.click(screen.getByText("clip1.mp4"));
      expect(handleSelectScene).toHaveBeenCalledWith(
        expect.objectContaining({ scene_id: -1, source_file: "/media/clip1.mp4" })
      );

      // Expand cuts and click first cut
      fireEvent.click(screen.getByTitle("Expand analyzed cuts"));
      fireEvent.click(screen.getByText("#1 (0.0s–2.5s)"));
      expect(handleSelectScene).toHaveBeenCalledWith(mockCatalog.scenes[0]);
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

    it("renders static analysis HUD when previewing a specific highlight cut", () => {
      const handleClear = vi.fn();
      const mockScene = {
        scene_id: 3,
        source_file: "/media/wedding_dance.mp4",
        start_time: 12.5,
        end_time: 16.5,
        duration: 4.0,
        media_type: "video" as const,
        is_still_image: false,
        sharpness_score: 245.8,
        brightness_score: 130.5,
        motion_score: 42.1,
        has_faces: true,
        face_count: 2,
        dominant_expression: "joyful / smiling",
        smile_score: 0.86,
        subject_prominence: "close_up" as const,
      };

      render(
        <VideoPreview
          timeline={null}
          currentTime={0}
          isPlaying={false}
          playbackRate={1.0}
          previewScene={mockScene}
          onClearPreviewScene={handleClear}
          onPlayPause={vi.fn()}
          onSeek={vi.fn()}
          onChangePlaybackRate={vi.fn()}
        />
      );

      // Verify Static Analysis HUD presence
      expect(screen.getByText("HIGHLIGHT #4")).toBeInTheDocument();
      expect(screen.getByText("PySceneDetect & OpenCV Static Analysis HUD")).toBeInTheDocument();
      expect(screen.getByText("wedding_dance.mp4")).toBeInTheDocument();
      expect(screen.getByText("245.8")).toBeInTheDocument();
      expect(screen.getByText("130.5 / 255")).toBeInTheDocument();
      expect(screen.getByText("42.1")).toBeInTheDocument();
      expect(screen.getByText("Subject & Emotion")).toBeInTheDocument();
      expect(screen.getByText("joyful / smiling (86%)")).toBeInTheDocument();
      expect(screen.getByText("2 Faces • close up")).toBeInTheDocument();

      // Return to timeline
      const returnBtn = screen.getByText("Return to Timeline");
      fireEvent.click(returnBtn);
      expect(handleClear).toHaveBeenCalledTimes(1);
    });
  });

  describe("HighlightsList Component", () => {
    it("renders catalog scenes with metrics and triggers selection", () => {
      const handleSelect = vi.fn();
      const mockCatalog = {
        source_files: ["/media/clip1.mp4", "/media/photo1.jpg"],
        total_scenes: 2,
        scenes: [
          {
            scene_id: 0,
            source_file: "/media/clip1.mp4",
            start_time: 0.0,
            end_time: 4.0,
            duration: 4.0,
            media_type: "video" as const,
            is_still_image: false,
            sharpness_score: 180.0,
            brightness_score: 110.0,
          },
          {
            scene_id: 1,
            source_file: "/media/photo1.jpg",
            start_time: 0.0,
            end_time: 0.0,
            duration: 0.0,
            media_type: "image" as const,
            is_still_image: true,
            sharpness_score: 95.0,
            brightness_score: 140.0,
            has_faces: true,
            face_count: 1,
            dominant_expression: "joyful / smiling",
            smile_score: 0.78,
            subject_prominence: "medium_shot" as const,
          },
        ],
      };

      render(
        <HighlightsList
          catalog={mockCatalog}
          activeScene={null}
          onSelectScene={handleSelect}
        />
      );

      expect(screen.getByText("2/2")).toBeInTheDocument();
      expect(screen.getByText("#1 • clip1.mp4")).toBeInTheDocument();
      expect(screen.getByText("#2 • photo1.jpg")).toBeInTheDocument();
      expect(screen.getByText("Faces (1)")).toBeInTheDocument();
      expect(screen.getByText("joyful 78%")).toBeInTheDocument();

      // Filter by Faces
      fireEvent.click(screen.getByText("Faces (1)"));
      expect(screen.queryByText("#1 • clip1.mp4")).not.toBeInTheDocument();
      expect(screen.getByText("#2 • photo1.jpg")).toBeInTheDocument();

      // Click photo item to select
      fireEvent.click(screen.getByText("#2 • photo1.jpg"));
      expect(handleSelect).toHaveBeenCalledWith(mockCatalog.scenes[1]);
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

  describe("AnnotationPanel, Audio Cue Pins & Rich Metrics", () => {
    it("formats and parses millisecond timestamps and tag tokens", () => {
      expect(formatMsTimecode(12345)).toBe("00:12.345");
      expect(parseMsInput("4520")).toBe(4520);
      expect(parseMsInput("01:05.432")).toBe(65432);
      expect(parseMsInput("invalid")).toBeNull();
      expect(parseTagTokens("hero, climax, hero", ["intro"])).toEqual([
        "intro",
        "hero",
        "climax",
      ]);
    });

    it("adds tags and notes to a selected SceneCut", () => {
      const handleUpdateScene = vi.fn();
      const mockScene = {
        scene_id: 0,
        source_file: "/media/clip1.mp4",
        start_time: 0,
        end_time: 4,
        duration: 4,
        user_tags: ["hero"],
        user_note: "Initial note",
      };

      render(
        <AnnotationPanel
          selectedScene={mockScene}
          onUpdateSceneAnnotation={handleUpdateScene}
        />
      );

      // Quick tag click adds "climax"
      fireEvent.click(screen.getByText("+ climax"));
      expect(handleUpdateScene).toHaveBeenCalledWith(mockScene, {
        user_tags: ["hero", "climax"],
        user_note: "Initial note",
      });

      // Remove existing tag "hero"
      fireEvent.click(screen.getByLabelText("Remove tag hero"));
      expect(handleUpdateScene).toHaveBeenCalledWith(mockScene, {
        user_tags: [],
        user_note: "Initial note",
      });

      // Update director note
      const noteInput = screen.getByPlaceholderText(/Note for AI Director/i);
      fireEvent.change(noteInput, { target: { value: "Hold on chorus" } });
      expect(handleUpdateScene).toHaveBeenCalledWith(mockScene, {
        user_tags: ["hero"],
        user_note: "Hold on chorus",
      });
    });

    it("adds, edits, shortlists, and deletes cues in CuesTrack", () => {
      const handleAddCue = vi.fn();
      const handleUpdateCue = vi.fn();
      const handleDeleteCue = vi.fn();
      const handleShortlist = vi.fn();
      const beatsWithNotes = {
        ...DEMO_BEATS,
        audio_notes: [
          {
            id: "cue-1",
            timestamp_ms: 4250,
            end_ms: 8250,
            tags: ["drop"],
            note: "Bass drop",
          },
        ],
      };

      render(
        <CuesTrack
          beatsData={beatsWithNotes}
          audioNotes={beatsWithNotes.audio_notes}
          duration={20}
          currentTime={8.125}
          onSeek={vi.fn()}
          onAddCue={handleAddCue}
          onUpdateCue={handleUpdateCue}
          onDeleteCue={handleDeleteCue}
          onShortlistSegment={handleShortlist}
        />
      );

      // Add a 4s segment at current playhead (8125ms..12125ms)
      fireEvent.click(screen.getByText("+ Segment at Playhead"));
      expect(handleAddCue).toHaveBeenCalledWith(
        expect.objectContaining({
          timestamp_ms: 8125,
          end_ms: 12125,
        })
      );

      // Click existing segment pill to open inline editor
      fireEvent.click(screen.getByText("Bass drop"));
      fireEvent.click(screen.getByText("AI Shortlist Clips"));
      expect(handleShortlist).toHaveBeenCalledWith(
        4250,
        8250,
        expect.objectContaining({ id: "cue-1" })
      );

      fireEvent.click(screen.getByTitle("Delete cue"));
      expect(handleDeleteCue).toHaveBeenCalledWith("cue-1");
    });

    it("renders audio cue pins on WaveformVisualizer and seeks to exact ms on click", () => {
      const handleSeek = vi.fn();
      const beatsWithNotes = {
        ...DEMO_BEATS,
        audio_notes: [
          {
            id: "cue-pin-1",
            timestamp_ms: 5125,
            tags: ["drop", "climax"],
            note: "Hard cut",
          },
        ],
      };

      render(
        <WaveformVisualizer
          beatsData={beatsWithNotes}
          currentTime={0}
          duration={16.0}
          onSeek={handleSeek}
        />
      );

      const pin = screen.getByTestId("waveform-cue-pin-cue-pin-1");
      expect(pin).toHaveAttribute("title", "[5125ms] drop, climax: Hard cut");
      fireEvent.click(pin);
      expect(handleSeek).toHaveBeenCalledWith(5.125);
    });

    it("displays richer static analysis metrics and user_tags in HighlightsList and VideoPreview", () => {
      const richScene = {
        scene_id: 2,
        source_file: "/media/hero_shot.mp4",
        start_time: 1.0,
        end_time: 4.5,
        duration: 3.5,
        media_type: "video" as const,
        is_still_image: false,
        sharpness_score: 210,
        brightness_score: 125,
        visual_mood: "energetic",
        color_mood: "warm_golden",
        fluidity_score: 0.88,
        dramatism_score: 0.74,
        user_tags: ["hero", "climax"],
        user_note: "Best shot",
      };

      const { unmount } = render(
        <HighlightsList
          catalog={{
            source_files: ["/media/hero_shot.mp4"],
            total_scenes: 1,
            scenes: [richScene],
          }}
          activeScene={null}
          onSelectScene={vi.fn()}
        />
      );

      expect(screen.getAllByText("energetic").length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText("Fluid 88%")).toBeInTheDocument();
      expect(screen.getByText("Drama 74%")).toBeInTheDocument();
      expect(screen.getByText("#hero")).toBeInTheDocument();
      expect(screen.getByText("#climax")).toBeInTheDocument();
      unmount();

      render(
        <VideoPreview
          timeline={null}
          currentTime={0}
          isPlaying={false}
          playbackRate={1.0}
          previewScene={richScene}
          onPlayPause={vi.fn()}
          onSeek={vi.fn()}
          onChangePlaybackRate={vi.fn()}
        />
      );

      expect(screen.getByText("Mood: energetic")).toBeInTheDocument();
      expect(screen.getByText("Color: warm_golden")).toBeInTheDocument();
      expect(screen.getByText("Fluidity 88%")).toBeInTheDocument();
      expect(screen.getByText("Dramatism 74%")).toBeInTheDocument();
      expect(screen.getByText("#hero")).toBeInTheDocument();
      expect(screen.getByText("Note: Best shot")).toBeInTheDocument();
    });
  });
});
