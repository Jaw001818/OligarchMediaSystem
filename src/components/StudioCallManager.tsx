import React, { useState, useEffect, useRef } from "react";
import {
  Video,
  VideoOff,
  Mic,
  MicOff,
  PhoneOff,
  PhoneCall,
  MonitorUp,
  Minimize2,
  Maximize2,
  Users,
  BellRing,
  X,
  Volume2
} from "lucide-react";
import { collection, doc, addDoc, setDoc, onSnapshot, query, where, db } from "../firebase";
import { StudioCall, StudioCallSignal } from "../types";
import { playIncomingRingCycle, playRingbackTone, playSendChirp } from "../utils/audioChime";
import { joinExistingStudioCall } from "../utils/callService";

interface StudioCallManagerProps {
  currentUserId: string;
  currentUserName: string;
  currentUserAvatar?: string;
  onJumpToChannel?: (channelId: string) => void;
}

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" }
  ]
};

function VideoTile({
  stream,
  name,
  avatar,
  isLocal = false,
  micMuted = false,
  camOff = false
}: {
  stream: MediaStream | null;
  name: string;
  avatar?: string;
  isLocal?: boolean;
  micMuted?: boolean;
  camOff?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (el.srcObject !== stream) {
      el.srcObject = stream;
    }
  }, [stream]);

  const hasLiveVideo = Boolean(
    stream &&
      stream.getVideoTracks().some((t) => t.enabled && t.readyState === "live") &&
      !camOff
  );

  return (
    <div className="relative rounded-2xl bg-slate-900 border border-white/10 overflow-hidden flex items-center justify-center min-h-[160px] sm:min-h-[210px] shadow-xl">
      {stream && (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={isLocal}
          className={`w-full h-full object-cover ${isLocal ? "scale-x-[-1]" : ""} ${
            hasLiveVideo ? "block" : "hidden"
          }`}
        />
      )}

      {!hasLiveVideo && (
        <div className="flex flex-col items-center justify-center p-4 text-center">
          {avatar ? (
            <img
              src={avatar}
              alt={name}
              className="w-16 h-16 sm:w-20 sm:h-20 rounded-full object-cover border-2 border-indigo-500/50 shadow-lg mb-2"
            />
          ) : (
            <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-gradient-to-tr from-indigo-600 to-purple-600 text-white font-black text-xl flex items-center justify-center border-2 border-white/20 shadow-lg mb-2">
              {name.charAt(0)}
            </div>
          )}
          <span className="text-xs text-slate-400 font-mono">
            {camOff ? "Camera Off" : "Audio Connected"}
          </span>
        </div>
      )}

      {/* Participant Overlay Badge */}
      <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between gap-2 pointer-events-none">
        <span className="px-2.5 py-1 rounded-full bg-slate-950/80 backdrop-blur-md border border-white/10 text-[11px] font-bold text-white truncate max-w-[75%]">
          {name} {isLocal ? "(You)" : ""}
        </span>
        {micMuted ? (
          <span className="w-6 h-6 rounded-full bg-rose-600/90 text-white flex items-center justify-center shrink-0 shadow">
            <MicOff className="w-3 h-3" />
          </span>
        ) : (
          <span className="w-6 h-6 rounded-full bg-emerald-600/80 text-white flex items-center justify-center shrink-0 shadow">
            <Volume2 className="w-3 h-3" />
          </span>
        )}
      </div>
    </div>
  );
}

