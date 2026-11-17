import { collection, doc, addDoc, setDoc, getDocs, query, where, db } from "../firebase";
import { StudioCall } from "../types";

export interface InitiateStudioCallParams {
  channelId: string;
  channelName: string;
  isGroupMeeting: boolean;
  callType: "video" | "audio";
  callerId: string;
  callerName: string;
  callerAvatar?: string;
  calleeId?: string;
  calleeName?: string;
  targetIds?: string[];
  dmMemberIds?: string[];
  dmMemberNames?: string[];
}

export async function startOrJoinStudioCall(params: InitiateStudioCallParams): Promise<StudioCall> {
  const now = Date.now();

  // Check if there is already a live ringing/active call on this channel (within last 3 hours)
  try {
    const existingSnap = await getDocs(query(collection(db, "chat_calls"), where("channelId", "==", params.channelId)));
    let liveCall: StudioCall | null = null;
    existingSnap.forEach((d: any) => {
      const data = { ...d.data(), id: d.id } as StudioCall;
      if (
        (data.status === "ringing" || data.status === "active") &&
        now - Number(data.updatedAt || data.createdAt || 0) < 3 * 60 * 60 * 1000
      ) {
        liveCall = data;
      }
    });

    if (liveCall) {
      const target = liveCall as StudioCall;
      const updatedParticipants = Array.from(new Set([...(target.participants || []), params.callerId]));
      const updatedNames = { ...(target.participantNames || {}), [params.callerId]: params.callerName };
      const updatedAvatars = { ...(target.participantAvatars || {}) };
      if (params.callerAvatar) updatedAvatars[params.callerId] = params.callerAvatar;
      const updatedMedia = {
        ...(target.participantMedia || {}),
        [params.callerId]: { micMuted: false, camOff: params.callType !== "video" }
      };

      const nextStatus: StudioCall["status"] =
        updatedParticipants.length > 1 ? "active" : target.status;

      await setDoc(
        doc(db, "chat_calls", target.id),
        {
          participants: updatedParticipants,
          participantNames: updatedNames,
          participantAvatars: updatedAvatars,
          participantMedia: updatedMedia,
          status: nextStatus,
          updatedAt: now
        },
        { merge: true }
      );

      return {
        ...target,
        participants: updatedParticipants,
        participantNames: updatedNames,
        participantAvatars: updatedAvatars,
        participantMedia: updatedMedia,
        status: nextStatus,
        updatedAt: now
      };
    }
  } catch (err) {
    console.warn("Checking existing calls note:", err);
  }

  const callId = `call_${now}_${Math.random().toString(36).slice(2, 6)}`;
  const newCall: StudioCall = {
    id: callId,
    channelId: params.channelId,
    channelName: params.channelName,
    isGroupMeeting: params.isGroupMeeting,
    callType: params.callType,
    callerId: params.callerId,
    callerName: params.callerName,
    ...(params.callerAvatar ? { callerAvatar: params.callerAvatar } : {}),
    ...(params.calleeId ? { calleeId: params.calleeId } : {}),
    ...(params.calleeName ? { calleeName: params.calleeName } : {}),
    ...(params.targetIds && params.targetIds.length > 0 ? { targetIds: params.targetIds } : {}),
    participants: [params.callerId],
    participantNames: { [params.callerId]: params.callerName },
    participantAvatars: params.callerAvatar ? { [params.callerId]: params.callerAvatar } : {},
    participantMedia: { [params.callerId]: { micMuted: false, camOff: params.callType !== "video" } },
    status: "ringing",
    createdAt: now,
    updatedAt: now
  };

  await setDoc(doc(db, "chat_calls", callId), newCall);

  // Post a clickable call / meeting invite card inside the chat stream
  const inviteText = params.isGroupMeeting
    ? `📹 ${params.callerName} started a Studio ${params.callType === "video" ? "Video Meeting" : "Audio Huddle"} in #${params.channelName}. Tap Join Call to enter!`
    : `${params.callType === "video" ? "📹" : "📞"} ${params.callerName} started a ${params.callType === "video" ? "video call" : "voice ring"}.`;

  await addDoc(collection(db, "chat_messages"), {
    channelId: params.channelId,
    senderId: params.callerId,
    senderName: params.callerName,
    senderAvatar: params.callerAvatar || "",
    senderRole: params.callerId === "admin-hr" ? "admin" : "artist",
    text: inviteText,
    isCallInvite: true,
    callId,
    callType: params.callType,
    reactions: {},
    createdAt: now
  }).catch(() => {});

  // Ensure channel / DM activity metadata is updated so DM appears for both participants
  const channelMetaUpdate: Record<string, any> = {
    id: params.channelId,
    lastMessage: inviteText,
    lastMessageAt: now,
    lastMessageSender: params.callerName
  };
  if (params.channelId.startsWith("dm_") && params.dmMemberIds && params.dmMemberNames) {
    channelMetaUpdate.type = "direct";
    channelMetaUpdate.name = params.channelName;
    channelMetaUpdate.memberIds = params.dmMemberIds;
    channelMetaUpdate.memberNames = params.dmMemberNames;
  }

  await setDoc(doc(db, "chat_channels", params.channelId), channelMetaUpdate, { merge: true }).catch(() => {});

  return newCall;
}

export async function joinExistingStudioCall(
  call: StudioCall,
  userId: string,
  userName: string,
  userAvatar?: string,
  withVideo = true
) {
  const now = Date.now();
  const updatedParticipants = Array.from(new Set([...(call.participants || []), userId]));
  const updatedNames = { ...(call.participantNames || {}), [userId]: userName };
  const updatedAvatars = { ...(call.participantAvatars || {}) };
  if (userAvatar) updatedAvatars[userId] = userAvatar;
  const updatedMedia = {
    ...(call.participantMedia || {}),
    [userId]: { micMuted: false, camOff: !withVideo }
  };

  await setDoc(
    doc(db, "chat_calls", call.id),
    {
      participants: updatedParticipants,
      participantNames: updatedNames,
      participantAvatars: updatedAvatars,
      participantMedia: updatedMedia,
      status: "active",
      updatedAt: now
    },
    { merge: true }
  );
}
