import React, { useState, useEffect, useRef } from "react";
import {
  MessageSquare,
  Send,
  Paperclip,
  Smile,
  Hash,
  Users,
  Plus,
  Search,
  Bell,
  BellOff,
  Image as ImageIcon,
  FileText,
  Download,
  Eye,
  CheckCircle2,
  AlertCircle,
  Pin,
  X,
  Sparkles,
  Lock,
  ChevronDown,
  Circle,
  Clock,
  MoreVertical,
  Layers,
  Palette,
  Film,
  Play,
  Square,
  ChevronLeft,
  Pencil,
  Trash2,
  Video,
  PhoneCall,
  Coffee,
  Headphones,
  UserPlus,
  Eraser
} from "lucide-react";
import { Employee, ChatChannel, ChatMessage, Attendance, EmployeePresenceStatus, StudioCall } from "../types";
import { getBusinessDate } from "../utils";
import { startOrJoinStudioCall, joinExistingStudioCall } from "../utils/callService";
import {
  collection,
  doc,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
  db,
  storage
} from "../firebase";
import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";
import { playMessageChime, playSendChirp } from "../utils/audioChime";
import DesignReviewModal from "./DesignReviewModal";

interface ChatManagerProps {
  currentUser: any; // Employee or Admin User
  employees: Employee[];
  userType: "admin" | "employee";
  todayAttendance?: any | null;
  onTimeIn?: () => void;
  onTimeOut?: () => void;
  onStartBreak?: () => void;
  onEndBreak?: () => void;
  onSwitchTab?: (tab: string) => void;
  mobileFullScreen?: boolean;
  onKeyboardOpenChange?: (open: boolean) => void;
}

const DEFAULT_CHANNELS: Array<Omit<ChatChannel, "id">> = [
  {
    name: "studio-general",
    description: "General floor discussion, shift coordination & team banter",
    type: "channel",
    createdBy: "system",
    createdAt: Date.now() - 86400000 * 3
  },
  {
    name: "design-critique",
    description: "🎨 Dedicated studio critique channel for thumbnails, posters & artwork review",
    type: "channel",
    createdBy: "system",
    createdAt: Date.now() - 86400000 * 2
  },
  {
    name: "studio-announcements",
    description: "Official shift notices, cutoff updates & management broadcasts",
    type: "channel",
    createdBy: "system",
    createdAt: Date.now() - 86400000
  }
];

