import React, { useState, useRef, useEffect } from "react";
import {
  X,
  CheckCircle2,
  AlertCircle,
  MessageSquare,
  Download,
  Maximize2,
  Minimize2,
  Sparkles,
  MapPin,
  Clock,
  Send,
  Eye,
  Check,
  Tag,
  Square,
  Play,
  Pause,
  RotateCcw,
  SkipBack,
  SkipForward,
  Film,
  Scissors
} from "lucide-react";
import { ChatMessage, DesignReviewComment, BoundingBox } from "../types";
import { playSendChirp } from "../utils/audioChime";

interface DesignReviewModalProps {
  message: ChatMessage;
  currentUserId: string;
  currentUserName: string;
  currentUserRole?: string;
  currentUserAvatar?: string;
  onClose: () => void;
  onUpdateMessage: (updatedMessage: ChatMessage) => void;
}

// Format seconds into MM:SS
function formatTime(totalSeconds: number): string {
  if (isNaN(totalSeconds) || totalSeconds < 0) return "00:00";
  const m = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default function DesignReviewModal({
  message,
  currentUserId,
  currentUserName,
  currentUserRole = "artist",
  currentUserAvatar,
  onClose,
  onUpdateMessage
}: DesignReviewModalProps) {
  // Check if media is video
  const isVideo =
    message.isVideoReview ||
    Boolean(message.fileType?.startsWith("video/")) ||
    Boolean(message.fileName?.match(/\.(mp4|webm|mov|ogg|m4v)$/i)) ||
    Boolean(message.fileUrl?.startsWith("data:video/"));

  const [commentText, setCommentText] = useState("");
  const [selectedStatus, setSelectedStatus] = useState<"Draft" | "Under Review" | "Needs Revision" | "Approved">(
    message.designStatus || "Under Review"
  );

  // Annotation tool mode: "box" (Google Drive area select), "pin" (point pin), or "none"
  const [annotationMode, setAnnotationMode] = useState<"box" | "pin" | "none">("box");

  // Selection states for Google Drive-style box dragging
  const [isDraggingBox, setIsDraggingBox] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [currentBox, setCurrentBox] = useState<BoundingBox | null>(null);
  const [activePin, setActivePin] = useState<{ x: number; y: number } | null>(null);

  // Video playback & timestamp review states
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [attachedTimestamp, setAttachedTimestamp] = useState<number | null>(null);

  const [selectedCommentId, setSelectedCommentId] = useState<string | null>(null);
  const [hoveredCommentId, setHoveredCommentId] = useState<string | null>(null);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [submittingComment, setSubmittingComment] = useState(false);

  const canvasRef = useRef<HTMLDivElement>(null);
  const comments: DesignReviewComment[] = message.designComments || [];

  // Sync video time updates
  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration || 0);
    }
  };

  const togglePlayPause = () => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
      setIsPlaying(false);
    } else {
      videoRef.current.play().catch(() => {});
      setIsPlaying(true);
    }
  };

  const seekToTimestamp = (seconds: number) => {
    if (!videoRef.current) return;
    videoRef.current.currentTime = seconds;
    videoRef.current.pause();
    setIsPlaying(false);
    setCurrentTime(seconds);
  };

  const stepVideo = (deltaSeconds: number) => {
    if (!videoRef.current) return;
    const newT = Math.max(0, Math.min(duration, videoRef.current.currentTime + deltaSeconds));
    videoRef.current.currentTime = newT;
    setCurrentTime(newT);
  };

  // Capture current timestamp to attach to comment
  const handleStampCurrentTime = () => {
    const t = videoRef.current ? videoRef.current.currentTime : 0;
    setAttachedTimestamp(t);
    if (videoRef.current) {
      videoRef.current.pause();
      setIsPlaying(false);
    }
  };

  // Google Drive Style Mouse Dragging for Area/Box Selection
  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (annotationMode === "none" || !canvasRef.current) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(100, Math.round(((e.clientX - rect.left) / rect.width) * 100)));
    const y = Math.max(0, Math.min(100, Math.round(((e.clientY - rect.top) / rect.height) * 100)));

    if (annotationMode === "pin") {
      setActivePin({ x, y });
      setCurrentBox(null);
      if (isVideo && videoRef.current) {
        setAttachedTimestamp(videoRef.current.currentTime);
      }
      return;
    }

    if (annotationMode === "box") {
      setIsDraggingBox(true);
      setDragStart({ x, y });
      setCurrentBox({ x, y, width: 0, height: 0 });
      setActivePin(null);
      if (isVideo && videoRef.current) {
        setAttachedTimestamp(videoRef.current.currentTime);
      }
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDraggingBox || !dragStart || !canvasRef.current) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const currentX = Math.max(0, Math.min(100, Math.round(((e.clientX - rect.left) / rect.width) * 100)));
    const currentY = Math.max(0, Math.min(100, Math.round(((e.clientY - rect.top) / rect.height) * 100)));

    const x = Math.min(dragStart.x, currentX);
    const y = Math.min(dragStart.y, currentY);
    const width = Math.abs(currentX - dragStart.x);
    const height = Math.abs(currentY - dragStart.y);

    setCurrentBox({ x, y, width, height });
  };

  const handleMouseUp = () => {
    if (isDraggingBox) {
      setIsDraggingBox(false);
      setDragStart(null);
      // If box is tiny (just a click), convert to pinpoint
      if (currentBox && (currentBox.width < 3 || currentBox.height < 3)) {
        setActivePin({ x: currentBox.x, y: currentBox.y });
        setCurrentBox(null);
      }
    }
  };

  // Submit a comment (with box, pin, and/or video timestamp)
  const handleAddComment = (statusOverride?: "feedback" | "change_requested" | "approved") => {
    if (!commentText.trim() && !statusOverride && !currentBox && !activePin) return;
    setSubmittingComment(true);

    const pinNumber = comments.length + 1;
    const finalTimestamp = isVideo ? (attachedTimestamp !== null ? attachedTimestamp : currentTime) : undefined;
    const finalTimestampFormatted = finalTimestamp !== undefined ? formatTime(finalTimestamp) : undefined;

    const newComment: DesignReviewComment = {
      id: "comment-" + Date.now() + "-" + Math.random().toString(36).substring(2, 6),
      authorId: currentUserId,
      authorName: currentUserName,
      authorAvatar: currentUserAvatar,
      authorRole: currentUserRole,
      text: commentText.trim() || (statusOverride === "approved" ? "Approved this design!" : "Annotated error feedback."),
      createdAt: Date.now(),
      pinX: activePin?.x,
      pinY: activePin?.y,
      pinNumber,
      box: currentBox ? { ...currentBox } : undefined,
      videoTimestamp: finalTimestamp,
      videoTimestampFormatted: finalTimestampFormatted,
      status: statusOverride || (currentBox || activePin ? "change_requested" : "feedback"),
      resolved: false
    };

    const updatedComments = [...comments, newComment];
    const updatedMessage: ChatMessage = {
      ...message,
      designComments: updatedComments,
      designStatus: statusOverride === "approved" ? "Approved" : selectedStatus
    };

    onUpdateMessage(updatedMessage);
    playSendChirp();

    // Reset composer
    setCommentText("");
    setCurrentBox(null);
    setActivePin(null);
    setAttachedTimestamp(null);
    setSubmittingComment(false);
    setSelectedCommentId(newComment.id);
  };

  // Toggle resolve status on comment
  const handleToggleResolve = (commentId: string) => {
    const updatedComments = comments.map((c) => {
      if (c.id === commentId) {
        return { ...c, resolved: !c.resolved };
      }
      return c;
    });

    const updatedMessage: ChatMessage = {
      ...message,
      designComments: updatedComments
    };

    onUpdateMessage(updatedMessage);
    playSendChirp();
  };

  // Update design overall status
  const handleStatusChange = (newStatus: "Draft" | "Under Review" | "Needs Revision" | "Approved") => {
    setSelectedStatus(newStatus);
    const updatedMessage: ChatMessage = {
      ...message,
      designStatus: newStatus
    };
    onUpdateMessage(updatedMessage);
    playSendChirp();
  };

  const statusColors = {
    Draft: "bg-slate-500/10 text-slate-400 border-slate-500/20",
    "Under Review": "bg-amber-500/10 text-amber-400 border-amber-500/30",
    "Needs Revision": "bg-rose-500/10 text-rose-400 border-rose-500/30",
    Approved: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-950/85 backdrop-blur-md animate-in fade-in duration-200">
      <div
        className={`bg-slate-900 border border-white/10 rounded-3xl shadow-2xl overflow-hidden flex flex-col transition-all duration-300 w-full ${
          isFullScreen ? "h-[98vh] max-w-[98vw]" : "h-[92vh] max-w-6xl"
        }`}
      >
        {/* Header Bar */}
        <header className="px-5 py-3 border-b border-white/10 bg-slate-950/70 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 border ${
              isVideo 
                ? "bg-purple-500/10 border-purple-500/20 text-purple-400" 
                : "bg-indigo-500/10 border-indigo-500/20 text-indigo-400"
            }`}>
              {isVideo ? <Film className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-base sm:text-lg font-black text-white truncate tracking-tight">
                  {message.designTitle || message.fileName || (isVideo ? "Video Review" : "Design Review")}
                </h3>
                <span
                  className={`px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase tracking-wider border ${
                    statusColors[selectedStatus]
                  }`}
                >
                  {selectedStatus}
                </span>
                {isVideo && (
                  <span className="px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30 text-[10px] font-mono font-bold uppercase flex items-center gap-1">
                    <Film className="w-2.5 h-2.5" /> Video Scrubber Active
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 truncate">
                Created by <span className="text-slate-200 font-semibold">{message.senderName}</span> •{" "}
                {comments.length} {comments.length === 1 ? "critique note" : "critique notes"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Status Selector Dropdown */}
            <div className="hidden sm:flex items-center gap-1 bg-slate-800/80 p-1 rounded-xl border border-white/5">
              {(["Draft", "Under Review", "Needs Revision", "Approved"] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => handleStatusChange(st)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold font-mono transition-all cursor-pointer ${
                    selectedStatus === st
                      ? "bg-indigo-600 text-white shadow-xs"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  {st}
                </button>
              ))}
            </div>

            {/* Download Button */}
            {message.fileUrl && (
              <a
                href={message.fileUrl}
                download={message.fileName || (isVideo ? "video-clip.mp4" : "design-artwork.png")}
                className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-white/10 transition-colors cursor-pointer"
                title="Download Media File"
              >
                <Download className="w-4 h-4" />
              </a>
            )}

            {/* Fullscreen Toggle */}
            <button
              type="button"
              onClick={() => setIsFullScreen(!isFullScreen)}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-white/10 transition-colors cursor-pointer"
              title={isFullScreen ? "Exit Fullscreen" : "Fullscreen"}
            >
              {isFullScreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>

            {/* Close Button */}
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl bg-slate-800 hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 border border-white/10 transition-colors cursor-pointer"
              title="Close Reviewer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Content Body: Canvas Preview + Feedback Sidebar */}
        <div className="flex-1 flex flex-col md:flex-row min-h-0 overflow-hidden">
          {/* Main Visual Canvas & Video Player */}
          <div className="flex-1 bg-slate-950/90 p-4 flex flex-col items-center justify-between relative overflow-hidden select-none">
            {/* Top Toolbar: Google Drive Area Box Selector / Pinpoint Toggler */}
            <div className="w-full flex items-center justify-between gap-2 z-20 pb-2">
              <div className="flex items-center gap-2 bg-slate-900/90 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/10 shadow-lg">
                <button
                  type="button"
                  onClick={() => setAnnotationMode(annotationMode === "box" ? "none" : "box")}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold transition-all cursor-pointer ${
                    annotationMode === "box"
                      ? "bg-amber-500 text-slate-950 font-black shadow-md animate-pulse"
                      : "bg-slate-800 text-slate-300 hover:text-white"
                  }`}
                  title="Click and drag over an area to comment (Google Drive style)"
                >
                  <Square className="w-3.5 h-3.5" />
                  <span>Select Area (Drag Box)</span>
                </button>

                <button
                  type="button"
                  onClick={() => setAnnotationMode(annotationMode === "pin" ? "none" : "pin")}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold transition-all cursor-pointer ${
                    annotationMode === "pin"
                      ? "bg-indigo-600 text-white font-black shadow-md"
                      : "bg-slate-800 text-slate-300 hover:text-white"
                  }`}
                  title="Click a point to pin feedback"
                >
                  <MapPin className="w-3.5 h-3.5" />
                  <span>Pinpoint</span>
                </button>

                {annotationMode === "box" && (
                  <span className="text-[11px] text-amber-300 hidden sm:inline pl-1">
                    Click & drag a box on the artwork to highlight an error!
                  </span>
                )}
              </div>

              {/* Video Timestamp Action */}
              {isVideo && (
                <button
                  type="button"
                  onClick={handleStampCurrentTime}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-purple-600 hover:bg-purple-500 text-white font-mono text-xs font-bold shadow-md transition-colors cursor-pointer"
                >
                  <Scissors className="w-3.5 h-3.5" />
                  <span>Comment at [{formatTime(currentTime)}]</span>
                </button>
              )}
            </div>

            {/* Media Canvas Viewport */}
            <div className="flex-1 w-full flex items-center justify-center min-h-0 relative">
              <div
                ref={canvasRef}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                className={`relative max-w-full max-h-full rounded-2xl overflow-hidden border border-white/10 shadow-2xl flex items-center justify-center group ${
                  annotationMode === "box"
                    ? "cursor-crosshair ring-2 ring-amber-500/40"
                    : annotationMode === "pin"
                    ? "cursor-crosshair ring-2 ring-indigo-500/40"
                    : "cursor-default"
                }`}
              >
                {/* Media Renderer: Video or Image */}
                {isVideo ? (
                  <video
                    ref={videoRef}
                    src={message.fileUrl}
                    onTimeUpdate={handleTimeUpdate}
                    onLoadedMetadata={handleLoadedMetadata}
                    onEnded={() => setIsPlaying(false)}
                    className="max-h-[60vh] max-w-full w-auto object-contain block pointer-events-none"
                    playsInline
                  />
                ) : (
                  <img
                    src={message.fileUrl}
                    alt={message.designTitle || "Design Artwork"}
                    className="max-h-[65vh] max-w-full w-auto object-contain block pointer-events-none"
                  />
                )}

                {/* Render Existing Bounding Box Selections (Google Drive Style) */}
                {comments
                  .filter((c) => c.box)
                  .map((c) => {
                    const box = c.box!;
                    const isSelected = selectedCommentId === c.id || hoveredCommentId === c.id;
                    return (
                      <div
                        key={c.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedCommentId(c.id);
                          if (c.videoTimestamp !== undefined) {
                            seekToTimestamp(c.videoTimestamp);
                          }
                        }}
                        style={{
                          left: `${box.x}%`,
                          top: `${box.y}%`,
                          width: `${box.width}%`,
                          height: `${box.height}%`
                        }}
                        className={`absolute border-2 rounded-lg transition-all cursor-pointer z-15 ${
                          c.resolved
                            ? "border-emerald-500 bg-emerald-500/10 opacity-70"
                            : isSelected
                            ? "border-amber-400 bg-amber-500/25 ring-4 ring-amber-400/50 shadow-2xl scale-[1.01]"
                            : "border-amber-500/80 bg-amber-500/15 hover:border-amber-300 hover:bg-amber-500/25"
                        }`}
                        title={`${c.authorName}: ${c.text}`}
                      >
                        <span className="absolute -top-3 left-1 px-1.5 py-0.2 rounded-md bg-amber-500 text-slate-950 font-black text-[9px] font-mono shadow-md">
                          #{c.pinNumber || "•"}
                        </span>
                      </div>
                    );
                  })}

                {/* Render Existing Point Pins */}
                {comments
                  .filter((c) => c.pinX !== undefined && c.pinY !== undefined && !c.box)
                  .map((c) => {
                    const isSelected = selectedCommentId === c.id || hoveredCommentId === c.id;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedCommentId(c.id);
                          if (c.videoTimestamp !== undefined) {
                            seekToTimestamp(c.videoTimestamp);
                          }
                        }}
                        style={{ left: `${c.pinX}%`, top: `${c.pinY}%` }}
                        className={`absolute -translate-x-1/2 -translate-y-1/2 w-7 h-7 rounded-full flex items-center justify-center text-xs font-black shadow-lg transition-transform cursor-pointer z-20 ${
                          c.resolved
                            ? "bg-emerald-500 text-white border-2 border-slate-950"
                            : isSelected
                            ? "bg-indigo-500 text-white scale-125 ring-4 ring-indigo-400/50 z-30"
                            : "bg-amber-500 text-slate-950 hover:scale-110"
                        }`}
                        title={`${c.authorName}: ${c.text}`}
                      >
                        {c.resolved ? <Check className="w-3.5 h-3.5" /> : c.pinNumber || "•"}
                      </button>
                    );
                  })}

                {/* Active Dragging Bounding Box */}
                {currentBox && (
                  <div
                    style={{
                      left: `${currentBox.x}%`,
                      top: `${currentBox.y}%`,
                      width: `${currentBox.width}%`,
                      height: `${currentBox.height}%`
                    }}
                    className="absolute border-2 border-dashed border-amber-400 bg-amber-400/20 rounded-lg pointer-events-none z-30 animate-pulse"
                  >
                    <span className="absolute -top-3 left-1 px-1.5 py-0.2 rounded bg-amber-400 text-slate-950 font-black text-[9px] font-mono shadow-md">
                      Selected Area
                    </span>
                  </div>
                )}

                {/* Active Pending Point Pin */}
                {activePin && (
                  <div
                    style={{ left: `${activePin.x}%`, top: `${activePin.y}%` }}
                    className="absolute -translate-x-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-amber-400 text-slate-950 font-black flex items-center justify-center text-xs border-2 border-white shadow-xl animate-bounce z-40"
                  >
                    📍
                  </div>
                )}
              </div>
            </div>

            {/* Video Player Scrubber & Timeline Bar */}
            {isVideo && (
              <div className="w-full max-w-2xl bg-slate-900/90 border border-white/10 rounded-2xl p-3 mt-2 space-y-2 z-20">
                <div className="flex items-center justify-between text-xs font-mono text-slate-300">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={togglePlayPause}
                      className="p-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white cursor-pointer shadow-md"
                      title={isPlaying ? "Pause" : "Play"}
                    >
                      {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => stepVideo(-1)}
                      className="p-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer"
                      title="-1 second clip step"
                    >
                      <SkipBack className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => stepVideo(1)}
                      className="p-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer"
                      title="+1 second clip step"
                    >
                      <SkipForward className="w-3.5 h-3.5" />
                    </button>
                    <span className="font-bold text-white pl-1">{formatTime(currentTime)}</span>
                    <span className="text-slate-500">/</span>
                    <span className="text-slate-400">{formatTime(duration)}</span>
                  </div>

                  <span className="text-[11px] text-purple-300 font-bold">
                    {comments.filter((c) => c.videoTimestamp !== undefined).length} Video Markers
                  </span>
                </div>

                {/* Progress Bar with Comment Markers */}
                <div className="relative w-full h-3 bg-slate-800 rounded-full cursor-pointer flex items-center">
                  <input
                    type="range"
                    min={0}
                    max={duration || 100}
                    step={0.1}
                    value={currentTime}
                    onChange={(e) => seekToTimestamp(parseFloat(e.target.value))}
                    className="w-full h-2 bg-transparent appearance-none cursor-pointer accent-purple-500 z-10"
                  />

                  {/* Render Feedback Timeline Markers */}
                  {duration > 0 &&
                    comments
                      .filter((c) => c.videoTimestamp !== undefined)
                      .map((c) => {
                        const pct = Math.min(100, (c.videoTimestamp! / duration) * 100);
                        return (
                          <div
                            key={c.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              seekToTimestamp(c.videoTimestamp!);
                              setSelectedCommentId(c.id);
                            }}
                            style={{ left: `${pct}%` }}
                            className="absolute -top-1 w-2.5 h-4 -translate-x-1/2 rounded-full bg-amber-400 border border-slate-950 shadow-md cursor-pointer hover:scale-125 z-20"
                            title={`${c.videoTimestampFormatted || formatTime(c.videoTimestamp!)} - ${c.authorName}: ${c.text}`}
                          />
                        );
                      })}
                </div>
              </div>
            )}
          </div>

          {/* Feedback & Critique Sidebar */}
          <div className="w-full md:w-96 border-t md:border-t-0 md:border-l border-white/10 bg-slate-900/95 flex flex-col shrink-0">
            {/* Sidebar Header */}
            <div className="px-5 py-3 border-b border-white/10 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-indigo-400" />
                <h4 className="text-sm font-bold text-white tracking-tight">Review Feedback & Errors</h4>
              </div>
              <span className="text-xs font-mono text-slate-400">
                {comments.filter((c) => c.resolved).length}/{comments.length} resolved
              </span>
            </div>

            {/* Comment Thread List */}
            <div className="flex-1 p-4 overflow-y-auto space-y-3 min-h-0">
              {comments.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-500">
                  <div className="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center text-slate-400 mb-3">
                    <Sparkles className="w-6 h-6" />
                  </div>
                  <p className="text-sm font-bold text-slate-300">No review notes yet</p>
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                    Use <strong className="text-amber-400">Select Area (Drag Box)</strong> to draw a box around any error or typo (like in Google Drive), or drop a pin to leave critique notes.
                  </p>
                </div>
              ) : (
                comments.map((c) => {
                  const isSelected = selectedCommentId === c.id;
                  return (
                    <div
                      key={c.id}
                      onClick={() => {
                        setSelectedCommentId(c.id);
                        if (c.videoTimestamp !== undefined) {
                          seekToTimestamp(c.videoTimestamp);
                        }
                      }}
                      onMouseEnter={() => setHoveredCommentId(c.id)}
                      onMouseLeave={() => setHoveredCommentId(null)}
                      className={`p-3 rounded-2xl border transition-all cursor-pointer ${
                        c.resolved
                          ? "bg-emerald-950/20 border-emerald-500/20 opacity-75"
                          : isSelected
                          ? "bg-indigo-950/50 border-indigo-500/60 shadow-lg ring-1 ring-indigo-500/40"
                          : "bg-slate-800/60 border-white/5 hover:border-white/15"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <div className="flex items-center gap-2 min-w-0 flex-wrap">
                          {c.authorAvatar ? (
                            <img
                              src={c.authorAvatar}
                              alt={c.authorName}
                              className="w-6 h-6 rounded-full object-cover shrink-0"
                            />
                          ) : (
                            <div className="w-6 h-6 rounded-full bg-indigo-600 text-white font-bold text-[10px] flex items-center justify-center shrink-0">
                              {c.authorName.charAt(0)}
                            </div>
                          )}
                          <span className="text-xs font-bold text-white truncate">{c.authorName}</span>

                          {/* Video Timestamp Tag */}
                          {c.videoTimestampFormatted && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                seekToTimestamp(c.videoTimestamp!);
                              }}
                              className="px-1.5 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30 text-[10px] font-mono font-bold flex items-center gap-1 hover:bg-purple-500/30"
                              title="Click to jump to this video second"
                            >
                              <Film className="w-2.5 h-2.5" /> {c.videoTimestampFormatted}
                            </button>
                          )}

                          {/* Bounding Box Area Indicator (Google Drive Style) */}
                          {c.box && (
                            <span className="px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[10px] font-mono font-bold flex items-center gap-1">
                              <Square className="w-2.5 h-2.5" /> Area #{c.pinNumber || "1"}
                            </span>
                          )}

                          {/* Pinpoint Indicator */}
                          {!c.box && c.pinX !== undefined && (
                            <span className="px-1.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 text-[10px] font-mono font-bold flex items-center gap-1">
                              <MapPin className="w-2.5 h-2.5" /> Pin #{c.pinNumber}
                            </span>
                          )}
                        </div>

                        {/* Resolve Button */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleResolve(c.id);
                          }}
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold font-mono transition-colors flex items-center gap-1 cursor-pointer shrink-0 ${
                            c.resolved
                              ? "bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30"
                              : "bg-slate-700 text-slate-300 hover:bg-slate-600 hover:text-white"
                          }`}
                        >
                          <Check className="w-3 h-3" />
                          <span>{c.resolved ? "Resolved" : "Resolve"}</span>
                        </button>
                      </div>

                      <p className="text-xs text-slate-200 leading-relaxed break-words">{c.text}</p>
                      <div className="mt-2 text-[10px] text-slate-500 font-mono flex items-center gap-1">
                        <Clock className="w-2.5 h-2.5" />
                        <span>{new Date(c.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Comment Composer */}
            <div className="p-3 border-t border-white/10 bg-slate-950/50 space-y-2">
              {/* Active Area or Pin Badge */}
              {currentBox && (
                <div className="flex items-center justify-between px-3 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs font-mono">
                  <span className="flex items-center gap-1.5 truncate">
                    <Square className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    Target Box Selected ({currentBox.width}% × {currentBox.height}%)
                  </span>
                  <button
                    type="button"
                    onClick={() => setCurrentBox(null)}
                    className="text-amber-400 hover:text-amber-200 cursor-pointer font-bold shrink-0 ml-2"
                  >
                    Clear
                  </button>
                </div>
              )}

              {activePin && (
                <div className="flex items-center justify-between px-3 py-1.5 rounded-xl bg-indigo-500/10 border border-indigo-500/30 text-indigo-300 text-xs font-mono">
                  <span className="flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-indigo-400" />
                    Pinpoint at ({activePin.x}%, {activePin.y}%)
                  </span>
                  <button
                    type="button"
                    onClick={() => setActivePin(null)}
                    className="text-indigo-400 hover:text-indigo-200 cursor-pointer font-bold"
                  >
                    Clear
                  </button>
                </div>
              )}

              {isVideo && attachedTimestamp !== null && (
                <div className="flex items-center justify-between px-3 py-1.5 rounded-xl bg-purple-500/10 border border-purple-500/30 text-purple-300 text-xs font-mono">
                  <span className="flex items-center gap-1.5">
                    <Film className="w-3.5 h-3.5 text-purple-400" />
                    Attached Video Clip Timestamp: [{formatTime(attachedTimestamp)}]
                  </span>
                  <button
                    type="button"
                    onClick={() => setAttachedTimestamp(null)}
                    className="text-purple-400 hover:text-purple-200 cursor-pointer font-bold"
                  >
                    Clear
                  </button>
                </div>
              )}

              {/* Quick Action Chips */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-[11px]">
                <button
                  type="button"
                  onClick={() => handleAddComment("approved")}
                  className="px-2.5 py-1 rounded-full bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-bold shrink-0 transition-colors cursor-pointer flex items-center gap-1"
                >
                  <CheckCircle2 className="w-3 h-3" /> Approve All
                </button>
                <button
                  type="button"
                  onClick={() => setCommentText("Text/typo correction needed in selected area.")}
                  className="px-2.5 py-1 rounded-full bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 font-bold shrink-0 transition-colors cursor-pointer flex items-center gap-1"
                >
                  <AlertCircle className="w-3 h-3" /> Typo/Text Fix
                </button>
                <button
                  type="button"
                  onClick={() => setCommentText("Color contrast & brightness adjustment requested.")}
                  className="px-2.5 py-1 rounded-full bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 font-bold shrink-0 transition-colors cursor-pointer flex items-center gap-1"
                >
                  <AlertCircle className="w-3 h-3" /> Color Adjust
                </button>
              </div>

              {/* Input + Send */}
              <div className="flex items-end gap-2">
                <textarea
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleAddComment();
                    }
                  }}
                  placeholder={
                    currentBox
                      ? "Describe the error in the selected box..."
                      : isVideo
                      ? `Add note for video clip at ${formatTime(attachedTimestamp !== null ? attachedTimestamp : currentTime)}...`
                      : "Write critique note or error description..."
                  }
                  rows={2}
                  className="flex-1 bg-slate-800 border border-white/10 rounded-2xl px-3 py-2 text-xs text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                />
                <button
                  type="button"
                  disabled={submittingComment || (!commentText.trim() && !currentBox && !activePin)}
                  onClick={() => handleAddComment()}
                  className="h-10 px-4 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs flex items-center justify-center transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shadow-md"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