export default function StudioCallManager({
  currentUserId,
  currentUserName,
  currentUserAvatar,
  onJumpToChannel
}: StudioCallManagerProps) {
  const [calls, setCalls] = useState<StudioCall[]>([]);
  const [dismissedCallIds, setDismissedCallIds] = useState<Set<string>>(new Set());
  const [minimized, setMinimized] = useState(false);

  // Local media & WebRTC state
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const [mediaReadyCallId, setMediaReadyCallId] = useState<string | null>(null);
  const [micMuted, setMicMuted] = useState(false);
  const [camOff, setCamOff] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [mediaNotice, setMediaNotice] = useState<string>("");
  const [callSeconds, setCallSeconds] = useState(0);

  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const pendingCandidatesRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const offeredPeersRef = useRef<Set<string>>(new Set());
  const processedSignalIdsRef = useRef<Set<string>>(new Set());
  const activeCallIdRef = useRef<string | null>(null);
  const incomingRingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const outgoingRingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 1. Subscribe to live calls in Firestore
  useEffect(() => {
    if (!currentUserId) return;
    const unsubscribe = onSnapshot(
      collection(db, "chat_calls"),
      (snapshot) => {
        const fetched: StudioCall[] = [];
        const now = Date.now();
        snapshot.forEach((d: any) => {
          const data = { ...d.data(), id: d.id } as StudioCall;
          const age = now - Number(data.updatedAt || data.createdAt || 0);
          if ((data.status === "ringing" || data.status === "active") && age < 4 * 60 * 60 * 1000) {
            fetched.push(data);
          }
        });
        fetched.sort((a, b) => Number(b.createdAt) - Number(a.createdAt));
        setCalls(fetched);
      },
      (err) => {
        console.warn("Studio calls snapshot note:", err);
      }
    );
    return () => unsubscribe();
  }, [currentUserId]);

  // Identify current joined call vs incoming ringing call
  const activeCall = calls.find((c) => c.participants?.includes(currentUserId)) || null;

  const incomingCall = !activeCall
    ? calls.find((c) => {
        if (dismissedCallIds.has(c.id)) return false;
        if (c.callerId === currentUserId) return false;
        if (c.participants?.includes(currentUserId)) return false;
        const age = Date.now() - Number(c.updatedAt || c.createdAt || 0);
        if (c.status !== "ringing" || age > 75000) return false;

        if (c.isGroupMeeting) {
          return true;
        }
        return c.calleeId === currentUserId || Boolean(c.targetIds?.includes(currentUserId));
      }) || null
    : null;

  // Cleanup all local media & WebRTC connections helper
  const cleanupWebRTC = () => {
    peersRef.current.forEach((pc) => {
      try {
        pc.onicecandidate = null;
        pc.ontrack = null;
        pc.close();
      } catch {}
    });
    peersRef.current.clear();
    pendingCandidatesRef.current.clear();
    offeredPeersRef.current.clear();
    processedSignalIdsRef.current.clear();

    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }

    setLocalStream(null);
    setRemoteStreams({});
    setMediaReadyCallId(null);
    setIsScreenSharing(false);
    setMediaNotice("");
    setMicMuted(false);
    setCamOff(false);
  };

  // Play incoming ringtone while incomingCall is visible
  useEffect(() => {
    if (incomingRingIntervalRef.current) {
      clearInterval(incomingRingIntervalRef.current);
      incomingRingIntervalRef.current = null;
    }
    if (incomingCall) {
      playIncomingRingCycle();
      incomingRingIntervalRef.current = setInterval(() => {
        playIncomingRingCycle();
      }, 2400);
    }
    return () => {
      if (incomingRingIntervalRef.current) {
        clearInterval(incomingRingIntervalRef.current);
        incomingRingIntervalRef.current = null;
      }
    };
  }, [incomingCall?.id]);

  // Play soft outgoing ringback tone while waiting for a teammate to join
  useEffect(() => {
    if (outgoingRingIntervalRef.current) {
      clearInterval(outgoingRingIntervalRef.current);
      outgoingRingIntervalRef.current = null;
    }
    const isWaitingForAnswer =
      activeCall &&
      activeCall.status === "ringing" &&
      activeCall.callerId === currentUserId &&
      (activeCall.participants?.length || 0) <= 1;

    if (isWaitingForAnswer) {
      playRingbackTone();
      outgoingRingIntervalRef.current = setInterval(() => {
        playRingbackTone();
      }, 3000);
    }
    return () => {
      if (outgoingRingIntervalRef.current) {
        clearInterval(outgoingRingIntervalRef.current);
        outgoingRingIntervalRef.current = null;
      }
    };
  }, [activeCall?.id, activeCall?.status, activeCall?.participants?.length, currentUserId]);

  // Call duration timer
  useEffect(() => {
    if (!activeCall || (activeCall.participants?.length || 0) < 2) {
      setCallSeconds(0);
      return;
    }
    const timer = setInterval(() => {
      setCallSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [activeCall?.id, (activeCall?.participants?.length || 0) >= 2]);

  // Acquire camera/mic automatically when entering a call
  useEffect(() => {
    if (!activeCall) {
      if (activeCallIdRef.current) {
        activeCallIdRef.current = null;
        cleanupWebRTC();
        setMinimized(false);
      }
      return;
    }

    if (activeCallIdRef.current === activeCall.id) return;
    activeCallIdRef.current = activeCall.id;

    let cancelled = false;
    const wantVideo = activeCall.callType === "video" && !activeCall.participantMedia?.[currentUserId]?.camOff;

    const acquireMedia = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        if (!cancelled) {
          setCamOff(true);
          setMicMuted(true);
          setMediaNotice("Browser media devices unavailable — joined in listen mode.");
          setMediaReadyCallId(activeCall.id);
        }
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: wantVideo,
          audio: true
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        localStreamRef.current = stream;
        setLocalStream(stream);
        setCamOff(!wantVideo || stream.getVideoTracks().length === 0);
        setMicMuted(false);
        setMediaNotice("");
        setMediaReadyCallId(activeCall.id);
      } catch {
        // Fallback to audio-only if camera failed or unavailable
        try {
          const audioStream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
          if (cancelled) {
            audioStream.getTracks().forEach((t) => t.stop());
            return;
          }
          localStreamRef.current = audioStream;
          setLocalStream(audioStream);
          setCamOff(true);
          setMicMuted(false);
          setMediaNotice("Camera unavailable — connected with microphone audio.");
          setMediaReadyCallId(activeCall.id);
        } catch {
          if (!cancelled) {
            localStreamRef.current = null;
            setLocalStream(null);
            setCamOff(true);
            setMicMuted(true);
            setMediaNotice("Microphone/camera permission blocked — joined in listen-only mode.");
            setMediaReadyCallId(activeCall.id);
          }
        }
      }
    };

    acquireMedia();

    return () => {
      cancelled = true;
    };
  }, [activeCall?.id]);

  // Create/maintain RTCPeerConnection for a given remote peer
  const getOrCreatePeer = (callId: string, peerId: string): RTCPeerConnection => {
    const existing = peersRef.current.get(peerId);
    if (existing) return existing;

    const pc = new RTCPeerConnection(RTC_CONFIG);

    const stream = localStreamRef.current;
    if (stream && stream.getTracks().length > 0) {
      stream.getTracks().forEach((track) => {
        pc.addTrack(track, stream);
      });
    } else {
      try {
        pc.addTransceiver("audio", { direction: "recvonly" });
        pc.addTransceiver("video", { direction: "recvonly" });
      } catch {}
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        addDoc(collection(db, "chat_call_signals"), {
          callId,
          fromId: currentUserId,
          toId: peerId,
          kind: "candidate",
          payload: event.candidate.toJSON(),
          createdAt: Date.now()
        }).catch(() => {});
      }
    };

    pc.ontrack = (event) => {
      const incomingStream = event.streams?.[0] || new MediaStream([event.track]);
      setRemoteStreams((prev) => ({
        ...prev,
        [peerId]: incomingStream
      }));
    };

    peersRef.current.set(peerId, pc);
    return pc;
  };

  // Sync peer connections with activeCall.participants once local media setup finishes
  useEffect(() => {
    if (!activeCall || mediaReadyCallId !== activeCall.id) return;

    const otherParticipants = (activeCall.participants || []).filter((id) => id !== currentUserId);
    const otherSet = new Set(otherParticipants);

    // Close peers who left
    Array.from(peersRef.current.keys()).forEach((peerId) => {
      if (!otherSet.has(peerId)) {
        try {
          peersRef.current.get(peerId)?.close();
        } catch {}
        peersRef.current.delete(peerId);
        offeredPeersRef.current.delete(peerId);
        setRemoteStreams((prev) => {
          const next = { ...prev };
          delete next[peerId];
          return next;
        });
      }
    });

    // Connect to peers & initiate offer if deterministic offerer (smaller ID)
    otherParticipants.forEach(async (peerId) => {
      const pc = getOrCreatePeer(activeCall.id, peerId);
      if (currentUserId < peerId && !offeredPeersRef.current.has(peerId)) {
        offeredPeersRef.current.add(peerId);
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          await addDoc(collection(db, "chat_call_signals"), {
            callId: activeCall.id,
            fromId: currentUserId,
            toId: peerId,
            kind: "offer",
            payload: { type: offer.type, sdp: offer.sdp },
            createdAt: Date.now()
          });
        } catch (err) {
          console.warn("WebRTC offer error:", err);
        }
      }
    });
  }, [activeCall?.id, activeCall?.participants?.join(","), mediaReadyCallId, currentUserId]);

  // Listen for WebRTC signals addressed to currentUserId
  useEffect(() => {
    if (!activeCall || mediaReadyCallId !== activeCall.id) return;

    const qSignals = query(collection(db, "chat_call_signals"), where("callId", "==", activeCall.id));
    const unsubscribe = onSnapshot(
      qSignals,
      (snapshot) => {
        const incoming: StudioCallSignal[] = [];
        snapshot.forEach((d: any) => {
          const sig = { ...d.data(), id: d.id } as StudioCallSignal;
          if (sig.toId === currentUserId && !processedSignalIdsRef.current.has(d.id)) {
            incoming.push(sig);
          }
        });

        incoming.sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));

        incoming.forEach(async (sig) => {
          if (!sig.id) return;
          processedSignalIdsRef.current.add(sig.id);
          const pc = getOrCreatePeer(activeCall.id, sig.fromId);

          try {
            if (sig.kind === "offer") {
              await pc.setRemoteDescription(new RTCSessionDescription(sig.payload));
              const queued = pendingCandidatesRef.current.get(sig.fromId) || [];
              pendingCandidatesRef.current.delete(sig.fromId);
              for (const cand of queued) {
                await pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
              }
              const answer = await pc.createAnswer();
              await pc.setLocalDescription(answer);
              await addDoc(collection(db, "chat_call_signals"), {
                callId: activeCall.id,
                fromId: currentUserId,
                toId: sig.fromId,
                kind: "answer",
                payload: { type: answer.type, sdp: answer.sdp },
                createdAt: Date.now()
              });
            } else if (sig.kind === "answer") {
              if (pc.signalingState === "have-local-offer") {
                await pc.setRemoteDescription(new RTCSessionDescription(sig.payload));
                const queued = pendingCandidatesRef.current.get(sig.fromId) || [];
                pendingCandidatesRef.current.delete(sig.fromId);
                for (const cand of queued) {
                  await pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
                }
              }
            } else if (sig.kind === "candidate" && sig.payload) {
              if (pc.remoteDescription) {
                await pc.addIceCandidate(new RTCIceCandidate(sig.payload)).catch(() => {});
              } else {
                const list = pendingCandidatesRef.current.get(sig.fromId) || [];
                list.push(sig.payload);
                pendingCandidatesRef.current.set(sig.fromId, list);
              }
            }
          } catch (err) {
            console.warn("WebRTC signal handling note:", err);
          }
        });
      },
      (err) => {
        console.warn("Call signals snapshot note:", err);
      }
    );

    return () => unsubscribe();
  }, [activeCall?.id, mediaReadyCallId, currentUserId]);

  // Actions
  const handleAnswerIncoming = async (withVideo: boolean) => {
    if (!incomingCall) return;
    playSendChirp();
    try {
      await joinExistingStudioCall(incomingCall, currentUserId, currentUserName, currentUserAvatar, withVideo);
      if (onJumpToChannel) {
        onJumpToChannel(incomingCall.channelId);
      }
    } catch (err) {
      console.error("Failed to answer call:", err);
    }
  };

  const handleDeclineIncoming = async () => {
    if (!incomingCall) return;
    setDismissedCallIds((prev) => new Set(prev).add(incomingCall.id));
    if (!incomingCall.isGroupMeeting) {
      await setDoc(
        doc(db, "chat_calls", incomingCall.id),
        {
          status: "declined",
          endedAt: Date.now(),
          updatedAt: Date.now()
        },
        { merge: true }
      ).catch(() => {});
    }
  };

  const handleLeaveOrEndCall = async () => {
    if (!activeCall) return;
    const callSnapshot = activeCall;
    cleanupWebRTC();

    const remaining = (callSnapshot.participants || []).filter((id) => id !== currentUserId);
    const shouldEndCall = remaining.length === 0 || !callSnapshot.isGroupMeeting;

    await setDoc(
      doc(db, "chat_calls", callSnapshot.id),
      {
        participants: remaining,
        status: shouldEndCall ? "ended" : "active",
        ...(shouldEndCall ? { endedAt: Date.now() } : {}),
        updatedAt: Date.now()
      },
      { merge: true }
    ).catch(() => {});
  };

  const handleToggleMic = () => {
    const nextMuted = !micMuted;
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach((t) => {
        t.enabled = !nextMuted;
      });
    }
    setMicMuted(nextMuted);
    if (activeCall) {
      setDoc(
        doc(db, "chat_calls", activeCall.id),
        {
          participantMedia: {
            ...(activeCall.participantMedia || {}),
            [currentUserId]: { micMuted: nextMuted, camOff }
          }
        },
        { merge: true }
      ).catch(() => {});
    }
  };

  const handleToggleCam = async () => {
    const nextCamOff = !camOff;
    if (localStreamRef.current && localStreamRef.current.getVideoTracks().length > 0) {
      localStreamRef.current.getVideoTracks().forEach((t) => {
        t.enabled = !nextCamOff;
      });
      setCamOff(nextCamOff);
    } else if (!nextCamOff && navigator.mediaDevices?.getUserMedia) {
      try {
        const camStream = await navigator.mediaDevices.getUserMedia({ video: true });
        const camTrack = camStream.getVideoTracks()[0];
        if (camTrack) {
          const baseStream = localStreamRef.current || new MediaStream();
          baseStream.addTrack(camTrack);
          localStreamRef.current = baseStream;
          setLocalStream(new MediaStream(baseStream.getTracks()));
          setCamOff(false);

          // Push video track to existing peer connections
          peersRef.current.forEach(async (pc, peerId) => {
            const sender = pc.getSenders().find((s) => s.track?.kind === "video");
            if (sender) {
              await sender.replaceTrack(camTrack).catch(() => {});
            } else {
              pc.addTrack(camTrack, baseStream);
            }
            if (activeCall) {
              try {
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                await addDoc(collection(db, "chat_call_signals"), {
                  callId: activeCall.id,
                  fromId: currentUserId,
                  toId: peerId,
                  kind: "offer",
                  payload: { type: offer.type, sdp: offer.sdp },
                  createdAt: Date.now()
                });
              } catch {}
            }
          });
        }
      } catch {
        setMediaNotice("Camera access is unavailable on this device.");
        return;
      }
    }

    if (activeCall) {
      setDoc(
        doc(db, "chat_calls", activeCall.id),
        {
          participantMedia: {
            ...(activeCall.participantMedia || {}),
            [currentUserId]: { micMuted, camOff: nextCamOff }
          }
        },
        { merge: true }
      ).catch(() => {});
    }
  };

  const handleToggleScreenShare = async () => {
    if (!activeCall) return;
    if (isScreenSharing) {
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach((t) => t.stop());
        screenStreamRef.current = null;
      }
      const camTrack = localStreamRef.current?.getVideoTracks()[0] || null;
      peersRef.current.forEach((pc) => {
        const sender = pc.getSenders().find((s) => s.track?.kind === "video");
        if (sender && camTrack) sender.replaceTrack(camTrack).catch(() => {});
      });
      if (localStreamRef.current) {
        setLocalStream(new MediaStream(localStreamRef.current.getTracks()));
      }
      setIsScreenSharing(false);
      return;
    }

    try {
      const displayMedia = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const screenTrack = displayMedia.getVideoTracks()[0];
      if (!screenTrack) return;

      screenStreamRef.current = displayMedia;
      setIsScreenSharing(true);

      peersRef.current.forEach((pc) => {
        const sender = pc.getSenders().find((s) => s.track?.kind === "video");
        if (sender) {
          sender.replaceTrack(screenTrack).catch(() => {});
        }
      });

      const previewStream = new MediaStream([
        ...(localStreamRef.current?.getAudioTracks() || []),
        screenTrack
      ]);
      setLocalStream(previewStream);

      screenTrack.onended = () => {
        setIsScreenSharing(false);
        const camTrack = localStreamRef.current?.getVideoTracks()[0] || null;
        peersRef.current.forEach((pc) => {
          const sender = pc.getSenders().find((s) => s.track?.kind === "video");
          if (sender && camTrack) sender.replaceTrack(camTrack).catch(() => {});
        });
        if (localStreamRef.current) {
          setLocalStream(new MediaStream(localStreamRef.current.getTracks()));
        }
      };
    } catch {
      setMediaNotice("Screen share was cancelled or unsupported in this view.");
    }
  };

  const handleRingAgain = async () => {
    if (!activeCall) return;
    playSendChirp();
    await setDoc(
      doc(db, "chat_calls", activeCall.id),
      {
        status: "ringing",
        updatedAt: Date.now()
      },
      { merge: true }
    ).catch(() => {});
  };

  const formatDuration = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupWebRTC();
    };
  }, []);

  const otherParticipants = activeCall ? (activeCall.participants || []).filter((id) => id !== currentUserId) : [];

  return (
    <>
      {/* 1. INCOMING RING / CALL POPUP OVERLAY */}
      {incomingCall && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md animate-in fade-in">
          <div className="bg-slate-900 border border-emerald-500/40 rounded-3xl max-w-sm w-full p-6 shadow-2xl text-center space-y-5 relative overflow-hidden">
            <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-emerald-500 via-indigo-500 to-emerald-500 animate-pulse" />

            <div className="flex flex-col items-center">
              <div className="relative mb-3">
                <span className="absolute -inset-2 rounded-full bg-emerald-500/20 animate-ping" />
                {incomingCall.callerAvatar ? (
                  <img
                    src={incomingCall.callerAvatar}
                    alt={incomingCall.callerName}
                    className="w-20 h-20 rounded-full object-cover border-2 border-emerald-400 relative z-10 shadow-lg"
                  />
                ) : (
                  <div className="w-20 h-20 rounded-full bg-gradient-to-tr from-emerald-600 to-indigo-600 text-white font-black text-2xl flex items-center justify-center border-2 border-emerald-400 relative z-10 shadow-lg">
                    {incomingCall.callerName.charAt(0)}
                  </div>
                )}
              </div>

              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-[11px] font-mono font-bold uppercase mb-1.5">
                <BellRing className="w-3 h-3 animate-bounce" />
                {incomingCall.isGroupMeeting
                  ? `Studio Meeting • #${incomingCall.channelName}`
                  : incomingCall.callType === "video"
                  ? "Incoming Video Call"
                  : "Incoming Voice Ring"}
              </span>

              <h3 className="text-lg font-black text-white tracking-tight">
                {incomingCall.callerName}
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                {incomingCall.isGroupMeeting
                  ? "Ringing studio team members to join the meeting"
                  : "is ringing you in Studio Chat"}
              </p>
            </div>

            <div className="flex items-center justify-center gap-3 pt-1">
              <button
                type="button"
                onClick={handleDeclineIncoming}
                className="flex-1 py-3 px-3 rounded-2xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs flex flex-col items-center justify-center gap-1 shadow-lg cursor-pointer transition-colors"
              >
                <PhoneOff className="w-5 h-5" />
                <span>Decline</span>
              </button>

              <button
                type="button"
                onClick={() => handleAnswerIncoming(false)}
                className="flex-1 py-3 px-3 rounded-2xl bg-slate-800 hover:bg-slate-700 text-emerald-300 border border-emerald-500/30 font-bold text-xs flex flex-col items-center justify-center gap-1 shadow-lg cursor-pointer transition-colors"
              >
                <PhoneCall className="w-5 h-5" />
                <span>Audio</span>
              </button>

              <button
                type="button"
                onClick={() => handleAnswerIncoming(true)}
                className="flex-1 py-3 px-3 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex flex-col items-center justify-center gap-1 shadow-lg cursor-pointer transition-colors"
              >
                <Video className="w-5 h-5" />
                <span>Video</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2. ACTIVE / OUTGOING VIDEO CALL VIEW */}
      {activeCall && minimized && (
        <div className="fixed top-3 right-3 z-[65] bg-slate-900/95 border border-emerald-500/40 rounded-2xl px-3.5 py-2.5 shadow-2xl backdrop-blur-xl flex items-center gap-3">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
          <div className="min-w-0">
            <p className="text-xs font-bold text-white truncate max-w-[140px]">
              {activeCall.isGroupMeeting ? `#${activeCall.channelName}` : activeCall.calleeName || activeCall.callerName}
            </p>
            <p className="text-[10px] text-emerald-300 font-mono">
              {otherParticipants.length > 0 ? `Live • ${formatDuration(callSeconds)}` : "Ringing..."}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setMinimized(false)}
            className="p-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white cursor-pointer"
            title="Expand Call"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={handleLeaveOrEndCall}
            className="p-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white cursor-pointer"
            title="End Call"
          >
            <PhoneOff className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {activeCall && !minimized && (
        <div className="fixed inset-0 z-[65] bg-slate-950/95 backdrop-blur-xl flex flex-col text-white animate-in fade-in">
          {/* Top Call Bar */}
          <header className="px-4 py-3 border-b border-white/10 bg-slate-950/90 flex items-center justify-between gap-2 shrink-0">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-9 h-9 rounded-2xl bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 flex items-center justify-center shrink-0">
                <Video className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm sm:text-base font-black text-white truncate">
                    {activeCall.isGroupMeeting
                      ? `#${activeCall.channelName} Meeting`
                      : activeCall.callerId === currentUserId
                      ? activeCall.calleeName || "Direct Call"
                      : activeCall.callerName}
                  </h3>
                  <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-[10px] font-mono font-bold shrink-0">
                    {otherParticipants.length > 0 ? formatDuration(callSeconds) : "Ringing..."}
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 font-mono flex items-center gap-1.5">
                  <Users className="w-3 h-3" />
                  <span>{activeCall.participants.length} in call</span>
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={handleRingAgain}
                className="px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-white/10 text-xs font-bold text-amber-300 flex items-center gap-1 cursor-pointer"
                title="Send Ring Alert Again"
              >
                <BellRing className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Ring</span>
              </button>
              <button
                type="button"
                onClick={() => setMinimized(true)}
                className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-white/10 text-slate-300 hover:text-white cursor-pointer"
                title="Minimize to browse chat"
              >
                <Minimize2 className="w-4 h-4" />
              </button>
            </div>
          </header>

          {mediaNotice && (
            <div className="px-4 py-2 bg-amber-950/70 border-b border-amber-500/30 text-amber-200 text-xs font-mono flex items-center justify-between gap-2 shrink-0">
              <span>{mediaNotice}</span>
              <button type="button" onClick={() => setMediaNotice("")} className="text-amber-300 hover:text-white cursor-pointer">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Video Grid */}
          <div className="flex-1 overflow-y-auto p-3 sm:p-6 flex items-center justify-center min-h-0">
            <div
              className={`w-full max-w-5xl grid gap-3 sm:gap-4 ${
                otherParticipants.length === 0
                  ? "grid-cols-1 max-w-lg"
                  : otherParticipants.length === 1
                  ? "grid-cols-1 sm:grid-cols-2"
                  : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
              }`}
            >
              {/* Local Participant Tile */}
              <VideoTile
                stream={localStream}
                name={currentUserName}
                avatar={currentUserAvatar}
                isLocal
                micMuted={micMuted}
                camOff={camOff && !isScreenSharing}
              />

              {/* Remote Participant Tiles */}
              {otherParticipants.map((peerId) => {
                const peerName = activeCall.participantNames?.[peerId] || "Teammate";
                const peerAvatar = activeCall.participantAvatars?.[peerId];
                const peerMedia = activeCall.participantMedia?.[peerId];
                return (
                  <VideoTile
                    key={peerId}
                    stream={remoteStreams[peerId] || null}
                    name={peerName}
                    avatar={peerAvatar}
                    micMuted={Boolean(peerMedia?.micMuted)}
                    camOff={Boolean(peerMedia?.camOff)}
                  />
                );
              })}

              {/* Waiting Banner when no peer has joined yet */}
              {otherParticipants.length === 0 && (
                <div className="rounded-2xl bg-slate-900/70 border border-white/10 p-5 text-center space-y-2">
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 text-xs font-mono font-bold">
                    <span className="w-2 h-2 rounded-full bg-indigo-400 animate-ping" />
                    <span>
                      {activeCall.isGroupMeeting
                        ? `Ringing #${activeCall.channelName}...`
                        : `Ringing ${activeCall.calleeName || "teammate"}...`}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400">
                    Waiting for {activeCall.isGroupMeeting ? "team members" : activeCall.calleeName || "them"} to tap Answer on their screen.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Bottom Controls Dock */}
          <footer className="p-4 border-t border-white/10 bg-slate-950/95 flex items-center justify-center gap-3 shrink-0">
            <button
              type="button"
              onClick={handleToggleMic}
              className={`min-w-[52px] min-h-[52px] px-4 rounded-2xl flex flex-col items-center justify-center gap-1 text-[10px] font-bold transition-colors cursor-pointer ${
                micMuted
                  ? "bg-rose-600/20 text-rose-300 border border-rose-500/40"
                  : "bg-slate-800 hover:bg-slate-700 text-white border border-white/10"
              }`}
              title={micMuted ? "Unmute Mic" : "Mute Mic"}
            >
              {micMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
              <span>{micMuted ? "Unmute" : "Mic"}</span>
            </button>

            <button
              type="button"
              onClick={handleToggleCam}
              className={`min-w-[52px] min-h-[52px] px-4 rounded-2xl flex flex-col items-center justify-center gap-1 text-[10px] font-bold transition-colors cursor-pointer ${
                camOff
                  ? "bg-rose-600/20 text-rose-300 border border-rose-500/40"
                  : "bg-slate-800 hover:bg-slate-700 text-white border border-white/10"
              }`}
              title={camOff ? "Turn Camera On" : "Turn Camera Off"}
            >
              {camOff ? <VideoOff className="w-5 h-5" /> : <Video className="w-5 h-5" />}
              <span>{camOff ? "Cam Off" : "Camera"}</span>
            </button>

            <button
              type="button"
              onClick={handleToggleScreenShare}
              className={`hidden sm:flex min-w-[52px] min-h-[52px] px-4 rounded-2xl flex-col items-center justify-center gap-1 text-[10px] font-bold transition-colors cursor-pointer ${
                isScreenSharing
                  ? "bg-indigo-600 text-white border border-indigo-400"
                  : "bg-slate-800 hover:bg-slate-700 text-white border border-white/10"
              }`}
              title="Share Screen for Design Review"
            >
              <MonitorUp className="w-5 h-5" />
              <span>{isScreenSharing ? "Sharing" : "Share"}</span>
            </button>

            <button
              type="button"
              onClick={handleLeaveOrEndCall}
              className="min-w-[64px] min-h-[52px] px-5 rounded-2xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs flex flex-col items-center justify-center gap-1 shadow-lg cursor-pointer transition-colors"
              title="End / Leave Call"
            >
              <PhoneOff className="w-5 h-5" />
              <span>End</span>
            </button>
          </footer>
        </div>
      )}
    </>
  );
}