export default function ChatManager({
  currentUser,
  employees,
  userType,
  todayAttendance,
  onTimeIn,
  onTimeOut,
  onStartBreak,
  onEndBreak,
  onSwitchTab,
  mobileFullScreen = false,
  onKeyboardOpenChange
}: ChatManagerProps) {
  // Current user details
  const currentUserId = userType === "admin" ? "admin-hr" : currentUser?.id || currentUser?.employeeNumber || "unknown";
  const currentUserName = userType === "admin" ? (currentUser?.displayName || "Studio Admin (HR)") : currentUser?.fullName || "Artist";
  const currentUserRole = userType === "admin" ? "admin" : (currentUser?.position || "Graphic Designer");
  const currentUserAvatar = userType === "admin" ? "" : currentUser?.profilePicture || "";

  // State (pre-seeded with defaults until Firestore snapshot resolves)
  const [channels, setChannels] = useState<ChatChannel[]>(() =>
    DEFAULT_CHANNELS.map((dc) => ({ ...dc, id: dc.name }))
  );
  const [channelsLoaded, setChannelsLoaded] = useState(false);
  const [activeChannelId, setActiveChannelId] = useState<string>("studio-general");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messageText, setMessageText] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [channelFilter, setChannelFilter] = useState<"all" | "channels" | "direct" | "designs">("all");
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [mobileView, setMobileView] = useState<"chat" | "channels">("channels");

  // Mobile VisualViewport & Soft Keyboard State (Messenger-style lift)
  const [isMobileViewport, setIsMobileViewport] = useState<boolean>(() =>
    typeof window !== "undefined" ? window.innerWidth < 768 : false
  );
  const [viewportBox, setViewportBox] = useState<{ height: number; top: number } | null>(null);
  const [isComposerFocused, setIsComposerFocused] = useState(false);
  const [isViewportKeyboardOpen, setIsViewportKeyboardOpen] = useState(false);
  const baselineHeightRef = useRef<number>(
    typeof window !== "undefined" ? (window.visualViewport?.height || window.innerHeight) : 0
  );
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // File & Media attachment states (Image Design & Video Clips)
  const [attachedFile, setAttachedFile] = useState<{
    url: string;
    name: string;
    type: string;
    size: string;
  } | null>(null);
  const [isUploadingAttachment, setIsUploadingAttachment] = useState(false);
  const [chatNotice, setChatNotice] = useState<{ text: string; type: "error" | "info" } | null>(null);
  const [isDesignReviewTag, setIsDesignReviewTag] = useState(false);
  const [isVideoReviewTag, setIsVideoReviewTag] = useState(false);
  const [designTitleInput, setDesignTitleInput] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Modals & Panels
  const [showCreateChannelModal, setShowCreateChannelModal] = useState(false);
  const [newChannelName, setNewChannelName] = useState("");
  const [newChannelDesc, setNewChannelDesc] = useState("");
  const [editingChannel, setEditingChannel] = useState<ChatChannel | null>(null);
  const [editChannelName, setEditChannelName] = useState("");
  const [editChannelDesc, setEditChannelDesc] = useState("");
  const [editChannelError, setEditChannelError] = useState("");
  const [isSavingChannelEdit, setIsSavingChannelEdit] = useState(false);
  const [deletingChannel, setDeletingChannel] = useState<ChatChannel | null>(null);
  const [isDeletingChannel, setIsDeletingChannel] = useState(false);
  const [deletingMessage, setDeletingMessage] = useState<ChatMessage | null>(null);
  const [isDeletingMessage, setIsDeletingMessage] = useState(false);
  const [showClearMessagesModal, setShowClearMessagesModal] = useState(false);
  const [isClearingMessages, setIsClearingMessages] = useState(false);
  const [activeReviewMessage, setActiveReviewMessage] = useState<ChatMessage | null>(null);

  // Direct Message / Call Directory Picker & Custom Employee Status Modals
  const [showNewDmModal, setShowNewDmModal] = useState(false);
  const [dmPickerSearch, setDmPickerSearch] = useState("");
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [statusNoteInput, setStatusNoteInput] = useState("");
  const [isSavingStatus, setIsSavingStatus] = useState(false);
  const [localPresenceOverride, setLocalPresenceOverride] = useState<{
    status: EmployeePresenceStatus;
    note?: string;
  } | null>(null);
  const [isStartingCall, setIsStartingCall] = useState(false);
  const [liveCalls, setLiveCalls] = useState<StudioCall[]>([]);

  // Pop-up Toast for incoming messages from other channels
  const [incomingToast, setIncomingToast] = useState<{
    id: string;
    senderName: string;
    senderAvatar?: string;
    channelName: string;
    channelId: string;
    text: string;
  } | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isFirstLoadRef = useRef(true);
  const seedCheckedRef = useRef(false);

  // Real-time Attendance Presence (Green / Active ONLY when employee is Clocked In)
  const [shiftDate, setShiftDate] = useState<string>(() => getBusinessDate());
  const [shiftAttendanceRecords, setShiftAttendanceRecords] = useState<Attendance[]>([]);

  const showChatNotice = (text: string, type: "error" | "info" = "error") => {
    setChatNotice({ text, type });
    setTimeout(() => {
      setChatNotice((prev) => (prev?.text === text ? null : prev));
    }, 5000);
  };

  // Scroll to bottom when messages update
  const scrollToBottom = (smooth = true) => {
    messagesEndRef.current?.scrollIntoView({ behavior: smooth ? "smooth" : "auto" });
  };

  // Track mobile viewport & software keyboard (like Messenger)
  const effectiveKeyboardOpen = isMobileViewport && (isViewportKeyboardOpen || isComposerFocused);

  useEffect(() => {
    onKeyboardOpenChange?.(effectiveKeyboardOpen);
    if (effectiveKeyboardOpen) {
      setTimeout(() => scrollToBottom(true), 80);
    }
  }, [effectiveKeyboardOpen, onKeyboardOpenChange]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const updateViewportMetrics = () => {
      const mobile = window.innerWidth < 768;
      setIsMobileViewport(mobile);

      const vv = window.visualViewport;
      const vvHeight = vv ? vv.height : window.innerHeight;
      const vvTop = vv ? vv.offsetTop : 0;

      if (vvHeight > baselineHeightRef.current || Math.abs(vvHeight - baselineHeightRef.current) < 40) {
        baselineHeightRef.current = Math.max(baselineHeightRef.current, vvHeight);
      }

      const kbOpen = mobile && baselineHeightRef.current - vvHeight > 120;
      setIsViewportKeyboardOpen(kbOpen);
      setViewportBox({ height: vvHeight, top: vvTop });
    };

    const handleOrientationReset = () => {
      baselineHeightRef.current = window.visualViewport?.height || window.innerHeight;
      updateViewportMetrics();
    };

    updateViewportMetrics();
    const vv = window.visualViewport;
    vv?.addEventListener("resize", updateViewportMetrics);
    vv?.addEventListener("scroll", updateViewportMetrics);
    window.addEventListener("resize", updateViewportMetrics);
    window.addEventListener("orientationchange", handleOrientationReset);

    return () => {
      vv?.removeEventListener("resize", updateViewportMetrics);
      vv?.removeEventListener("scroll", updateViewportMetrics);
      window.removeEventListener("resize", updateViewportMetrics);
      window.removeEventListener("orientationchange", handleOrientationReset);
      if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current);
      onKeyboardOpenChange?.(false);
    };
  }, [onKeyboardOpenChange]);

  // Keep business shift date updated across midnight / noon shift rollovers
  useEffect(() => {
    const interval = setInterval(() => {
      const nextDate = getBusinessDate();
      setShiftDate((prev) => (prev === nextDate ? prev : nextDate));
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  // Real-time listener for current shift attendance (tracks who is currently Clocked In)
  useEffect(() => {
    const qAtt = query(collection(db, "attendance"), where("date", "==", shiftDate));
    const unsubscribe = onSnapshot(
      qAtt,
      (snapshot) => {
        const list: Attendance[] = [];
        snapshot.forEach((docSnap: any) => {
          list.push({ ...docSnap.data(), id: docSnap.id });
        });
        setShiftAttendanceRecords(list);
      },
      (err) => {
        console.warn("Chat attendance presence listener note:", err);
      }
    );
    return () => unsubscribe();
  }, [shiftDate]);

  // Listen to live studio calls (highlights active channel meetings & "In Meeting" status)
  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, "chat_calls"),
      (snapshot) => {
        const now = Date.now();
        const active: StudioCall[] = [];
        snapshot.forEach((d: any) => {
          const data = { ...d.data(), id: d.id } as StudioCall;
          const age = now - Number(data.updatedAt || data.createdAt || 0);
          if ((data.status === "ringing" || data.status === "active") && age < 4 * 60 * 60 * 1000) {
            active.push(data);
          }
        });
        setLiveCalls(active);
      },
      (err) => {
        console.warn("Chat live calls listener note:", err);
      }
    );
    return () => unsubscribe();
  }, []);

  // 1. Listen to Channels from Firestore (seed defaults only once on fresh DB)
  useEffect(() => {
    const channelsRef = collection(db, "chat_channels");
    const unsubscribe = onSnapshot(
      channelsRef,
      async (snapshot) => {
        const fetched: ChatChannel[] = [];
        snapshot.forEach((docSnap: any) => {
          fetched.push({ ...docSnap.data(), id: docSnap.id });
        });

        if (fetched.length === 0 && !seedCheckedRef.current) {
          seedCheckedRef.current = true;
          try {
            const configRef = doc(db, "settings", "chat_config");
            const configSnap = await getDoc(configRef).catch(() => null);
            const alreadySeeded = Boolean(configSnap?.exists() && configSnap.data()?.defaultsSeeded);

            if (!alreadySeeded) {
              await setDoc(configRef, { defaultsSeeded: true, seededAt: Date.now() }, { merge: true }).catch(() => {});
              DEFAULT_CHANNELS.forEach((dc) => {
                setDoc(doc(db, "chat_channels", dc.name), {
                  ...dc,
                  id: dc.name
                }).catch(() => {});
              });
              setChannels(DEFAULT_CHANNELS.map((dc) => ({ ...dc, id: dc.name })));
              setChannelsLoaded(true);
              return;
            }
          } catch {}
        } else if (fetched.length > 0 && !seedCheckedRef.current) {
          seedCheckedRef.current = true;
          setDoc(doc(db, "settings", "chat_config"), { defaultsSeeded: true }, { merge: true }).catch(() => {});
        }

        fetched.sort((a, b) => {
          const timeA = Number(a.lastMessageAt || a.createdAt) || 0;
          const timeB = Number(b.lastMessageAt || b.createdAt) || 0;
          return timeB - timeA;
        });
        setChannels(fetched);
        setChannelsLoaded(true);
      },
      (err) => {
        console.warn("Channels snapshot note:", err);
        setChannelsLoaded(true);
      }
    );

    return () => unsubscribe();
  }, []);

  // Ensure activeChannelId stays valid if a channel was deleted or none selected
  useEffect(() => {
    if (!channelsLoaded) return;
    if (activeChannelId && activeChannelId.startsWith("dm_")) return;

    const channelDocs = channels.filter((c) => c.type === "channel");
    if (!activeChannelId) {
      if (channelDocs.length > 0) {
        setActiveChannelId(channelDocs[0].id);
      }
      return;
    }

    const exists = channels.some((c) => c.id === activeChannelId);
    if (!exists) {
      setActiveChannelId(channelDocs[0]?.id || "");
    }
  }, [channels, channelsLoaded, activeChannelId]);

  // 2. Listen to Messages in the Active Channel (no composite index needed)
  useEffect(() => {
    if (!activeChannelId) {
      setMessages([]);
      return;
    }

    const messagesRef = collection(db, "chat_messages");
    const q = query(messagesRef, where("channelId", "==", activeChannelId));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const fetched: ChatMessage[] = [];
        snapshot.forEach((docSnap: any) => {
          fetched.push({ ...docSnap.data(), id: docSnap.id });
        });

        fetched.sort((a, b) => (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0));
        setMessages(fetched.slice(-200));

        // Scroll to bottom on initial load or message add
        setTimeout(() => {
          scrollToBottom(isFirstLoadRef.current ? false : true);
          isFirstLoadRef.current = false;
        }, 50);
      },
      (err) => {
        console.warn("Messages snapshot note:", err);
      }
    );

    return () => unsubscribe();
  }, [activeChannelId]);

  // 3. Global listener for incoming messages to trigger audio chime & pop-up toast
  useEffect(() => {
    const messagesRef = collection(db, "chat_messages");
    const recentQuery = query(
      messagesRef,
      orderBy("createdAt", "desc"),
      limit(1)
    );

    let isInitialMount = true;

    const unsubscribe = onSnapshot(
      recentQuery,
      (snapshot) => {
        if (isInitialMount) {
          isInitialMount = false;
          return;
        }

        snapshot.forEach((docSnap: any) => {
          const msg = docSnap.data() as ChatMessage;
          if (msg.senderId !== currentUserId && Date.now() - Number(msg.createdAt) < 8000) {
            if (soundEnabled) {
              playMessageChime();
            }

            if (msg.channelId !== activeChannelId) {
              const targetChannel = channels.find((c) => c.id === msg.channelId);
              const chName = targetChannel ? targetChannel.name : msg.channelId.startsWith("dm_") ? "Direct Message" : msg.channelId;
              setIncomingToast({
                id: msg.id,
                senderName: msg.senderName,
                senderAvatar: msg.senderAvatar,
                channelName: chName,
                channelId: msg.channelId,
                text: msg.text || (msg.isDesignReview ? "🎨 Shared a design for review" : "📎 Sent an attachment")
              });

              setTimeout(() => {
                setIncomingToast((prev) => (prev?.id === msg.id ? null : prev));
              }, 6000);
            }
          }
        });
      },
      (err) => {
        console.warn("Incoming message notification listener note:", err);
      }
    );

    return () => unsubscribe();
  }, [currentUserId, activeChannelId, soundEnabled, channels]);

  // Compress large images on canvas so they always fit comfortably inside Firestore limits
  const compressImageDataUrl = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const objUrl = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(objUrl);
        const maxDim = 1400;
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width >= height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Canvas unavailable"));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        const out = canvas.toDataURL("image/jpeg", 0.82);
        resolve(out);
      };
      img.onerror = () => {
        URL.revokeObjectURL(objUrl);
        reject(new Error("Failed to read image"));
      };
      img.src = objUrl;
    });
  };

  // Handle file attachment selection (images, videos, documents)
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 15 * 1024 * 1024) {
      showChatNotice("File is too large. Please select a file smaller than 15MB.", "error");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    const isVid = file.type.startsWith("video/") || Boolean(file.name.match(/\.(mp4|webm|mov|ogg|m4v)$/i));
    const isImg = file.type.startsWith("image/");
    const sizeFormatted =
      file.size >= 1024 * 1024
        ? (file.size / (1024 * 1024)).toFixed(2) + " MB"
        : Math.max(1, Math.round(file.size / 1024)) + " KB";

    setIsUploadingAttachment(true);
    try {
      let resolvedUrl = "";

      // Try cloud storage first for videos or larger files (> 500KB)
      if (file.size > 500 * 1024 || isVid) {
        try {
          const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
          const sRef = storageRef(storage, `studio_chat/${activeChannelId || "general"}/${Date.now()}_${safeName}`);
          const uploadPromise = uploadBytes(sRef, file).then(() => getDownloadURL(sRef));
          const timeoutPromise = new Promise<string>((_, reject) =>
            setTimeout(() => reject(new Error("Storage upload timeout")), 8000)
          );
          resolvedUrl = await Promise.race([uploadPromise, timeoutPromise]);
        } catch {
          resolvedUrl = "";
        }
      }

      // Fallback for images: client-side compression so Firestore 1MB cap is never breached
      if (!resolvedUrl && isImg) {
        if (file.size > 480 * 1024) {
          resolvedUrl = await compressImageDataUrl(file);
        } else {
          resolvedUrl = await new Promise<string>((res, rej) => {
            const reader = new FileReader();
            reader.onload = () => res(reader.result as string);
            reader.onerror = rej;
            reader.readAsDataURL(file);
          });
        }
      }

      // Fallback for small non-image files (<= 650KB)
      if (!resolvedUrl && !isImg) {
        if (file.size <= 650 * 1024) {
          resolvedUrl = await new Promise<string>((res, rej) => {
            const reader = new FileReader();
            reader.onload = () => res(reader.result as string);
            reader.onerror = rej;
            reader.readAsDataURL(file);
          });
        } else {
          showChatNotice(
            "Large video/file upload requires Storage access or compression under 650KB.",
            "error"
          );
          if (fileInputRef.current) fileInputRef.current.value = "";
          return;
        }
      }

      setAttachedFile({
        url: resolvedUrl,
        name: file.name,
        type: file.type,
        size: sizeFormatted
      });

      if (isVid) {
        setIsVideoReviewTag(true);
        setIsDesignReviewTag(true);
        setDesignTitleInput(file.name.replace(/\.[^/.]+$/, ""));
      } else if (isImg) {
        setIsDesignReviewTag(true);
        setIsVideoReviewTag(false);
        setDesignTitleInput(file.name.replace(/\.[^/.]+$/, ""));
      } else {
        setIsDesignReviewTag(false);
        setIsVideoReviewTag(false);
      }
    } catch (err) {
      console.error("Attachment processing failed:", err);
      showChatNotice("Could not attach file. Please try another file.", "error");
    } finally {
      setIsUploadingAttachment(false);
    }
  };

  // Send a message
  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!activeChannelId || (!messageText.trim() && !attachedFile) || isUploadingAttachment) return;

    const textToSend = messageText.trim();
    const fileToSend = attachedFile;
    const isReview = isDesignReviewTag && Boolean(fileToSend);
    const isVid = isVideoReviewTag && Boolean(fileToSend);
    const designTitle = isReview ? designTitleInput.trim() || fileToSend?.name : undefined;

    // Reset composer state immediately
    setMessageText("");
    setAttachedFile(null);
    setIsDesignReviewTag(false);
    setIsVideoReviewTag(false);
    setDesignTitleInput("");
    if (fileInputRef.current) fileInputRef.current.value = "";

    playSendChirp();

    const newMsg: Omit<ChatMessage, "id"> = {
      channelId: activeChannelId,
      senderId: currentUserId,
      senderName: currentUserName,
      senderAvatar: currentUserAvatar,
      senderRole: userType === "admin" ? "admin" : "artist",
      text: textToSend,
      fileUrl: fileToSend?.url,
      fileName: fileToSend?.name,
      fileType: fileToSend?.type,
      fileSize: fileToSend?.size,
      isDesignReview: isReview,
      isVideoReview: isVid,
      designTitle: designTitle,
      designStatus: isReview ? "Under Review" : undefined,
      designComments: [],
      reactions: {},
      createdAt: Date.now()
    };

    try {
      await addDoc(collection(db, "chat_messages"), newMsg);

      // Update channel's last activity (ensure DM metadata persists cleanly on first message)
      const summaryText = textToSend || (isReview ? `🎨 Design: ${designTitle}` : `📎 ${fileToSend?.name}`);
      const channelUpdate: Record<string, any> = {
        id: activeChannelId,
        lastMessage: summaryText,
        lastMessageAt: Date.now(),
        lastMessageSender: currentUserName
      };

      if (activeChannelId.startsWith("dm_")) {
        const dmPeer = resolveChannelDisplayName();
        const peerId = activeChannelId
          .replace(/^dm_/, "")
          .split("_")
          .filter(Boolean)
          .find((part) => part !== currentUserId) || (activeChannelId.includes("admin-hr") ? "admin-hr" : "");
        if (peerId) {
          channelUpdate.type = "direct";
          channelUpdate.name = dmPeer.name;
          channelUpdate.memberIds = [currentUserId, peerId];
          channelUpdate.memberNames = [currentUserName, dmPeer.name];
        }
      }

      await setDoc(doc(db, "chat_channels", activeChannelId), channelUpdate, { merge: true });
    } catch (err) {
      console.error("Error sending message:", err);
      showChatNotice("Message failed to send. Check your connection.", "error");
    }
  };

  // Toggle emoji reaction
  const handleReaction = async (messageId: string, emoji: string) => {
    const targetMsg = messages.find((m) => m.id === messageId);
    if (!targetMsg) return;

    const existingReactions = targetMsg.reactions || {};
    const usersForEmoji = existingReactions[emoji] || [];
    let updatedUsers: string[];

    if (usersForEmoji.includes(currentUserName)) {
      updatedUsers = usersForEmoji.filter((u) => u !== currentUserName);
    } else {
      updatedUsers = [...usersForEmoji, currentUserName];
    }

    const updatedReactions = { ...existingReactions };
    if (updatedUsers.length === 0) {
      delete updatedReactions[emoji];
    } else {
      updatedReactions[emoji] = updatedUsers;
    }

    try {
      await updateDoc(doc(db, "chat_messages", messageId), {
        reactions: updatedReactions
      });
      playSendChirp();
    } catch (err) {
      console.error("Failed to update reaction:", err);
    }
  };

  // Toggle pinned message
  const handleTogglePin = async (msg: ChatMessage) => {
    try {
      await updateDoc(doc(db, "chat_messages", msg.id), {
        isPinned: !msg.isPinned
      });
      playSendChirp();
    } catch (err) {
      console.error("Failed to toggle pin:", err);
    }
  };

  // Update design review feedback
  const handleUpdateDesignMessage = async (updatedMessage: ChatMessage) => {
    setActiveReviewMessage(updatedMessage);
    try {
      await setDoc(doc(db, "chat_messages", updatedMessage.id), updatedMessage, { merge: true });
    } catch (err) {
      console.error("Failed to update design review message:", err);
    }
  };

  // Start / open a direct message with Studio HR / Admin (does not persist empty stub until message/call)
  const handleStartAdminDM = () => {
    const dmChannelId = `dm_${[currentUserId, "admin-hr"].sort().join("_")}`;
    setActiveChannelId(dmChannelId);
    setMobileView("chat");
    setShowNewDmModal(false);
  };

  // Start / open a direct message with an employee (only appears in sidebar once a message or call exists)
  const handleStartDM = (targetEmp: Employee) => {
    const targetEmpId = targetEmp.id || targetEmp.employeeNumber;
    const sortedIds = [currentUserId, targetEmpId].sort();
    const dmChannelId = `dm_${sortedIds.join("_")}`;

    setActiveChannelId(dmChannelId);
    setMobileView("chat");
    setShowNewDmModal(false);
  };

  // Start or join a Video Call / Audio Ring for active channel or specific teammate
  const handleInitiateCall = async (
    callType: "video" | "audio",
    overrideTarget?: { type: "admin" } | { type: "employee"; emp: Employee }
  ) => {
    if (isStartingCall) return;
    setIsStartingCall(true);
    try {
      playSendChirp();

      if (overrideTarget?.type === "admin") {
        const dmId = `dm_${[currentUserId, "admin-hr"].sort().join("_")}`;
        setActiveChannelId(dmId);
        setShowNewDmModal(false);
        await startOrJoinStudioCall({
          channelId: dmId,
          channelName: "Studio HR / Admin",
          isGroupMeeting: false,
          callType,
          callerId: currentUserId,
          callerName: currentUserName,
          callerAvatar: currentUserAvatar,
          calleeId: "admin-hr",
          calleeName: "Studio HR / Admin",
          targetIds: ["admin-hr"],
          dmMemberIds: [currentUserId, "admin-hr"],
          dmMemberNames: [currentUserName, "Studio HR / Admin"]
        });
        return;
      }

      if (overrideTarget?.type === "employee") {
        const emp = overrideTarget.emp;
        const empId = emp.id || emp.employeeNumber;
        const dmId = `dm_${[currentUserId, empId].sort().join("_")}`;
        setActiveChannelId(dmId);
        setShowNewDmModal(false);
        await startOrJoinStudioCall({
          channelId: dmId,
          channelName: emp.fullName,
          isGroupMeeting: false,
          callType,
          callerId: currentUserId,
          callerName: currentUserName,
          callerAvatar: currentUserAvatar,
          calleeId: empId,
          calleeName: emp.fullName,
          targetIds: [empId],
          dmMemberIds: [currentUserId, empId],
          dmMemberNames: [currentUserName, emp.fullName]
        });
        return;
      }

      if (!activeChannelId) return;

      if (activeChannelMeta.isDM) {
        const peer = activeChannelMeta.peerEmployee;
        const peerId =
          peer?.id ||
          peer?.employeeNumber ||
          (activeChannelId.includes("admin-hr") ? "admin-hr" : "");
        const peerName = peer?.fullName || activeChannelMeta.name;

        await startOrJoinStudioCall({
          channelId: activeChannelId,
          channelName: peerName,
          isGroupMeeting: false,
          callType,
          callerId: currentUserId,
          callerName: currentUserName,
          callerAvatar: currentUserAvatar,
          calleeId: peerId,
          calleeName: peerName,
          targetIds: peerId ? [peerId] : [],
          dmMemberIds: peerId ? [currentUserId, peerId] : undefined,
          dmMemberNames: peerId ? [currentUserName, peerName] : undefined
        });
      } else {
        await startOrJoinStudioCall({
          channelId: activeChannelId,
          channelName: activeChannelMeta.name,
          isGroupMeeting: true,
          callType,
          callerId: currentUserId,
          callerName: currentUserName,
          callerAvatar: currentUserAvatar
        });
      }
    } catch (err) {
      console.error("Failed to start call:", err);
      showChatNotice("Could not start call. Please retry.", "error");
    } finally {
      setIsStartingCall(false);
    }
  };

  // Update employee's live work status (Active, In Meeting, On Break, Focus)
  const handleSaveEmployeeStatus = async (statusValue: EmployeePresenceStatus, customNote?: string) => {
    if (userType !== "employee") return;
    const empDocId = currentUser?.id;
    const cleanNote = (customNote ?? statusNoteInput).trim();

    setLocalPresenceOverride({ status: statusValue, note: cleanNote });
    setIsSavingStatus(true);
    playSendChirp();

    try {
      if (empDocId) {
        await updateDoc(doc(db, "employees", empDocId), {
          presenceStatus: statusValue,
          presenceNote: cleanNote,
          presenceUpdatedAt: Date.now()
        });
      }
      setShowStatusModal(false);
    } catch (err) {
      console.error("Failed to update status:", err);
      showChatNotice("Could not save status update.", "error");
    } finally {
      setIsSavingStatus(false);
    }
  };

  // Helper to slugify channel names cleanly
  const formatChannelSlug = (raw: string) =>
    raw
      .toLowerCase()
      .trim()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9_-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");

  // Create a new team channel/group
  const handleCreateChannel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newChannelName.trim()) return;

    const formattedName = formatChannelSlug(newChannelName) || `channel-${Date.now().toString(36)}`;
    if (channels.some((c) => c.type === "channel" && c.name.toLowerCase() === formattedName)) {
      showChatNotice(`Channel #${formattedName} already exists.`, "error");
      return;
    }

    const docId = channels.some((c) => c.id === formattedName)
      ? `${formattedName}-${Date.now().toString(36)}`
      : formattedName;

    const channelPayload: ChatChannel = {
      id: docId,
      name: formattedName,
      description: newChannelDesc.trim() || `Team group for #${formattedName}`,
      type: "channel",
      createdBy: currentUserId,
      createdAt: Date.now()
    };

    try {
      await setDoc(doc(db, "chat_channels", docId), channelPayload);
      await setDoc(doc(db, "settings", "chat_config"), { defaultsSeeded: true }, { merge: true }).catch(() => {});
      setActiveChannelId(docId);
      setMobileView("chat");
      setShowCreateChannelModal(false);
      setNewChannelName("");
      setNewChannelDesc("");
      playSendChirp();
    } catch (err) {
      console.error("Failed to create channel:", err);
      showChatNotice("Could not create group channel. Please try again.", "error");
    }
  };

  // Admin: Open Rename / Edit Channel modal
  const openEditChannelModal = (channel: ChatChannel) => {
    if (userType !== "admin" || channel.type !== "channel") return;
    setEditingChannel(channel);
    setEditChannelName(channel.name);
    setEditChannelDesc(channel.description || "");
    setEditChannelError("");
  };

  // Admin: Rename / Edit a channel (keeps document ID immutable so message history stays intact)
  const handleRenameChannel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (userType !== "admin" || !editingChannel) return;

    const formattedName = formatChannelSlug(editChannelName);
    if (!formattedName) {
      setEditChannelError("Please enter a valid channel name.");
      return;
    }

    const duplicate = channels.some(
      (c) => c.id !== editingChannel.id && c.type === "channel" && c.name.toLowerCase() === formattedName
    );
    if (duplicate) {
      setEditChannelError(`Channel #${formattedName} already exists.`);
      return;
    }

    setIsSavingChannelEdit(true);
    setEditChannelError("");
    try {
      const updatedDesc = editChannelDesc.trim() || `Team group for #${formattedName}`;
      await updateDoc(doc(db, "chat_channels", editingChannel.id), {
        name: formattedName,
        description: updatedDesc
      });
      setChannels((prev) =>
        prev.map((c) => (c.id === editingChannel.id ? { ...c, name: formattedName, description: updatedDesc } : c))
      );
      setEditingChannel(null);
      setEditChannelName("");
      setEditChannelDesc("");
      playSendChirp();
      showChatNotice(`Channel renamed to #${formattedName}.`, "info");
    } catch (err) {
      console.error("Failed to rename channel:", err);
      setEditChannelError("Could not rename channel. Please try again.");
    } finally {
      setIsSavingChannelEdit(false);
    }
  };

  // Admin: Confirm Delete a channel
  const handleConfirmDeleteChannel = async () => {
    if (userType !== "admin" || !deletingChannel || isDeletingChannel) return;
    const target = deletingChannel;
    setIsDeletingChannel(true);
    try {
      await setDoc(doc(db, "settings", "chat_config"), { defaultsSeeded: true }, { merge: true }).catch(() => {});
      await deleteDoc(doc(db, "chat_channels", target.id));

      const remainingChannels = channels.filter((c) => c.id !== target.id);
      setChannels(remainingChannels);

      if (activeChannelId === target.id) {
        const nextGroup = remainingChannels.find((c) => c.type === "channel");
        setActiveChannelId(nextGroup?.id || "");
        setMobileView("channels");
      }

      setDeletingChannel(null);
      playSendChirp();
      showChatNotice(`Deleted #${target.name}.`, "info");
    } catch (err) {
      console.error("Failed to delete channel:", err);
      showChatNotice("Could not delete channel. Please try again.", "error");
    } finally {
      setIsDeletingChannel(false);
    }
  };

  // Delete a single message (sender or Admin)
  const handleConfirmDeleteMessage = async () => {
    if (!deletingMessage || isDeletingMessage) return;
    if (userType !== "admin" && deletingMessage.senderId !== currentUserId) return;

    const target = deletingMessage;
    const channelId = target.channelId || activeChannelId;
    setIsDeletingMessage(true);

    try {
      await deleteDoc(doc(db, "chat_messages", target.id));

      const remaining = messages.filter((m) => m.id !== target.id);
      setMessages(remaining);
      if (activeReviewMessage?.id === target.id) {
        setActiveReviewMessage(null);
      }

      if (channelId) {
        if (remaining.length === 0) {
          await updateDoc(doc(db, "chat_channels", channelId), {
            lastMessage: "",
            lastMessageAt: 0,
            lastMessageSender: ""
          }).catch(() => {});
        } else {
          const latest = remaining[remaining.length - 1];
          const summaryText =
            latest.text ||
            (latest.isDesignReview
              ? `🎨 Design: ${latest.designTitle || latest.fileName}`
              : `📎 ${latest.fileName || "Attachment"}`);
          await updateDoc(doc(db, "chat_channels", channelId), {
            lastMessage: summaryText,
            lastMessageAt: latest.createdAt,
            lastMessageSender: latest.senderName
          }).catch(() => {});
        }
      }

      setDeletingMessage(null);
      playSendChirp();
      showChatNotice("Message deleted.", "info");
    } catch (err) {
      console.error("Failed to delete message:", err);
      showChatNotice("Could not delete message. Please try again.", "error");
    } finally {
      setIsDeletingMessage(false);
    }
  };

  // Delete all messages (or all of current user's messages in public studio channels)
  const handleConfirmClearMessages = async (mode: "all" | "mine") => {
    if (!activeChannelId || isClearingMessages) return;
    const canDeleteAllInChannel = userType === "admin" || activeChannelMeta.isDM;
    const effectiveMode = mode === "all" && canDeleteAllInChannel ? "all" : "mine";

    setIsClearingMessages(true);
    try {
      const msgSnap = await getDocs(
        query(collection(db, "chat_messages"), where("channelId", "==", activeChannelId))
      );

      const allChannelMsgs: Array<{ id: string; data: ChatMessage }> = [];
      msgSnap.forEach((docSnap: any) => {
        allChannelMsgs.push({ id: docSnap.id, data: docSnap.data() as ChatMessage });
      });

      const targetsToDelete =
        effectiveMode === "all"
          ? allChannelMsgs
          : allChannelMsgs.filter((item) => item.data?.senderId === currentUserId);

      // Delete in clean chunks so all records stay synchronized
      for (let i = 0; i < targetsToDelete.length; i += 10) {
        const chunk = targetsToDelete.slice(i, i + 10);
        await Promise.all(chunk.map((item) => deleteDoc(doc(db, "chat_messages", item.id))));
      }

      const deletedIds = new Set(targetsToDelete.map((t) => t.id));
      const remaining = messages.filter((m) => !deletedIds.has(m.id));
      setMessages(remaining);

      if (activeReviewMessage && deletedIds.has(activeReviewMessage.id)) {
        setActiveReviewMessage(null);
      }

      const remainingServer = allChannelMsgs
        .filter((item) => !deletedIds.has(item.id))
        .sort((a, b) => (Number(a.data?.createdAt) || 0) - (Number(b.data?.createdAt) || 0));

      if (remainingServer.length === 0) {
        await updateDoc(doc(db, "chat_channels", activeChannelId), {
          lastMessage: "",
          lastMessageAt: 0,
          lastMessageSender: ""
        }).catch(() => {});
      } else {
        const latest = remainingServer[remainingServer.length - 1].data;
        const summaryText =
          latest.text ||
          (latest.isDesignReview
            ? `🎨 Design: ${latest.designTitle || latest.fileName}`
            : `📎 ${latest.fileName || "Attachment"}`);
        await updateDoc(doc(db, "chat_channels", activeChannelId), {
          lastMessage: summaryText,
          lastMessageAt: latest.createdAt,
          lastMessageSender: latest.senderName
        }).catch(() => {});
      }

      setShowClearMessagesModal(false);
      playSendChirp();
      showChatNotice(
        effectiveMode === "all"
          ? `Deleted all ${targetsToDelete.length} message${targetsToDelete.length === 1 ? "" : "s"}.`
          : `Deleted ${targetsToDelete.length} of your message${targetsToDelete.length === 1 ? "" : "s"}.`,
        "info"
      );
    } catch (err) {
      console.error("Failed to clear messages:", err);
      showChatNotice("Could not delete messages. Please try again.", "error");
    } finally {
      setIsClearingMessages(false);
    }
  };

  // Determine if an attendance record means the employee is currently clocked in (Active / Green)
  const isAttendanceClockedIn = (att?: Partial<Attendance> | null): boolean => {
    if (!att) return false;
    const hasTimeIn = Boolean(att.timeIn && String(att.timeIn).trim());
    const hasTimeOut = Boolean(att.timeOut && String(att.timeOut).trim());
    const status = String(att.status || "");
    if (!hasTimeIn || hasTimeOut) return false;
    if (["Timed Out", "Absent", "Paid Leave", "Birthday Leave", "Absent Notice", "No Work"].includes(status)) {
      return false;
    }
    return true;
  };

  const getEmployeeShiftAttendance = (emp?: Partial<Employee> | null): Partial<Attendance> | null => {
    if (!emp) return null;
    const empId = emp.id || "";
    const empNum = emp.employeeNumber || "";

    if (userType === "employee" && (empId === currentUserId || empNum === currentUserId)) {
      if (todayAttendance) return todayAttendance;
    }

    return (
      shiftAttendanceRecords.find(
        (att) =>
          (empId && (att.employeeId === empId || att.id?.startsWith(`${empId}_`))) ||
          (empNum && att.employeeNumber === empNum)
      ) || null
    );
  };

  const isEmployeeClockedIn = (emp?: Partial<Employee> | null): boolean => {
    return isAttendanceClockedIn(getEmployeeShiftAttendance(emp));
  };

  const isCurrentUserClockedIn =
    userType === "admin" ? true : isAttendanceClockedIn(todayAttendance || getEmployeeShiftAttendance(currentUser));

  // Track which users are currently in an active video/audio call
  const activeCallParticipantIds = new Set<string>();
  liveCalls.forEach((c) => {
    if (c.status === "active" || (c.participants?.length || 0) > 1) {
      (c.participants || []).forEach((pid) => activeCallParticipantIds.add(pid));
    }
  });

  const getEmployeePresenceDisplay = (
    emp?: Partial<Employee> | null,
    override?: { status: EmployeePresenceStatus; note?: string } | null
  ): {
    key: EmployeePresenceStatus | "offline";
    label: string;
    dotClass: string;
    pillClass: string;
    note?: string;
    isOnline: boolean;
  } => {
    const empId = emp?.id || emp?.employeeNumber || "";
    const att = getEmployeeShiftAttendance(emp);
    const clockedIn = isAttendanceClockedIn(att);
    const inCall = Boolean(empId && activeCallParticipantIds.has(empId));

    if (!clockedIn && !inCall) {
      return {
        key: "offline",
        label: "Off Duty",
        dotClass: "bg-slate-600",
        pillClass: "bg-slate-800 text-slate-400 border-white/10",
        isOnline: false
      };
    }

    const attStatus = String(att?.status || "");
    const rawPref: EmployeePresenceStatus =
      override?.status ||
      (inCall
        ? "meeting"
        : attStatus === "On Break" || Boolean(att?.currentBreakStart)
        ? "break"
        : emp?.presenceStatus || "active");

    const note = (override ? override.note : emp?.presenceNote) || "";

    switch (rawPref) {
      case "meeting":
        return {
          key: "meeting",
          label: "In Meeting",
          dotClass: "bg-violet-500 shadow-[0_0_6px_rgba(139,92,246,0.9)]",
          pillClass: "bg-violet-500/15 text-violet-300 border-violet-500/30",
          note,
          isOnline: true
        };
      case "break":
        return {
          key: "break",
          label: "On Break",
          dotClass: "bg-amber-500 shadow-[0_0_6px_rgba(245,158,11,0.9)]",
          pillClass: "bg-amber-500/15 text-amber-300 border-amber-500/30",
          note,
          isOnline: true
        };
      case "focus":
        return {
          key: "focus",
          label: "Focus",
          dotClass: "bg-sky-500 shadow-[0_0_6px_rgba(14,165,233,0.9)]",
          pillClass: "bg-sky-500/15 text-sky-300 border-sky-500/30",
          note,
          isOnline: true
        };
      default:
        return {
          key: "active",
          label: "Active",
          dotClass: "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.9)]",
          pillClass: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
          note,
          isOnline: true
        };
    }
  };

  const liveSelfProfile =
    userType === "employee"
      ? employees.find((e) => (e.id || e.employeeNumber) === currentUserId) || currentUser
      : currentUser;
  const selfPresence =
    userType === "admin"
      ? {
          key: "active" as const,
          label: "Active",
          dotClass: "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.9)]",
          pillClass: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
          note: "",
          isOnline: true
        }
      : getEmployeePresenceDisplay(liveSelfProfile, localPresenceOverride);

  // Clear local optimistic override once Firestore employee snapshot catches up
  useEffect(() => {
    if (localPresenceOverride && liveSelfProfile?.presenceStatus === localPresenceOverride.status) {
      setLocalPresenceOverride(null);
    }
  }, [liveSelfProfile?.presenceStatus, localPresenceOverride]);

  // Resolve clean display name for active channel (handles DM peer naming smoothly)
  const rawActiveChannel = channels.find((c) => c.id === activeChannelId);
  const resolveChannelDisplayName = (): { name: string; desc: string; isDM: boolean; peerEmployee?: Employee } => {
    if (!activeChannelId) {
      return {
        name: "No Channel Selected",
        desc: "Select a channel or teammate, or create a new channel",
        isDM: false
      };
    }

    if (activeChannelId.startsWith("dm_") || rawActiveChannel?.type === "direct") {
      const otherEmp = employees.find(
        (e) =>
          (e.id && activeChannelId.includes(e.id)) ||
          (e.employeeNumber && activeChannelId.includes(e.employeeNumber))
      );

      if (otherEmp) {
        return {
          name: otherEmp.fullName,
          desc: `#${otherEmp.employeeNumber} • ${otherEmp.position || "Artist"}`,
          isDM: true,
          peerEmployee: otherEmp
        };
      }
      if (activeChannelId.includes("admin-hr") && userType === "employee") {
        return { name: "Studio HR / Admin", desc: "Management Support", isDM: true };
      }
      if (rawActiveChannel?.memberIds && rawActiveChannel?.memberNames) {
        const otherIdx = rawActiveChannel.memberIds.findIndex((id) => id !== currentUserId);
        if (otherIdx !== -1 && rawActiveChannel.memberNames[otherIdx]) {
          return {
            name: rawActiveChannel.memberNames[otherIdx],
            desc: rawActiveChannel.description || "Direct Message",
            isDM: true,
            peerEmployee: otherEmp
          };
        }
      }
      return {
        name: rawActiveChannel?.name || "Direct Message",
        desc: rawActiveChannel?.description || "Private Conversation",
        isDM: true
      };
    }

    return {
      name: rawActiveChannel?.name || activeChannelId,
      desc: rawActiveChannel?.description || "Active workplace chat",
      isDM: false
    };
  };

  const activeChannelMeta = resolveChannelDisplayName();
  const activeDmPeerPresence = activeChannelMeta.peerEmployee
    ? getEmployeePresenceDisplay(activeChannelMeta.peerEmployee)
    : null;
  const activeChannelLiveCall = activeChannelId
    ? liveCalls.find((c) => c.channelId === activeChannelId) || null
    : null;

  const filteredChannels = channels.filter((c) => {
    if (channelFilter === "channels" && c.type !== "channel") return false;
    if (channelFilter === "direct" && c.type !== "direct") return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        c.name.toLowerCase().includes(q) ||
        (c.description && c.description.toLowerCase().includes(q))
      );
    }
    return true;
  });

  const pinnedMessages = messages.filter((m) => m.isPinned);

  // Full-screen dynamic Messenger positioning on mobile (< 768px)
  const useMobileFullScreenShell = mobileFullScreen && isMobileViewport;
  const mobileShellStyle: React.CSSProperties | undefined = useMobileFullScreenShell
    ? {
        top: `${viewportBox?.top ?? 0}px`,
        height: `${
          effectiveKeyboardOpen
            ? Math.max(260, viewportBox?.height ?? window.innerHeight)
            : Math.max(320, (viewportBox?.height ?? window.innerHeight) - 78)
        }px`
      }
    : undefined;

  return (
    <div
      style={mobileShellStyle}
      className={
        useMobileFullScreenShell
          ? "fixed inset-x-0 z-30 flex flex-col bg-slate-900 overflow-hidden text-slate-100 font-sans"
          : "w-full h-[calc(100dvh-180px)] md:h-[calc(100vh-150px)] min-h-[460px] md:min-h-[580px] flex flex-col bg-slate-900 border border-white/10 rounded-2xl sm:rounded-3xl shadow-2xl overflow-hidden relative text-slate-100 font-sans"
      }
    >
      {/* Top Banner / Breadcrumb (Full-Width Mobile Messenger Header) */}
      <header className="px-2.5 sm:px-6 py-2 sm:py-3 border-b border-white/10 bg-slate-950/95 backdrop-blur-xl flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {/* Mobile Pane Switcher: Back to Channels List OR Back to Active Chat */}
          {mobileView === "chat" ? (
            <button
              type="button"
              onClick={() => setMobileView("channels")}
              className="md:hidden min-h-[38px] px-2 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-white/10 text-slate-200 flex items-center gap-0.5 text-[11px] font-bold shrink-0 cursor-pointer whitespace-nowrap"
              title="All Channels & Direct Messages"
            >
              <ChevronLeft className="w-4 h-4 shrink-0" />
              <span>Chats</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setMobileView("chat")}
              className="md:hidden min-h-[38px] px-2.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white flex items-center gap-1 text-[11px] font-bold shrink-0 cursor-pointer whitespace-nowrap"
              title="Return to Conversation"
            >
              <MessageSquare className="w-3.5 h-3.5 shrink-0" />
              <span>Chat</span>
            </button>
          )}

          <div className="hidden sm:flex w-10 h-10 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 items-center justify-center shrink-0 shadow-inner">
            <MessageSquare className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            {mobileView === "channels" ? (
              <div className="md:hidden min-w-0">
                <h2 className="text-sm font-black text-white tracking-tight truncate">
                  Studio Channels & DMs
                </h2>
                <p className="text-[11px] text-slate-400 truncate">
                  Tap a channel or teammate to message
                </p>
              </div>
            ) : null}
            <div className={`${mobileView === "channels" ? "hidden md:block" : "block"} min-w-0`}>
              <div className="flex items-center gap-1 sm:gap-1.5 min-w-0">
                {activeChannelId && (
                  <span className="text-indigo-400 font-mono text-sm sm:text-base shrink-0">
                    {activeChannelMeta.isDM ? "@" : "#"}
                  </span>
                )}
                <h2 className="text-sm sm:text-lg font-black text-white tracking-tight truncate">
                  {activeChannelMeta.name}
                </h2>
                {!activeChannelMeta.isDM && activeChannelId && (
                  <span className="hidden lg:inline-flex px-2 py-0.5 rounded-full bg-slate-800 border border-white/5 text-[10px] font-mono text-slate-400 uppercase shrink-0">
                    Studio Channel
                  </span>
                )}
                {activeChannelMeta.isDM && activeDmPeerPresence && (
                  <span
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold shrink-0 border ${activeDmPeerPresence.pillClass}`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${activeDmPeerPresence.dotClass}`} />
                    <span>{activeDmPeerPresence.label}</span>
                  </span>
                )}
              </div>
              <p className="text-[11px] sm:text-xs text-slate-400 truncate max-w-md">
                {activeChannelMeta.desc}
              </p>
            </div>
          </div>
        </div>

        {/* Right Header Controls */}
        <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
          {/* Employee Quick Status Pill on Mobile Channels List */}
          {userType === "employee" && mobileView === "channels" && (
            <button
              type="button"
              onClick={() => {
                setStatusNoteInput(selfPresence.note || "");
                setShowStatusModal(true);
              }}
              className={`md:hidden min-h-[34px] sm:min-h-[38px] px-2.5 py-1.5 rounded-xl border text-[11px] font-mono font-bold flex items-center gap-1.5 cursor-pointer shrink-0 ${selfPresence.pillClass}`}
              title="Set your work status (Active, In Meeting, Break, Focus)"
            >
              <span className={`w-2 h-2 rounded-full ${selfPresence.dotClass}`} />
              <span>{selfPresence.label}</span>
            </button>
          )}

          {/* Call / Ring Controls for Active Channel or DM */}
          {activeChannelId && (
            <div className={`${mobileView === "channels" ? "hidden md:flex" : "flex"} items-center gap-1 shrink-0`}>
              {activeChannelMeta.isDM && (
                <button
                  type="button"
                  disabled={isStartingCall}
                  onClick={() => handleInitiateCall("audio")}
                  className="min-h-[34px] min-w-[34px] sm:min-h-[38px] sm:min-w-[38px] flex items-center justify-center p-1.5 sm:p-2 rounded-xl bg-slate-800 hover:bg-emerald-600/20 text-emerald-400 border border-white/10 hover:border-emerald-500/40 transition-colors cursor-pointer disabled:opacity-50"
                  title="Audio Ring"
                  aria-label="Audio Ring"
                >
                  <PhoneCall className="w-4 h-4" />
                </button>
              )}
              <button
                type="button"
                disabled={isStartingCall}
                onClick={() => handleInitiateCall("video")}
                className={`min-h-[34px] min-w-[34px] sm:min-h-[38px] flex items-center justify-center gap-1.5 p-1.5 sm:px-2.5 sm:py-1.5 rounded-xl border text-xs font-bold transition-colors cursor-pointer disabled:opacity-50 ${
                  activeChannelLiveCall
                    ? "bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-400 animate-pulse"
                    : "bg-slate-800 hover:bg-emerald-600/20 text-emerald-400 border-white/10 hover:border-emerald-500/40"
                }`}
                title={
                  activeChannelLiveCall
                    ? "Join Live Call"
                    : activeChannelMeta.isDM
                    ? "Start Video Call"
                    : "Start Group Meeting / Ring"
                }
                aria-label="Video Call"
              >
                <Video className="w-4 h-4 shrink-0" />
                <span className="hidden lg:inline">
                  {activeChannelLiveCall ? "Join Call" : activeChannelMeta.isDM ? "Call" : "Meet"}
                </span>
              </button>
            </div>
          )}

          {/* Clear All Messages button for active channel or DM */}
          {activeChannelId &&
            messages.length > 0 &&
            (userType === "admin" ||
              activeChannelMeta.isDM ||
              messages.some((m) => m.senderId === currentUserId)) && (
              <div className={`${mobileView === "channels" ? "hidden md:flex" : "flex"} items-center shrink-0`}>
                <button
                  type="button"
                  onClick={() => setShowClearMessagesModal(true)}
                  className="min-h-[34px] min-w-[34px] sm:min-h-[38px] sm:min-w-[38px] flex items-center justify-center gap-1 p-1.5 sm:px-2.5 sm:py-1.5 rounded-xl bg-slate-800 hover:bg-rose-600/20 text-slate-300 hover:text-rose-400 border border-white/10 hover:border-rose-500/30 text-xs font-bold transition-colors cursor-pointer"
                  title={
                    userType === "admin" || activeChannelMeta.isDM
                      ? "Delete All Messages"
                      : "Delete My Messages"
                  }
                  aria-label="Delete All Messages"
                >
                  <Eraser className="w-4 h-4 shrink-0" />
                  <span className="hidden lg:inline">Clear</span>
                </button>
              </div>
            )}

          {/* Admin-only quick Rename & Delete for active channel */}
          {userType === "admin" && !activeChannelMeta.isDM && rawActiveChannel && (
            <div className={`${mobileView === "channels" ? "hidden md:flex" : "flex"} items-center gap-1 shrink-0`}>
              <button
                type="button"
                onClick={() => openEditChannelModal(rawActiveChannel)}
                className="min-h-[34px] min-w-[34px] sm:min-h-[38px] sm:min-w-[38px] flex items-center justify-center p-1.5 sm:p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-white/10 transition-colors cursor-pointer"
                title={`Rename #${rawActiveChannel.name}`}
                aria-label={`Rename #${rawActiveChannel.name}`}
              >
                <Pencil className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setDeletingChannel(rawActiveChannel)}
                className="min-h-[34px] min-w-[34px] sm:min-h-[38px] sm:min-w-[38px] flex items-center justify-center p-1.5 sm:p-2 rounded-xl bg-slate-800 hover:bg-rose-600/20 text-slate-300 hover:text-rose-400 border border-white/10 hover:border-rose-500/30 transition-colors cursor-pointer"
                title={`Delete #${rawActiveChannel.name}`}
                aria-label={`Delete #${rawActiveChannel.name}`}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Sound Mute/Unmute Toggler */}
          <button
            type="button"
            onClick={() => setSoundEnabled(!soundEnabled)}
            className={`min-h-[34px] min-w-[34px] sm:min-h-[38px] sm:min-w-[38px] flex items-center justify-center p-1.5 sm:p-2 rounded-xl border transition-colors cursor-pointer ${
              soundEnabled
                ? "bg-slate-800 text-slate-200 border-white/10 hover:bg-slate-700"
                : "bg-rose-500/10 text-rose-400 border-rose-500/20 hover:bg-rose-500/20"
            }`}
            title={soundEnabled ? "Mute Message Chime" : "Enable Message Chime"}
          >
            {soundEnabled ? <Bell className="w-4 h-4" /> : <BellOff className="w-4 h-4" />}
          </button>

          {/* Quick Design Showcase Filter (Compact icon on <sm so title never truncates) */}
          <button
            type="button"
            onClick={() => {
              setChannelFilter(channelFilter === "designs" ? "all" : "designs");
              setMobileView("chat");
            }}
            className={`min-h-[34px] min-w-[34px] sm:min-h-[38px] sm:min-w-[38px] flex items-center justify-center gap-1.5 p-1.5 sm:px-3 sm:py-1.5 rounded-xl border text-xs font-bold font-mono transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              channelFilter === "designs"
                ? "bg-amber-500 text-slate-950 border-amber-400 font-black shadow-md"
                : "bg-slate-800 text-slate-300 border-white/10 hover:text-white"
            }`}
            title="Filter Design Reviews"
          >
            <Palette className="w-4 h-4 shrink-0" />
            <span className="hidden sm:inline">Design Feed</span>
          </button>
        </div>
      </header>

      {/* QUICK PUNCH & TIMECARD CONTROLS (Compact single strip on Mobile, hidden when keyboard open to maximize message room) */}
      {userType === "employee" && !effectiveKeyboardOpen && (
        <div className="px-3 sm:px-4 py-1.5 sm:py-2 bg-slate-950/90 border-b border-indigo-500/20 flex items-center justify-between gap-2 text-xs shrink-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="p-1 rounded-lg bg-indigo-500/20 text-indigo-300 shrink-0 hidden sm:inline-flex">
              <Clock className="w-3.5 h-3.5" />
            </span>
            <span className="hidden sm:inline text-slate-400 font-mono text-[11px] shrink-0">SHIFT:</span>
            {todayAttendance?.timeIn ? (
              todayAttendance?.timeOut ? (
                <span className="px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-mono font-bold text-[10px] uppercase whitespace-nowrap truncate">
                  Done ({todayAttendance.timeOut})
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-mono font-bold text-[10px] uppercase flex items-center gap-1.5 whitespace-nowrap">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                  <span>In: {todayAttendance.timeIn}</span>
                </span>
              )
            ) : (
              <span className="px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30 font-mono font-bold text-[10px] uppercase whitespace-nowrap">
                Off Duty
              </span>
            )}
          </div>

          {/* Action Buttons: Time In, Time Out, Switch to Kiosk */}
          <div className="flex items-center gap-1.5 shrink-0">
            {!todayAttendance?.timeIn && onTimeIn && (
              <button
                type="button"
                onClick={onTimeIn}
                className="min-h-[34px] px-2.5 sm:px-3 py-1 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-mono font-bold text-[11px] sm:text-xs shadow-md transition-all cursor-pointer flex items-center gap-1 whitespace-nowrap shrink-0"
              >
                <span>Time In</span>
              </button>
            )}

            {todayAttendance?.timeIn && !todayAttendance?.timeOut && onTimeOut && (
              <button
                type="button"
                onClick={onTimeOut}
                className="min-h-[34px] px-2.5 sm:px-3 py-1 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-mono font-bold text-[11px] sm:text-xs shadow-md transition-all cursor-pointer flex items-center gap-1 whitespace-nowrap shrink-0"
              >
                <span>Time Out</span>
              </button>
            )}

            {onSwitchTab && (
              <button
                type="button"
                onClick={() => onSwitchTab("timetracking")}
                className="min-h-[34px] px-2.5 py-1 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white font-mono text-[11px] transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                Timecard →
              </button>
            )}
          </div>
        </div>
      )}

      {/* Inline non-blocking chat error/info banner */}
      {chatNotice && (
        <div
          className={`px-3 py-2 text-xs font-mono flex items-center justify-between gap-2 shrink-0 ${
            chatNotice.type === "error"
              ? "bg-rose-950/90 text-rose-200 border-b border-rose-500/40"
              : "bg-indigo-950/90 text-indigo-200 border-b border-indigo-500/40"
          }`}
        >
          <span className="truncate">{chatNotice.text}</span>
          <button
            type="button"
            onClick={() => setChatNotice(null)}
            className="text-slate-300 hover:text-white cursor-pointer shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Main Workspace Body: Slack-Responsive Sidebar (Full-Screen on Mobile List) + Message Stream */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Left Column: Channels, Groups & Direct Messages */}
        <aside className={`${mobileView === "channels" ? "flex w-full" : "hidden"} md:flex md:w-72 border-r border-white/10 bg-slate-950/60 flex-col shrink-0 min-h-0`}>
          {/* Channel Search & Filter */}
          <div className="p-3 border-b border-white/10 space-y-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-500 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Find channels or artists..."
                className="w-full pl-8 pr-3 py-1.5 rounded-xl bg-slate-900 border border-white/10 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            {/* Pill Filters */}
            <div className="flex items-center gap-1 text-[11px] font-mono">
              <button
                type="button"
                onClick={() => setChannelFilter("all")}
                className={`flex-1 py-1 rounded-lg text-center font-bold transition-colors cursor-pointer ${
                  channelFilter === "all" ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-white"
                }`}
              >
                All
              </button>
              <button
                type="button"
                onClick={() => setChannelFilter("channels")}
                className={`flex-1 py-1 rounded-lg text-center font-bold transition-colors cursor-pointer ${
                  channelFilter === "channels" ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-white"
                }`}
              >
                Groups
              </button>
              <button
                type="button"
                onClick={() => setChannelFilter("direct")}
                className={`flex-1 py-1 rounded-lg text-center font-bold transition-colors cursor-pointer ${
                  channelFilter === "direct" ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-white"
                }`}
              >
                DMs
              </button>
            </div>
          </div>

          {/* List of Channels & DMs */}
          <div className="flex-1 overflow-y-auto p-2 space-y-4 min-h-0">
            {/* Channels & Team Groups */}
            {(channelFilter === "all" || channelFilter === "channels") && (
              <div className="space-y-1">
                <div className="px-2 py-1 flex items-center justify-between text-[11px] font-mono font-bold text-slate-400 uppercase tracking-wider">
                  <span className="flex items-center gap-1.5">
                    <Layers className="w-3 h-3 text-indigo-400" /> Channels & Groups
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowCreateChannelModal(true)}
                    className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white cursor-pointer"
                    title="Create Group Channel"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>

                {filteredChannels
                  .filter((c) => c.type === "channel")
                  .map((ch) => {
                    const isActive = activeChannelId === ch.id;
                    return (
                      <div
                        key={ch.id}
                        className={`w-full min-h-[44px] rounded-xl flex items-center justify-between transition-colors group ${
                          isActive
                            ? "bg-indigo-600 text-white font-bold shadow-md"
                            : "text-slate-300 hover:bg-slate-800/80 hover:text-white"
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setActiveChannelId(ch.id);
                            setMobileView("chat");
                          }}
                          className="flex-1 min-w-0 min-h-[44px] px-3 py-2 text-left flex items-center gap-2 cursor-pointer"
                        >
                          <Hash
                            className={`w-4 h-4 shrink-0 ${
                              isActive ? "text-white" : "text-slate-400 group-hover:text-indigo-400"
                            }`}
                          />
                          <span className="text-xs sm:text-sm truncate">{ch.name}</span>
                        </button>

                        <div className="flex items-center gap-0.5 pr-1.5 shrink-0">
                          {ch.name === "design-critique" && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-bold shrink-0">
                              🎨
                            </span>
                          )}
                          {userType === "admin" && (
                            <>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openEditChannelModal(ch);
                                }}
                                className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors cursor-pointer ${
                                  isActive
                                    ? "text-white/80 hover:text-white hover:bg-white/15"
                                    : "text-slate-400 hover:text-white hover:bg-slate-700/80 md:opacity-0 md:group-hover:opacity-100 focus:opacity-100"
                                }`}
                                title={`Rename #${ch.name}`}
                                aria-label={`Rename #${ch.name}`}
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDeletingChannel(ch);
                                }}
                                className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors cursor-pointer ${
                                  isActive
                                    ? "text-white/80 hover:text-rose-200 hover:bg-rose-500/30"
                                    : "text-slate-400 hover:text-rose-400 hover:bg-rose-500/15 md:opacity-0 md:group-hover:opacity-100 focus:opacity-100"
                                }`}
                                title={`Delete #${ch.name}`}
                                aria-label={`Delete #${ch.name}`}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}

                {filteredChannels.filter((c) => c.type === "channel").length === 0 && (
                  <p className="px-3 py-2 text-[11px] text-slate-500 italic">
                    No channels found. Tap + to create one.
                  </p>
                )}
              </div>
            )}

            {/* Direct Messages (ONLY shows teammates you have messaged or currently opened DM with) */}
            {(channelFilter === "all" || channelFilter === "direct") && (() => {
              const queryLower = searchQuery.trim().toLowerCase();

              // Existing DM threads belonging to currentUser that actually have messages (or are currently selected)
              const activeDmChannels = channels.filter((c) => {
                if (c.type !== "direct") return false;
                const isMember =
                  (c.memberIds && c.memberIds.includes(currentUserId)) ||
                  c.id.includes(currentUserId);
                if (!isMember) return false;
                const hasHistory = Boolean(c.lastMessageAt) || Boolean(c.lastMessage);
                return hasHistory || c.id === activeChannelId;
              });

              const dmEntries = activeDmChannels
                .map((c) => {
                  const matchedEmp = employees.find(
                    (e) =>
                      (e.id && (c.memberIds?.includes(e.id) || c.id.includes(e.id)) && e.id !== currentUserId) ||
                      (e.employeeNumber && c.id.includes(e.employeeNumber) && e.employeeNumber !== currentUserId)
                  );
                  const isAdminPeer = c.id.includes("admin-hr") && userType === "employee";
                  const otherIdx = c.memberIds ? c.memberIds.findIndex((id) => id !== currentUserId) : -1;
                  const displayName =
                    matchedEmp?.fullName ||
                    (isAdminPeer ? "Studio HR / Admin" : "") ||
                    (otherIdx !== -1 && c.memberNames?.[otherIdx]) ||
                    c.name;

                  return {
                    channel: c,
                    emp: matchedEmp,
                    isAdminPeer,
                    displayName
                  };
                })
                .filter((entry) => {
                  if (!queryLower) return true;
                  return (
                    entry.displayName.toLowerCase().includes(queryLower) ||
                    (entry.channel.lastMessage && entry.channel.lastMessage.toLowerCase().includes(queryLower))
                  );
                });

              // When searching, also show matching teammates who don't have a DM thread yet
              const existingPeerIds = new Set(dmEntries.map((d) => d.emp?.id || d.emp?.employeeNumber).filter(Boolean));
              const searchMatchNewEmployees = queryLower
                ? employees.filter((e) => {
                    const empId = e.id || e.employeeNumber;
                    if (empId === currentUserId || existingPeerIds.has(empId)) return false;
                    return (
                      e.fullName.toLowerCase().includes(queryLower) ||
                      e.employeeNumber.toLowerCase().includes(queryLower) ||
                      (e.position && e.position.toLowerCase().includes(queryLower))
                    );
                  })
                : [];

              return (
              <div className="space-y-1">
                <div className="px-2 py-1 flex items-center justify-between text-[11px] font-mono font-bold text-slate-400 uppercase tracking-wider">
                  <span className="flex items-center gap-1.5">
                    <Users className="w-3 h-3 text-emerald-400" /> Direct Messages
                  </span>
                  <div className="flex items-center gap-1">
                    {dmEntries.length > 0 && (
                      <span className="text-[10px] text-slate-500 mr-0.5">{dmEntries.length}</span>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setDmPickerSearch("");
                        setShowNewDmModal(true);
                      }}
                      className="p-1 rounded hover:bg-slate-800 text-slate-300 hover:text-white cursor-pointer"
                      title="Message or Call Teammate"
                    >
                      <UserPlus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {dmEntries.map((entry) => {
                  const isActive = activeChannelId === entry.channel.id;
                  const presence = entry.emp
                    ? getEmployeePresenceDisplay(entry.emp)
                    : {
                        key: "active" as const,
                        label: "Admin",
                        dotClass: "bg-indigo-400",
                        pillClass: "bg-indigo-500/20 text-indigo-300 border-indigo-500/30",
                        note: "",
                        isOnline: true
                      };

                  return (
                    <div
                      key={entry.channel.id}
                      className={`w-full min-h-[46px] rounded-xl flex items-center gap-1 transition-colors group ${
                        isActive
                          ? "bg-indigo-600 text-white font-bold shadow-md"
                          : "text-slate-300 hover:bg-slate-800/80 hover:text-white"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setActiveChannelId(entry.channel.id);
                          setMobileView("chat");
                        }}
                        className="flex-1 min-w-0 min-h-[46px] px-2.5 py-2 text-left flex items-center gap-2.5 cursor-pointer"
                      >
                        <div className="relative shrink-0">
                          {entry.emp?.profilePicture ? (
                            <img
                              src={entry.emp.profilePicture}
                              alt={entry.displayName}
                              className="w-7 h-7 rounded-full object-cover border border-white/10"
                            />
                          ) : entry.isAdminPeer ? (
                            <div className="w-7 h-7 rounded-full bg-indigo-500/30 text-indigo-300 text-xs font-bold flex items-center justify-center border border-indigo-500/30">
                              ★
                            </div>
                          ) : (
                            <div className="w-7 h-7 rounded-full bg-slate-800 text-slate-200 text-xs font-bold flex items-center justify-center border border-white/10">
                              {entry.displayName.charAt(0)}
                            </div>
                          )}
                          <span
                            className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-slate-900 ${presence.dotClass}`}
                            title={presence.label}
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-1.5">
                            <p className="text-xs truncate font-semibold">{entry.displayName}</p>
                            {presence.isOnline && !entry.isAdminPeer && (
                              <span
                                className={`text-[9px] px-1.5 py-0.5 rounded-full font-mono font-bold shrink-0 border ${
                                  isActive ? "bg-white/20 text-white border-white/20" : presence.pillClass
                                }`}
                              >
                                {presence.label}
                              </span>
                            )}
                          </div>
                          <p className={`text-[10px] truncate ${isActive ? "text-indigo-100" : "text-slate-400"}`}>
                            {presence.note
                              ? `${presence.note}`
                              : entry.channel.lastMessage || (entry.emp ? `#${entry.emp.employeeNumber}` : "Direct Message")}
                          </p>
                        </div>
                      </button>

                      {/* Quick Video Ring icon right on DM row */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (entry.isAdminPeer) {
                            handleInitiateCall("video", { type: "admin" });
                          } else if (entry.emp) {
                            handleInitiateCall("video", { type: "employee", emp: entry.emp });
                          }
                        }}
                        className={`w-7 h-7 mr-1.5 rounded-lg flex items-center justify-center shrink-0 transition-colors cursor-pointer ${
                          isActive
                            ? "text-white/90 hover:bg-white/20"
                            : "text-slate-400 hover:text-emerald-400 hover:bg-emerald-500/15 md:opacity-0 md:group-hover:opacity-100"
                        }`}
                        title={`Video Call ${entry.displayName}`}
                      >
                        <Video className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}

                {/* Empty DM state when no conversations exist yet */}
                {dmEntries.length === 0 && searchMatchNewEmployees.length === 0 && (
                  <div className="px-2 py-2.5 rounded-2xl bg-slate-900/70 border border-white/5 text-center space-y-2">
                    <p className="text-[11px] text-slate-400">
                      {queryLower ? "No matching DMs found." : "No direct messages yet."}
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setDmPickerSearch(searchQuery);
                        setShowNewDmModal(true);
                      }}
                      className="w-full py-1.5 px-3 rounded-xl bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/30 text-indigo-300 text-[11px] font-bold flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                    >
                      <UserPlus className="w-3.5 h-3.5" />
                      <span>Message or Call Teammate</span>
                    </button>
                  </div>
                )}

                {/* Search-matched employees not yet in DMs */}
                {searchMatchNewEmployees.length > 0 && (
                  <div className="pt-2 space-y-1">
                    <p className="px-2 text-[10px] font-mono text-slate-500 uppercase">Start New DM</p>
                    {searchMatchNewEmployees.map((emp) => {
                      const empId = emp.id || emp.employeeNumber;
                      const presence = getEmployeePresenceDisplay(emp);
                      return (
                        <button
                          key={empId}
                          type="button"
                          onClick={() => handleStartDM(emp)}
                          className="w-full min-h-[44px] px-2.5 py-2 rounded-xl text-left flex items-center gap-2.5 text-slate-300 hover:bg-slate-800/80 hover:text-white transition-colors cursor-pointer"
                        >
                          <div className="relative shrink-0">
                            {emp.profilePicture ? (
                              <img
                                src={emp.profilePicture}
                                alt={emp.fullName}
                                className="w-7 h-7 rounded-full object-cover border border-white/10"
                              />
                            ) : (
                              <div className="w-7 h-7 rounded-full bg-slate-800 text-slate-200 text-xs font-bold flex items-center justify-center border border-white/10">
                                {emp.fullName.charAt(0)}
                              </div>
                            )}
                            <span
                              className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-slate-900 ${presence.dotClass}`}
                            />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-xs truncate font-semibold">{emp.fullName}</p>
                            <p className="text-[10px] text-slate-400 truncate">
                              #{emp.employeeNumber} • {presence.label}
                            </p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              );
            })()}
          </div>

          {/* Current User Card at bottom of sidebar (Interactive Status Selector for Employee) */}
          <div className="p-3 border-t border-white/10 bg-slate-950/80 flex items-center gap-2.5">
            <div className="relative shrink-0">
              {currentUserAvatar ? (
                <img
                  src={currentUserAvatar}
                  alt={currentUserName}
                  className="w-8 h-8 rounded-full object-cover border border-indigo-500/40"
                />
              ) : (
                <div className="w-8 h-8 rounded-full bg-indigo-600 text-white font-bold text-xs flex items-center justify-center">
                  {currentUserName.charAt(0)}
                </div>
              )}
              <span
                className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-slate-950 ${selfPresence.dotClass}`}
                title={selfPresence.label}
              />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-1.5">
                <p className="text-xs font-bold text-white truncate">{currentUserName}</p>
                {userType === "employee" && (
                  <button
                    type="button"
                    onClick={() => {
                      setStatusNoteInput(selfPresence.note || "");
                      setShowStatusModal(true);
                    }}
                    className={`text-[9px] px-2 py-0.5 rounded-full font-mono font-bold shrink-0 border flex items-center gap-1 cursor-pointer hover:opacity-90 transition-opacity ${selfPresence.pillClass}`}
                    title="Change Status (Active, In Meeting, On Break, Focus)"
                  >
                    <span>{selfPresence.label}</span>
                    <ChevronDown className="w-2.5 h-2.5" />
                  </button>
                )}
              </div>
              <p className="text-[10px] text-slate-400 font-mono truncate">
                {selfPresence.note ? selfPresence.note : currentUserRole}
              </p>
            </div>
          </div>
        </aside>

        {/* Center: Messages Stream + Composer */}
        <section className={`${mobileView === "chat" ? "flex w-full" : "hidden"} md:flex flex-1 flex-col min-w-0 bg-slate-900/60 overflow-hidden relative min-h-0`}>
          {/* Pinned Messages Banner */}
          {pinnedMessages.length > 0 && (
            <div className="px-4 py-2 bg-indigo-950/40 border-b border-indigo-500/20 flex items-center justify-between text-xs text-indigo-200 shrink-0">
              <div className="flex items-center gap-2 truncate">
                <Pin className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                <span className="font-bold">Pinned:</span>
                <span className="truncate">{pinnedMessages[0].text || pinnedMessages[0].fileName}</span>
              </div>
              <span className="text-[10px] text-indigo-300 font-mono shrink-0">
                {pinnedMessages.length} pinned
              </span>
            </div>
          )}

          {/* Messages Scroll Area */}
          <div className="flex-1 overflow-y-auto p-3 sm:p-6 space-y-4 min-h-0">
            {!activeChannelId ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-6 sm:p-8 text-slate-500">
                <div className="w-14 h-14 rounded-3xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center mb-3 shadow-inner">
                  <MessageSquare className="w-7 h-7" />
                </div>
                <h3 className="text-base font-bold text-slate-200">No Channel Selected</h3>
                <p className="text-xs text-slate-400 max-w-sm mt-1 leading-relaxed">
                  Select a channel or teammate from the list, or create a new group channel to start messaging.
                </p>
              </div>
            ) : messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-6 sm:p-8 text-slate-500">
                <div className="w-14 h-14 rounded-3xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center mb-3 shadow-inner">
                  <Sparkles className="w-7 h-7" />
                </div>
                <h3 className="text-base font-bold text-slate-200">
                  Welcome to {activeChannelMeta.isDM ? `@${activeChannelMeta.name}` : `#${activeChannelMeta.name}`}!
                </h3>
                <p className="text-xs text-slate-400 max-w-sm mt-1 leading-relaxed">
                  Start the conversation, share artwork drafts for instant critique, or coordinate work with the
                  studio floor.
                </p>
              </div>
            ) : (
              messages
                .filter((m) => (channelFilter === "designs" ? m.isDesignReview : true))
                .map((msg, idx) => {
                  const isMe = msg.senderId === currentUserId;
                  const reactions = msg.reactions || {};
                  const commentCount = msg.designComments?.length || 0;

                  return (
                    <div
                      key={msg.id}
                      className={`flex gap-3 group ${isMe ? "flex-row-reverse" : "flex-row"}`}
                    >
                      {/* Avatar */}
                      {msg.senderAvatar ? (
                        <img
                          src={msg.senderAvatar}
                          alt={msg.senderName}
                          className="w-8 h-8 rounded-full object-cover border border-white/10 shrink-0 mt-0.5"
                        />
                      ) : (
                        <div
                          className={`w-8 h-8 rounded-full text-xs font-bold flex items-center justify-center shrink-0 mt-0.5 ${
                            msg.senderRole === "admin"
                              ? "bg-purple-600 text-white"
                              : "bg-indigo-600 text-white"
                          }`}
                        >
                          {msg.senderName.charAt(0)}
                        </div>
                      )}

                      {/* Message Content */}
                      <div className={`max-w-[85%] sm:max-w-[72%] space-y-1.5 min-w-0 ${isMe ? "items-end" : "items-start"}`}>
                        {/* Header: Sender Name & Timestamp */}
                        <div className={`flex items-center gap-1.5 sm:gap-2 flex-wrap text-[11px] ${isMe ? "flex-row-reverse" : "flex-row"}`}>
                          <span className="font-bold text-slate-200">{msg.senderName}</span>
                          {msg.senderRole === "admin" && (
                            <span className="px-1.5 py-0.2 rounded-full bg-purple-500/20 text-purple-300 text-[9px] font-mono font-bold uppercase">
                              Admin
                            </span>
                          )}
                          <span className="text-slate-500 font-mono text-[10px]">
                            {new Date(msg.createdAt).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit"
                            })}
                          </span>

                          {/* Quick Message Actions (Always reachable on touch, subtle hover on desktop) */}
                          <div className="opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity flex items-center gap-0.5 sm:gap-1">
                            <button
                              type="button"
                              onClick={() => handleReaction(msg.id, "👍")}
                              className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white cursor-pointer"
                              title="Thumbs up"
                            >
                              👍
                            </button>
                            <button
                              type="button"
                              onClick={() => handleReaction(msg.id, "❤️")}
                              className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white cursor-pointer"
                              title="Love"
                            >
                              ❤️
                            </button>
                            <button
                              type="button"
                              onClick={() => handleReaction(msg.id, "🎯")}
                              className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white cursor-pointer"
                              title="Spot on"
                            >
                              🎯
                            </button>
                            <button
                              type="button"
                              onClick={() => handleTogglePin(msg)}
                              className={`p-1 rounded hover:bg-slate-800 cursor-pointer ${
                                msg.isPinned ? "text-indigo-400" : "text-slate-400 hover:text-white"
                              }`}
                              title={msg.isPinned ? "Unpin message" : "Pin message"}
                            >
                              <Pin className="w-3 h-3" />
                            </button>
                            {(isMe || userType === "admin") && (
                              <button
                                type="button"
                                onClick={() => setDeletingMessage(msg)}
                                className="p-1 rounded hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 cursor-pointer"
                                title="Delete message"
                                aria-label="Delete message"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Text bubble if present */}
                        {msg.text && !msg.isCallInvite && (
                          <div
                            className={`p-3 rounded-2xl text-xs sm:text-sm leading-relaxed break-words shadow-md ${
                              isMe
                                ? "bg-indigo-600 text-white rounded-tr-none"
                                : "bg-slate-800/90 text-slate-100 border border-white/5 rounded-tl-none"
                            }`}
                          >
                            {msg.text}
                          </div>
                        )}

                        {/* Interactive Call / Meeting Invite Card */}
                        {msg.isCallInvite && (() => {
                          const linkedCall = liveCalls.find((c) => c.id === msg.callId);
                          const isCallLive = Boolean(linkedCall);
                          return (
                            <div className="bg-slate-950/90 border border-emerald-500/30 rounded-2xl p-3 max-w-sm space-y-2.5 shadow-lg">
                              <div className="flex items-center gap-2.5">
                                <div
                                  className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                                    isCallLive
                                      ? "bg-emerald-500/20 text-emerald-400 animate-pulse"
                                      : "bg-slate-800 text-slate-400"
                                  }`}
                                >
                                  {msg.callType === "audio" ? (
                                    <PhoneCall className="w-4 h-4" />
                                  ) : (
                                    <Video className="w-4 h-4" />
                                  )}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p className="text-xs font-bold text-white">
                                    {msg.callType === "audio" ? "Voice Call / Ring" : "Studio Video Meeting"}
                                  </p>
                                  <p className="text-[11px] text-slate-400 truncate">
                                    {isCallLive
                                      ? `${linkedCall?.participants?.length || 1} participant(s) active now`
                                      : msg.text}
                                  </p>
                                </div>
                              </div>

                              {isCallLive && linkedCall ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    joinExistingStudioCall(
                                      linkedCall,
                                      currentUserId,
                                      currentUserName,
                                      currentUserAvatar,
                                      msg.callType !== "audio"
                                    )
                                  }
                                  className="w-full py-2 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer shadow-md transition-colors"
                                >
                                  <Video className="w-3.5 h-3.5" />
                                  <span>Join Call Now</span>
                                </button>
                              ) : (
                                <span className="inline-block text-[10px] font-mono text-slate-500 uppercase">
                                  Call Ended
                                </span>
                              )}
                            </div>
                          );
                        })()}

                        {/* VIDEO REVIEW CARD (Frame & Clip Scrubbing by Seconds) */}
                        {(msg.isVideoReview || (msg.fileType?.startsWith("video/") && msg.fileUrl)) && (
                          <div className="bg-slate-950/90 border border-purple-500/30 rounded-2xl overflow-hidden shadow-xl w-full max-w-[290px] sm:max-w-md">
                            {/* Video Card Header */}
                            <div className="p-3 bg-gradient-to-r from-purple-950/80 to-slate-900 border-b border-purple-500/20 flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="p-1.5 rounded-lg bg-purple-500/20 text-purple-300">
                                  <Film className="w-4 h-4" />
                                </span>
                                <div className="min-w-0">
                                  <h4 className="text-xs font-black text-white truncate">
                                    {msg.designTitle || msg.fileName || "Video Clip Review"}
                                  </h4>
                                  <p className="text-[10px] text-purple-300 font-mono">
                                    {commentCount} {commentCount === 1 ? "timecode note" : "timecode notes"}
                                  </p>
                                </div>
                              </div>

                              <span
                                className={`px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase ${
                                  msg.designStatus === "Approved"
                                    ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                                    : msg.designStatus === "Needs Revision"
                                    ? "bg-rose-500/20 text-rose-300 border border-rose-500/30"
                                    : "bg-purple-500/20 text-purple-300 border border-purple-500/30"
                                }`}
                              >
                                {msg.designStatus || "Under Review"}
                              </span>
                            </div>

                            {/* Video Preview with Click to Review */}
                            <div
                              onClick={() => setActiveReviewMessage(msg)}
                              className="relative cursor-pointer group/vid overflow-hidden bg-slate-950 max-h-60 flex items-center justify-center"
                            >
                              <video
                                src={msg.fileUrl}
                                className="w-full h-auto max-h-60 object-contain"
                              />
                              <div className="absolute inset-0 bg-purple-950/50 flex flex-col items-center justify-center gap-2 text-white text-xs font-bold transition-opacity">
                                <div className="w-12 h-12 rounded-full bg-purple-600/90 text-white flex items-center justify-center shadow-xl group-hover/vid:scale-110 transition-transform">
                                  <Play className="w-6 h-6 ml-0.5" />
                                </div>
                                <span className="bg-slate-900/90 px-3 py-1 rounded-full text-[11px] font-mono border border-white/10 shadow-md">
                                  Inspect Video Clips & Seconds
                                </span>
                              </div>
                            </div>

                            {/* Action Footer */}
                            <div className="p-2.5 bg-slate-900 flex items-center justify-between gap-2">
                              <button
                                type="button"
                                onClick={() => setActiveReviewMessage(msg)}
                                className="flex-1 py-1.5 px-3 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer shadow-md"
                              >
                                <Eye className="w-3.5 h-3.5" />
                                <span>Review Video Clips & Errors</span>
                              </button>

                              <a
                                href={msg.fileUrl}
                                download={msg.fileName || "clip.mp4"}
                                className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer"
                                title="Download Video"
                              >
                                <Download className="w-4 h-4" />
                              </a>
                            </div>
                          </div>
                        )}

                        {/* DESIGN REVIEW CARD (Star Highlight requested by user!) */}
                        {msg.isDesignReview && !msg.isVideoReview && !msg.fileType?.startsWith("video/") && msg.fileUrl && (
                          <div className="bg-slate-950/90 border border-indigo-500/30 rounded-2xl overflow-hidden shadow-xl w-full max-w-[290px] sm:max-w-md">
                            {/* Design Preview Header */}
                            <div className="p-3 bg-gradient-to-r from-indigo-950/80 to-slate-900 border-b border-indigo-500/20 flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="p-1.5 rounded-lg bg-indigo-500/20 text-indigo-300">
                                  <Palette className="w-4 h-4" />
                                </span>
                                <div className="min-w-0">
                                  <h4 className="text-xs font-black text-white truncate">
                                    {msg.designTitle || msg.fileName || "Studio Artwork"}
                                  </h4>
                                  <p className="text-[10px] text-indigo-300 font-mono">
                                    {commentCount} {commentCount === 1 ? "critique note" : "critique notes"}
                                  </p>
                                </div>
                              </div>

                              <span
                                className={`px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase ${
                                  msg.designStatus === "Approved"
                                    ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                                    : msg.designStatus === "Needs Revision"
                                    ? "bg-rose-500/20 text-rose-300 border border-rose-500/30"
                                    : "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                                }`}
                              >
                                {msg.designStatus || "Under Review"}
                              </span>
                            </div>

                            {/* Image Thumbnail with Overlay */}
                            <div
                              onClick={() => setActiveReviewMessage(msg)}
                              className="relative cursor-pointer group/img overflow-hidden bg-slate-950 max-h-64 flex items-center justify-center"
                            >
                              <img
                                src={msg.fileUrl}
                                alt={msg.designTitle || "Design Artwork"}
                                className="w-full h-auto max-h-64 object-contain transition-transform duration-300 group-hover/img:scale-102"
                              />
                              <div className="absolute inset-0 bg-indigo-950/60 opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center justify-center gap-2 text-white text-xs font-bold">
                                <Eye className="w-4 h-4" />
                                <span>Inspect & Comment on Design</span>
                              </div>
                            </div>

                            {/* Action Footer */}
                            <div className="p-2.5 bg-slate-900 flex items-center justify-between gap-2">
                              <button
                                type="button"
                                onClick={() => setActiveReviewMessage(msg)}
                                className="flex-1 py-1.5 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer shadow-md"
                              >
                                <Eye className="w-3.5 h-3.5" />
                                <span>Open Design Reviewer</span>
                              </button>

                              <a
                                href={msg.fileUrl}
                                download={msg.fileName || "artwork.png"}
                                className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer"
                                title="Download File"
                              >
                                <Download className="w-4 h-4" />
                              </a>
                            </div>
                          </div>
                        )}

                        {/* Standard File Attachment (Non-Design or PDF) */}
                        {!msg.isDesignReview && msg.fileUrl && (
                          <div className="bg-slate-800/90 border border-white/10 rounded-2xl p-3 flex items-center gap-3 max-w-sm">
                            <div className="w-10 h-10 rounded-xl bg-indigo-500/10 text-indigo-400 flex items-center justify-center shrink-0">
                              {msg.fileType?.startsWith("image/") ? (
                                <ImageIcon className="w-5 h-5" />
                              ) : (
                                <FileText className="w-5 h-5" />
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-bold text-white truncate">{msg.fileName || "Attachment"}</p>
                              <p className="text-[10px] text-slate-400 font-mono">{msg.fileSize || "File"}</p>
                            </div>
                            <a
                              href={msg.fileUrl}
                              download={msg.fileName || "file"}
                              className="p-2 rounded-xl bg-slate-700 hover:bg-slate-600 text-white transition-colors cursor-pointer"
                              title="Download"
                            >
                              <Download className="w-4 h-4" />
                            </a>
                          </div>
                        )}

                        {/* Reactions Bar */}
                        {Object.keys(reactions).length > 0 && (
                          <div className="flex items-center gap-1 flex-wrap pt-0.5">
                            {Object.entries(reactions).map(([emoji, userList]) => {
                              const hasReacted = userList.includes(currentUserName);
                              return (
                                <button
                                  key={emoji}
                                  type="button"
                                  onClick={() => handleReaction(msg.id, emoji)}
                                  className={`px-2 py-0.5 rounded-full text-[11px] font-mono flex items-center gap-1 border transition-colors cursor-pointer ${
                                    hasReacted
                                      ? "bg-indigo-600/30 border-indigo-500 text-indigo-200"
                                      : "bg-slate-800 border-white/10 text-slate-400 hover:text-white"
                                  }`}
                                  title={userList.join(", ")}
                                >
                                  <span>{emoji}</span>
                                  <span className="font-bold text-[10px]">{userList.length}</span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Incoming Message Floating Toast Banner */}
          {incomingToast && (
            <div className="absolute top-4 right-4 z-30 max-w-sm bg-indigo-950/95 border border-indigo-500/40 rounded-2xl shadow-2xl p-3 flex items-center gap-3 backdrop-blur-xl animate-in fade-in slide-in-from-top-4">
              <div className="w-9 h-9 rounded-full bg-indigo-600 text-white font-bold flex items-center justify-center shrink-0">
                {incomingToast.senderAvatar ? (
                  <img
                    src={incomingToast.senderAvatar}
                    alt={incomingToast.senderName}
                    className="w-full h-full rounded-full object-cover"
                  />
                ) : (
                  incomingToast.senderName.charAt(0)
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-1">
                  <span className="text-xs font-bold text-white truncate">{incomingToast.senderName}</span>
                  <span className="text-[10px] text-indigo-300 font-mono">#{incomingToast.channelName}</span>
                </div>
                <p className="text-xs text-slate-300 truncate mt-0.5">{incomingToast.text}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setActiveChannelId(incomingToast.channelId);
                  setMobileView("chat");
                  setIncomingToast(null);
                }}
                className="px-2.5 py-1 rounded-xl bg-indigo-600 text-white text-[11px] font-bold hover:bg-indigo-500 cursor-pointer shrink-0"
              >
                View
              </button>
              <button
                type="button"
                onClick={() => setIncomingToast(null)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Pending Attachment Preview Bar */}
          {attachedFile && (
            <div className="px-4 py-2 bg-slate-950 border-t border-white/10 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                {attachedFile.type.startsWith("video/") || isVideoReviewTag ? (
                  <div className="w-12 h-12 rounded-xl bg-purple-500/20 text-purple-300 flex items-center justify-center shrink-0 border border-purple-500/30">
                    <Film className="w-6 h-6" />
                  </div>
                ) : attachedFile.type.startsWith("image/") ? (
                  <img
                    src={attachedFile.url}
                    alt="Preview"
                    className="w-12 h-12 rounded-xl object-cover border border-white/10 shrink-0"
                  />
                ) : (
                  <div className="w-12 h-12 rounded-xl bg-indigo-500/10 text-indigo-400 flex items-center justify-center shrink-0">
                    <FileText className="w-6 h-6" />
                  </div>
                )}
                <div className="min-w-0">
                  <p className="text-xs font-bold text-white truncate">{attachedFile.name}</p>
                  <p className="text-[10px] text-slate-400 font-mono">{attachedFile.size}</p>

                  {/* Toggle for Video Review Mode */}
                  {(attachedFile.type.startsWith("video/") || isVideoReviewTag) && (
                    <label className="flex items-center gap-2 mt-1 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={isVideoReviewTag}
                        onChange={(e) => {
                          setIsVideoReviewTag(e.target.checked);
                          if (e.target.checked) setIsDesignReviewTag(true);
                        }}
                        className="rounded bg-slate-800 border-white/20 text-purple-600 focus:ring-0"
                      />
                      <span className="text-[11px] font-bold text-purple-300 flex items-center gap-1">
                        <Film className="w-3 h-3" /> Tag as Video for Review (Scrub Clips & Second Notes)
                      </span>
                    </label>
                  )}

                  {/* Toggle for Design Review Mode (Google Drive Area Select) */}
                  {attachedFile.type.startsWith("image/") && !isVideoReviewTag && (
                    <label className="flex items-center gap-2 mt-1 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={isDesignReviewTag}
                        onChange={(e) => setIsDesignReviewTag(e.target.checked)}
                        className="rounded bg-slate-800 border-white/20 text-indigo-600 focus:ring-0"
                      />
                      <span className="text-[11px] font-bold text-amber-300 flex items-center gap-1">
                        <Square className="w-3 h-3" /> Tag as Artwork Review (Area Box Select & Pins)
                      </span>
                    </label>
                  )}
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  setAttachedFile(null);
                  setIsVideoReviewTag(false);
                  setIsDesignReviewTag(false);
                  if (fileInputRef.current) fileInputRef.current.value = "";
                }}
                className="p-1.5 rounded-xl hover:bg-slate-800 text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Bottom Message Composer */}
          <footer className="p-2.5 sm:p-4 border-t border-white/10 bg-slate-950/95 backdrop-blur-xl shrink-0">
            <form onSubmit={handleSendMessage} className="flex items-center gap-2">
              {/* Attachment Picker */}
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileSelect}
                className="hidden"
                accept="image/*,video/*,application/pdf,.zip,.rar"
              />
              <button
                type="button"
                disabled={!activeChannelId || isUploadingAttachment}
                onClick={() => fileInputRef.current?.click()}
                className="min-h-[42px] min-w-[42px] flex items-center justify-center p-2.5 rounded-2xl bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 hover:text-white transition-colors cursor-pointer shrink-0"
                title={isUploadingAttachment ? "Preparing attachment..." : "Attach Design or File"}
              >
                <Paperclip className={`w-4 h-4 ${isUploadingAttachment ? "animate-spin" : ""}`} />
              </button>

              {/* Message Input */}
              <input
                type="text"
                disabled={!activeChannelId}
                value={messageText}
                onChange={(e) => setMessageText(e.target.value)}
                onFocus={() => {
                  if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current);
                  setIsComposerFocused(true);
                }}
                onBlur={() => {
                  blurTimeoutRef.current = setTimeout(() => {
                    setIsComposerFocused(false);
                  }, 150);
                }}
                placeholder={
                  activeChannelId
                    ? `Message ${activeChannelMeta.isDM ? `@${activeChannelMeta.name}` : `#${activeChannelMeta.name}`}...`
                    : "Select a channel or teammate to start messaging..."
                }
                className="flex-1 min-w-0 bg-slate-800/80 border border-white/10 rounded-2xl px-3.5 sm:px-4 py-2.5 text-sm text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
              />

              {/* Send Button */}
              <button
                type="submit"
                disabled={!activeChannelId || isUploadingAttachment || (!messageText.trim() && !attachedFile)}
                className="min-h-[42px] p-2.5 px-3.5 sm:px-4 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs flex items-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shadow-md shrink-0 whitespace-nowrap"
              >
                <Send className="w-4 h-4" />
                <span className="hidden sm:inline">Send</span>
              </button>
            </form>
          </footer>
        </section>
      </div>

      {/* DESIGN REVIEW MODAL LIGHT-TABLE */}
      {activeReviewMessage && (
        <DesignReviewModal
          message={activeReviewMessage}
          currentUserId={currentUserId}
          currentUserName={currentUserName}
          currentUserRole={currentUserRole}
          currentUserAvatar={currentUserAvatar}
          onClose={() => setActiveReviewMessage(null)}
          onUpdateMessage={handleUpdateDesignMessage}
        />
      )}

      {/* CREATE NEW CHANNEL / GROUP MODAL */}
      {showCreateChannelModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in">
          <div className="bg-slate-900 border border-white/10 rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-indigo-500/20 text-indigo-400 flex items-center justify-center">
                  <Plus className="w-4 h-4" />
                </div>
                <h3 className="text-base font-bold text-white">Create Studio Group Channel</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateChannelModal(false)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateChannel} className="space-y-4">
              <div>
                <label className="block text-xs font-mono font-bold text-slate-300 uppercase mb-1">
                  Channel Name
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-2.5 text-slate-400 font-mono">#</span>
                  <input
                    type="text"
                    value={newChannelName}
                    onChange={(e) => setNewChannelName(e.target.value)}
                    placeholder="e.g. thumbnails-team, branding, night-shift-squad"
                    className="w-full pl-8 pr-4 py-2 rounded-xl bg-slate-800 border border-white/10 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-mono font-bold text-slate-300 uppercase mb-1">
                  Description / Topic (Optional)
                </label>
                <input
                  type="text"
                  value={newChannelDesc}
                  onChange={(e) => setNewChannelDesc(e.target.value)}
                  placeholder="What is this channel for?"
                  className="w-full px-4 py-2 rounded-xl bg-slate-800 border border-white/10 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateChannelModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 hover:text-white text-xs font-bold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!newChannelName.trim()}
                  className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-colors cursor-pointer disabled:opacity-40"
                >
                  Create Channel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ADMIN: RENAME / EDIT CHANNEL MODAL */}
      {userType === "admin" && editingChannel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in">
          <div className="bg-slate-900 border border-white/10 rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-indigo-500/20 text-indigo-400 flex items-center justify-center">
                  <Pencil className="w-4 h-4" />
                </div>
                <h3 className="text-base font-bold text-white">Rename Studio Channel</h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  setEditingChannel(null);
                  setEditChannelError("");
                }}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleRenameChannel} className="space-y-4">
              {editChannelError && (
                <div className="px-3 py-2 rounded-xl bg-rose-950/80 border border-rose-500/40 text-xs text-rose-200 font-mono">
                  {editChannelError}
                </div>
              )}

              <div>
                <label className="block text-xs font-mono font-bold text-slate-300 uppercase mb-1">
                  Channel Name
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-2.5 text-slate-400 font-mono">#</span>
                  <input
                    type="text"
                    value={editChannelName}
                    onChange={(e) => {
                      setEditChannelName(e.target.value);
                      setEditChannelError("");
                    }}
                    placeholder="e.g. thumbnails-team, branding"
                    className="w-full pl-8 pr-4 py-2 rounded-xl bg-slate-800 border border-white/10 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    required
                  />
                </div>
                <p className="text-[10px] text-slate-400 font-mono mt-1">
                  All existing messages and design reviews remain preserved.
                </p>
              </div>

              <div>
                <label className="block text-xs font-mono font-bold text-slate-300 uppercase mb-1">
                  Description / Topic (Optional)
                </label>
                <input
                  type="text"
                  value={editChannelDesc}
                  onChange={(e) => setEditChannelDesc(e.target.value)}
                  placeholder="What is this channel for?"
                  className="w-full px-4 py-2 rounded-xl bg-slate-800 border border-white/10 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setEditingChannel(null);
                    setEditChannelError("");
                  }}
                  className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 hover:text-white text-xs font-bold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingChannelEdit || !editChannelName.trim()}
                  className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-colors cursor-pointer disabled:opacity-40"
                >
                  {isSavingChannelEdit ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ADMIN: DELETE CHANNEL CONFIRMATION MODAL */}
      {userType === "admin" && deletingChannel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in">
          <div className="bg-slate-900 border border-rose-500/30 rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-rose-500/20 text-rose-400 flex items-center justify-center shrink-0">
                  <Trash2 className="w-4 h-4" />
                </div>
                <h3 className="text-base font-bold text-white">Delete Channel</h3>
              </div>
              <button
                type="button"
                onClick={() => setDeletingChannel(null)}
                disabled={isDeletingChannel}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              Are you sure you want to delete{" "}
              <span className="font-mono font-bold text-white">#{deletingChannel.name}</span>? It will be removed from
              Studio Channels &amp; DMs for all staff.
            </p>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDeletingChannel(null)}
                disabled={isDeletingChannel}
                className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 hover:text-white text-xs font-bold cursor-pointer disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteChannel}
                disabled={isDeletingChannel}
                className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition-colors cursor-pointer disabled:opacity-40"
              >
                {isDeletingChannel ? "Deleting..." : "Delete Channel"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DELETE SINGLE MESSAGE CONFIRMATION MODAL */}
      {deletingMessage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in">
          <div className="bg-slate-900 border border-rose-500/30 rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-rose-500/20 text-rose-400 flex items-center justify-center shrink-0">
                  <Trash2 className="w-4 h-4" />
                </div>
                <h3 className="text-base font-bold text-white">Delete Message</h3>
              </div>
              <button
                type="button"
                onClick={() => setDeletingMessage(null)}
                disabled={isDeletingMessage}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2">
              <p className="text-xs text-slate-300 leading-relaxed">
                Are you sure you want to delete this message from{" "}
                <span className="font-bold text-white">{deletingMessage.senderName}</span>?
              </p>
              <div className="p-2.5 rounded-xl bg-slate-950/80 border border-white/10 text-xs text-slate-400 truncate">
                {deletingMessage.text ||
                  deletingMessage.designTitle ||
                  deletingMessage.fileName ||
                  "Attachment / Call notice"}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDeletingMessage(null)}
                disabled={isDeletingMessage}
                className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 hover:text-white text-xs font-bold cursor-pointer disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteMessage}
                disabled={isDeletingMessage}
                className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition-colors cursor-pointer disabled:opacity-40"
              >
                {isDeletingMessage ? "Deleting..." : "Delete Message"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DELETE ALL MESSAGES / CLEAR CHAT CONFIRMATION MODAL */}
      {showClearMessagesModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in">
          <div className="bg-slate-900 border border-rose-500/30 rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-rose-500/20 text-rose-400 flex items-center justify-center shrink-0">
                  <Eraser className="w-4 h-4" />
                </div>
                <h3 className="text-base font-bold text-white">Delete All Messages</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowClearMessagesModal(false)}
                disabled={isClearingMessages}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {(() => {
              const canDeleteAll = userType === "admin" || activeChannelMeta.isDM;
              const myMsgCount = messages.filter((m) => m.senderId === currentUserId).length;
              const targetName = activeChannelMeta.isDM
                ? `@${activeChannelMeta.name}`
                : `#${activeChannelMeta.name}`;

              return (
                <>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    {canDeleteAll ? (
                      <>
                        This will delete all{" "}
                        <span className="font-mono font-bold text-white">{messages.length}</span>{" "}
                        message{messages.length === 1 ? "" : "s"} in{" "}
                        <span className="font-mono font-bold text-white">{targetName}</span>.
                      </>
                    ) : (
                      <>
                        You can delete all{" "}
                        <span className="font-mono font-bold text-white">{myMsgCount}</span> of your own
                        message{myMsgCount === 1 ? "" : "s"} in{" "}
                        <span className="font-mono font-bold text-white">{targetName}</span>.
                      </>
                    )}
                  </p>

                  <div className="flex items-center justify-end gap-2 flex-wrap pt-2">
                    <button
                      type="button"
                      onClick={() => setShowClearMessagesModal(false)}
                      disabled={isClearingMessages}
                      className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 hover:text-white text-xs font-bold cursor-pointer disabled:opacity-40"
                    >
                      Cancel
                    </button>

                    {canDeleteAll && myMsgCount > 0 && myMsgCount < messages.length && (
                      <button
                        type="button"
                        onClick={() => handleConfirmClearMessages("mine")}
                        disabled={isClearingMessages}
                        className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-white/10 text-slate-200 text-xs font-bold transition-colors cursor-pointer disabled:opacity-40"
                      >
                        Delete Mine ({myMsgCount})
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => handleConfirmClearMessages(canDeleteAll ? "all" : "mine")}
                      disabled={isClearingMessages || (!canDeleteAll && myMsgCount === 0)}
                      className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition-colors cursor-pointer disabled:opacity-40"
                    >
                      {isClearingMessages
                        ? "Deleting..."
                        : canDeleteAll
                        ? "Delete All Messages"
                        : `Delete My Messages (${myMsgCount})`}
                    </button>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* START NEW DIRECT MESSAGE OR CALL MODAL */}
      {showNewDmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in">
          <div className="bg-slate-900 border border-white/10 rounded-3xl max-w-md w-full p-5 shadow-2xl space-y-4 max-h-[85dvh] flex flex-col">
            <div className="flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-indigo-500/20 text-indigo-400 flex items-center justify-center">
                  <UserPlus className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Message or Call Teammate</h3>
                  <p className="text-[11px] text-slate-400">Pick someone to start a DM, audio ring, or video call</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowNewDmModal(false)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="relative shrink-0">
              <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-500 pointer-events-none" />
              <input
                type="text"
                value={dmPickerSearch}
                onChange={(e) => setDmPickerSearch(e.target.value)}
                placeholder="Search artist name or #ID..."
                className="w-full pl-8 pr-3 py-2 rounded-xl bg-slate-800 border border-white/10 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div className="flex-1 overflow-y-auto space-y-1.5 min-h-0 pr-1">
              {userType === "employee" &&
                (!dmPickerSearch.trim() || "studio hr admin support".includes(dmPickerSearch.toLowerCase())) && (
                  <div className="p-2.5 rounded-2xl bg-slate-800/60 border border-white/5 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-8 h-8 rounded-full bg-indigo-500/30 text-indigo-300 text-xs font-bold flex items-center justify-center shrink-0">
                        ★
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-white truncate">Studio HR / Admin</p>
                        <p className="text-[10px] text-slate-400 truncate">Management Support</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={handleStartAdminDM}
                        className="px-2.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-bold cursor-pointer"
                      >
                        Chat
                      </button>
                      <button
                        type="button"
                        onClick={() => handleInitiateCall("audio", { type: "admin" })}
                        className="p-1.5 rounded-xl bg-slate-700 hover:bg-emerald-600/30 text-emerald-400 cursor-pointer"
                        title="Ring Admin"
                      >
                        <PhoneCall className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleInitiateCall("video", { type: "admin" })}
                        className="p-1.5 rounded-xl bg-slate-700 hover:bg-emerald-600/30 text-emerald-400 cursor-pointer"
                        title="Video Call Admin"
                      >
                        <Video className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )}

              {employees
                .filter((e) => (e.id || e.employeeNumber) !== currentUserId)
                .filter((e) => {
                  const q = dmPickerSearch.trim().toLowerCase();
                  if (!q) return true;
                  return (
                    e.fullName.toLowerCase().includes(q) ||
                    e.employeeNumber.toLowerCase().includes(q) ||
                    (e.position && e.position.toLowerCase().includes(q))
                  );
                })
                .map((emp) => {
                  const empId = emp.id || emp.employeeNumber;
                  const presence = getEmployeePresenceDisplay(emp);
                  return (
                    <div
                      key={empId}
                      className="p-2.5 rounded-2xl bg-slate-800/50 hover:bg-slate-800/90 border border-white/5 flex items-center justify-between gap-2 transition-colors"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="relative shrink-0">
                          {emp.profilePicture ? (
                            <img
                              src={emp.profilePicture}
                              alt={emp.fullName}
                              className="w-8 h-8 rounded-full object-cover border border-white/10"
                            />
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-slate-700 text-slate-200 text-xs font-bold flex items-center justify-center">
                              {emp.fullName.charAt(0)}
                            </div>
                          )}
                          <span
                            className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-slate-900 ${presence.dotClass}`}
                          />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <p className="text-xs font-bold text-white truncate">{emp.fullName}</p>
                            <span
                              className={`text-[9px] px-1.5 py-0.2 rounded-full font-mono font-bold border shrink-0 ${presence.pillClass}`}
                            >
                              {presence.label}
                            </span>
                          </div>
                          <p className="text-[10px] text-slate-400 truncate">
                            #{emp.employeeNumber} • {presence.note || emp.position || "Artist"}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleStartDM(emp)}
                          className="px-2.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-bold cursor-pointer"
                        >
                          Chat
                        </button>
                        <button
                          type="button"
                          onClick={() => handleInitiateCall("audio", { type: "employee", emp })}
                          className="p-1.5 rounded-xl bg-slate-700 hover:bg-emerald-600/30 text-emerald-400 cursor-pointer"
                          title={`Ring ${emp.fullName}`}
                        >
                          <PhoneCall className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleInitiateCall("video", { type: "employee", emp })}
                          className="p-1.5 rounded-xl bg-slate-700 hover:bg-emerald-600/30 text-emerald-400 cursor-pointer"
                          title={`Video Call ${emp.fullName}`}
                        >
                          <Video className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        </div>
      )}

      {/* EMPLOYEE: SET CUSTOM WORK STATUS MODAL (ACTIVE, IN MEETING, ON BREAK, FOCUS) */}
      {userType === "employee" && showStatusModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in">
          <div className="bg-slate-900 border border-white/10 rounded-3xl max-w-sm w-full p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-white">Set Your Work Status</h3>
                <p className="text-[11px] text-slate-400">
                  {isCurrentUserClockedIn
                    ? "Visible live to Admin and teammates in Studio Chat"
                    : "Your chosen status shows once you are Timed In"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowStatusModal(false)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div>
              <label className="block text-[10px] font-mono font-bold text-slate-400 uppercase mb-1">
                Optional Status Note
              </label>
              <input
                type="text"
                maxLength={50}
                value={statusNoteInput}
                onChange={(e) => setStatusNoteInput(e.target.value)}
                placeholder="e.g. Editing client thumbnails..."
                className="w-full px-3 py-2 rounded-xl bg-slate-800 border border-white/10 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div className="grid grid-cols-1 gap-2">
              {(
                [
                  {
                    value: "active" as EmployeePresenceStatus,
                    label: "Active / Available",
                    desc: "Ready on the studio floor",
                    dot: "bg-emerald-500",
                    icon: CheckCircle2
                  },
                  {
                    value: "meeting" as EmployeePresenceStatus,
                    label: "In Meeting",
                    desc: "In a huddle, client sync, or call",
                    dot: "bg-violet-500",
                    icon: Video
                  },
                  {
                    value: "break" as EmployeePresenceStatus,
                    label: "On Break",
                    desc: "Stepping away briefly",
                    dot: "bg-amber-500",
                    icon: Coffee
                  },
                  {
                    value: "focus" as EmployeePresenceStatus,
                    label: "Focus Mode",
                    desc: "Heads-down designing",
                    dot: "bg-sky-500",
                    icon: Headphones
                  }
                ] as const
              ).map((opt) => {
                const IconComp = opt.icon;
                const isSelected = (localPresenceOverride?.status || liveSelfProfile?.presenceStatus || "active") === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    disabled={isSavingStatus}
                    onClick={() => handleSaveEmployeeStatus(opt.value)}
                    className={`w-full p-3 rounded-2xl border text-left flex items-center justify-between gap-3 transition-colors cursor-pointer ${
                      isSelected
                        ? "bg-indigo-600/20 border-indigo-500 text-white"
                        : "bg-slate-800/60 hover:bg-slate-800 border-white/10 text-slate-200"
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className={`w-3 h-3 rounded-full shrink-0 ${opt.dot}`} />
                      <div className="min-w-0">
                        <p className="text-xs font-bold truncate">{opt.label}</p>
                        <p className="text-[10px] text-slate-400 truncate">{opt.desc}</p>
                      </div>
                    </div>
                    <IconComp className="w-4 h-4 text-slate-400 shrink-0" />
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
