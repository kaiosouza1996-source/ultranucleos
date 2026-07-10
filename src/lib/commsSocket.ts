/**
 * Realtime da Comunicação Interna — substitui `supabase.channel(...)`.
 * Reaproveita a MESMA conexão WebSocket que engine.ts já mantém (evita abrir
 * um segundo socket) — as mensagens `comms:*` chegam via
 * dispatchCommsMessage(), chamado por engine.ts:handleEngineMessage() para
 * qualquer mensagem cujo `type` comece com "comms:". Ver whatsapp-engine/realtime.js
 * para o protocolo completo.
 */
import { engineClient } from "@/lib/engine";
import type { CommsMessage } from "@/lib/comms";

export interface CommsSubscription {
  unsubscribe(): void;
}

export interface TypingHandle {
  channelId: string;
  unsubscribe(): void;
}

type InsertHandler = (m: CommsMessage) => void;
type UpdateHandler = (m: CommsMessage) => void;
type TypingHandler = (userId: string) => void;
type PresenceHandler = (onlineIds: Set<string>) => void;

const messageSubs = new Map<string, { onInsert: InsertHandler; onUpdate?: UpdateHandler }>();
const typingSubs = new Map<string, Set<TypingHandler>>();
let presenceHandler: PresenceHandler | null = null;
let presenceJoined = false;

function send(msg: Record<string, unknown>) {
  engineClient.send(msg as never);
}

/** Chamado por engine.ts:handleEngineMessage() para toda mensagem "comms:*". */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function dispatchCommsMessage(msg: any) {
  switch (msg.type) {
    case "comms:message:insert": {
      messageSubs.get(msg.channelId)?.onInsert(msg.message);
      break;
    }
    case "comms:message:update": {
      messageSubs.get(msg.channelId)?.onUpdate?.(msg.message);
      break;
    }
    case "comms:typing": {
      typingSubs.get(msg.channelId)?.forEach((cb) => cb(msg.userId));
      break;
    }
    case "comms:presence:sync": {
      presenceHandler?.(new Set(msg.onlineIds));
      break;
    }
    default:
      break;
  }
}

export function subscribeMessages(channelId: string, onInsert: InsertHandler, onUpdate?: UpdateHandler): CommsSubscription {
  messageSubs.set(channelId, { onInsert, onUpdate });
  send({ type: "comms:subscribe", channelId });
  return {
    unsubscribe() {
      messageSubs.delete(channelId);
      send({ type: "comms:unsubscribe", channelId });
    },
  };
}

export function subscribeTyping(channelId: string, onTyping: TypingHandler): TypingHandle {
  if (!typingSubs.has(channelId)) typingSubs.set(channelId, new Set());
  typingSubs.get(channelId)!.add(onTyping);
  return {
    channelId,
    unsubscribe() {
      typingSubs.get(channelId)?.delete(onTyping);
    },
  };
}

export function sendTyping(channelId: string) {
  send({ type: "comms:typing", channelId });
}

export const presence = {
  join(onSync: PresenceHandler) {
    presenceHandler = onSync;
    presenceJoined = true;
    send({ type: "comms:presence:join" });
  },
  leave() {
    presenceHandler = null;
    if (presenceJoined) send({ type: "comms:presence:leave" });
    presenceJoined = false;
  },
};
