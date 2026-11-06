"use client";

import { FormEvent, KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpRight, Hash, LoaderCircle, MessageCircle, MessageSquare, Reply, Send,
  SmilePlus, Users, Wifi, WifiOff, X,
} from "lucide-react";
import { DISPLAY_NAME_MAX_LENGTH, MESSAGE_MAX_LENGTH } from "@/src/lib/validation";

type Room = "everyone" | "ours";
type Reaction = { emoji: string; count: number; reacted: boolean };
type ChatMessage = {
  id: string; displayName: string; content: string; createdAt: string;
  replyTo?: { id: string; displayName: string; content: string } | null;
  reactions: Reaction[];
};
const ROOMS: { id: Room; title: string; description: string }[] = [
  { id: "everyone", title: "Everyone", description: "The community room" },
  { id: "ours", title: "Ours", description: "A separate shared room" },
];
const EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🔥"];
const NAME_KEY = "chatting-web.display-name";
const ACTOR_KEY = "chatting-web.reaction-actor";

function getInitials(name: string) {
  return name.trim().split(/\s+/u).slice(0, 2).map((part) => [...part][0] ?? "").join("").toUpperCase();
}
function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
}
async function readMessages(room: Room, actorId: string, beforeId?: string) {
  const params = new URLSearchParams({ room, actorId, limit: "100" });
  if (beforeId) params.set("beforeId", beforeId);
  const response = await fetch("/api/messages?" + params.toString(), { cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Could not load messages.");
  return data as { messages: ChatMessage[]; hasMore: boolean };
}

export function ChatHub() {
  const [room, setRoom] = useState<Room>("everyone");
  const [actorId, setActorId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [nameDraft, setNameDraft] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasOlder, setHasOlder] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(false);
  const [reactionBusy, setReactionBusy] = useState<string | null>(null);
  const [showEmojiFor, setShowEmojiFor] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const activeRoom = useRef<Room>("everyone");

  useEffect(() => {
    try {
      setDisplayName(localStorage.getItem(NAME_KEY) ?? "");
      let id = localStorage.getItem(ACTOR_KEY);
      if (!id) {
        id = crypto.randomUUID();
        localStorage.setItem(ACTOR_KEY, id);
      }
      setActorId(id);
    } catch {
      setActorId(crypto.randomUUID());
    }
  }, []);

  useEffect(() => {
    activeRoom.current = room;
    setReplyingTo(null);
    setShowEmojiFor(null);
  }, [room]);

  const refresh = useCallback(async (currentRoom: Room, currentActor: string, initial = false) => {
    try {
      const page = await readMessages(currentRoom, currentActor);
      if (activeRoom.current !== currentRoom) return;
      setMessages(page.messages);
      setHasOlder(page.hasMore);
      setConnected(true);
      setError("");
      if (initial) setLoading(false);
    } catch (cause) {
      if (activeRoom.current !== currentRoom) return;
      setConnected(false);
      setError(cause instanceof Error ? cause.message : "The room could not connect.");
      if (initial) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!actorId) return;
    let stopped = false;
    setLoading(true);
    setMessages([]);
    void refresh(room, actorId, true);
    const poll = async () => {
      if (stopped) return;
      if (document.visibilityState === "visible") await refresh(room, actorId);
      if (!stopped) timer = window.setTimeout(poll, 3500);
    };
    let timer = window.setTimeout(poll, 3500);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [room, actorId, refresh]);

  useEffect(() => {
    if (pinned.current) bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  const saveName = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const clean = nameDraft.trim();
    if (!clean || clean.length > DISPLAY_NAME_MAX_LENGTH) return;
    setDisplayName(clean);
    try { localStorage.setItem(NAME_KEY, clean); } catch { /* Name remains active for this session. */ }
  };

  const sendMessage = async () => {
    const content = draft.trim();
    if (!displayName || !content || sending) return;
    setSending(true);
    setError("");
    try {
      const response = await fetch("/api/messages", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ room, displayName, content, replyToId: replyingTo?.id ?? null }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Message could not be sent.");
      setDraft("");
      setReplyingTo(null);
      pinned.current = true;
      await refresh(room, actorId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Message could not be sent.");
    } finally {
      setSending(false);
    }
  };

  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void sendMessage();
    }
  };

  const loadOlder = async () => {
    const first = messages[0];
    const list = listRef.current;
    if (!first || !list || loadingOlder) return;
    const oldHeight = list.scrollHeight;
    setLoadingOlder(true);
    try {
      const page = await readMessages(room, actorId, first.id);
      setMessages((current) => [...page.messages, ...current.filter((m) => !page.messages.some((p) => p.id === m.id))]);
      setHasOlder(page.hasMore);
      requestAnimationFrame(() => {
        if (listRef.current) listRef.current.scrollTop += listRef.current.scrollHeight - oldHeight;
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Earlier messages could not be loaded.");
    } finally {
      setLoadingOlder(false);
    }
  };

  const toggleReaction = async (messageId: string, emoji: string) => {
    if (!actorId || reactionBusy) return;
    setReactionBusy(messageId + emoji);
    try {
      const response = await fetch("/api/reactions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ room, messageId, emoji, actorId }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Reaction could not be saved.");
      await refresh(room, actorId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Reaction could not be saved.");
    } finally {
      setReactionBusy(null);
    }
  };

  const selectedRoom = useMemo(() => ROOMS.find((item) => item.id === room)!, [room]);

  return (
    <div className="mono-app">
      <aside className="mono-sidebar">
        <a className="mono-brand" href="/" aria-label="Chatting Web home">
          <span className="mono-brand-mark"><MessageCircle size={19} /></span>
          <span>chatting<span className="brand-light">web</span></span>
        </a>
        <div className="mono-overline">WORKSPACE</div>
        <nav className="mono-room-list" aria-label="Chat rooms">
          {ROOMS.map((item) => (
            <button key={item.id} type="button" className={"mono-room-link" + (room === item.id ? " active" : "")}
              onClick={() => setRoom(item.id)} aria-current={room === item.id ? "page" : undefined}>
              <span className="mono-room-icon">{item.id === "everyone" ? <Users size={17} /> : <MessageSquare size={17} />}</span>
              <span className="mono-room-label"><strong>{item.title}</strong><small>{item.description}</small></span>
              {room === item.id && <span className="mono-active-dot" />}
            </button>
          ))}
        </nav>
        <div className="mono-sidebar-note">
          <span className="mono-overline">A NOTE ABOUT OURS</span>
          <p>It’s a separate room with its own conversation. Anyone can join it for now.</p>
        </div>
        <div className="mono-profile">
          <div className="mono-avatar">{displayName ? getInitials(displayName) : "?"}</div>
          <div className="mono-profile-copy"><small>CHATTING AS</small><strong>{displayName || "Guest"}</strong></div>
          <button type="button" className="mono-edit-name" onClick={() => setNameDraft(displayName)} aria-label="Edit display name"><ArrowUpRight size={16} /></button>
        </div>
      </aside>

      <main className="mono-main">
        <header className="mono-header">
          <div className="mono-mobile-brand"><span className="mono-brand-mark"><MessageCircle size={17} /></span> chatting<span>web</span></div>
          <div className="mono-heading">
            <div className="mono-eyebrow"><span /> ROOM / {room === "everyone" ? "PUBLIC" : "SHARED"}</div>
            <h1>{selectedRoom.title}</h1>
            <p>{room === "everyone" ? "One conversation, open to everyone." : "A separate space for another conversation."}</p>
          </div>
          <div className={"mono-status " + (connected ? "is-online" : "is-offline")}>
            {connected ? <Wifi size={14} /> : <WifiOff size={14} />}
            {connected ? "Connected" : "Reconnecting"}
          </div>
        </header>

        <section className="mono-conversation" ref={listRef} onScroll={() => {
          const list = listRef.current;
          if (list) pinned.current = list.scrollHeight - list.clientHeight - list.scrollTop < 100;
        }}>
          <div className="mono-conversation-inner">
            <div className="mono-welcome">
              <div className="mono-welcome-icon">{room === "everyone" ? <Users size={20} /> : <MessageSquare size={20} />}</div>
              <div><span className="mono-overline">WELCOME TO {selectedRoom.title.toUpperCase()}</span>
                <h2>{room === "everyone" ? "Good conversations start here." : "A room of its own."}</h2>
                <p>{room === "everyone" ? "Say hello and join the shared conversation." : "This room has a separate message history from Everyone."}</p>
              </div>
            </div>

            {hasOlder && messages.length > 0 && <button className="mono-load-older" onClick={loadOlder} disabled={loadingOlder}>
              {loadingOlder ? <LoaderCircle className="mono-spin" size={15} /> : "↑"} Load earlier messages
            </button>}
            {loading && <div className="mono-empty"><LoaderCircle className="mono-spin" size={20} /> Loading conversation…</div>}
            {!loading && messages.length === 0 && <div className="mono-empty"><MessageCircle size={24} /><strong>It’s quiet in here.</strong><span>Start the conversation whenever you’re ready.</span></div>}
            {error && <div className="mono-error" role="alert">{error}</div>}

            <div className="mono-messages" role="log" aria-label={selectedRoom.title + " messages"} aria-live="polite">
              {messages.map((message) => (
                <article className="mono-message" key={message.id}>
                  <div className="mono-message-avatar">{getInitials(message.displayName)}</div>
                  <div className="mono-message-body">
                    <div className="mono-message-meta"><strong>{message.displayName}</strong><time dateTime={message.createdAt}>{formatTime(message.createdAt)}</time></div>
                    {message.replyTo && <div className="mono-reply-quote"><span>↳ {message.replyTo.displayName}</span><p>{message.replyTo.content}</p></div>}
                    <p className="mono-bubble">{message.content}</p>
                    <div className="mono-message-tools">
                      <button type="button" className="mono-tool-button" onClick={() => setReplyingTo(message)}><Reply size={13} /> Reply</button>
                      <button type="button" className="mono-tool-button" onClick={() => setShowEmojiFor(showEmojiFor === message.id ? null : message.id)}><SmilePlus size={13} /> React</button>
                    </div>
                    {showEmojiFor === message.id && <div className="mono-emoji-picker" aria-label="Choose a reaction">
                      {EMOJIS.map((emoji) => <button key={emoji} type="button" onClick={() => { void toggleReaction(message.id, emoji); setShowEmojiFor(null); }} aria-label={"React with " + emoji}>{emoji}</button>)}
                    </div>}
                    {message.reactions.length > 0 && <div className="mono-reactions">
                      {message.reactions.map((reaction) => <button key={reaction.emoji} type="button"
                        className={"mono-reaction" + (reaction.reacted ? " reacted" : "")}
                        disabled={reactionBusy === message.id + reaction.emoji}
                        onClick={() => void toggleReaction(message.id, reaction.emoji)}
                        aria-pressed={reaction.reacted}>
                        <span>{reaction.emoji}</span><small>{reaction.count}</small>
                      </button>)}
                    </div>}
                  </div>
                </article>
              ))}
              <div ref={bottomRef} />
            </div>
          </div>
        </section>

        <footer className="mono-composer-wrap">
          {replyingTo && <div className="mono-replying"><div><small>REPLYING TO {replyingTo.displayName.toUpperCase()}</small><span>{replyingTo.content}</span></div>
            <button type="button" onClick={() => setReplyingTo(null)} aria-label="Cancel reply"><X size={16} /></button></div>}
          {displayName ? <form className="mono-composer" onSubmit={(event) => { event.preventDefault(); void sendMessage(); }}>
            <label className="sr-only" htmlFor="mono-message">Write a message</label>
            <textarea id="mono-message" value={draft} maxLength={MESSAGE_MAX_LENGTH} rows={1}
              onChange={(event) => setDraft(event.target.value)} onKeyDown={onComposerKeyDown}
              placeholder={"Message " + selectedRoom.title + "…"} disabled={sending} />
            <div className="mono-composer-bottom"><span>ENTER TO SEND · SHIFT + ENTER FOR A NEW LINE</span>
              <small>{draft.length}/{MESSAGE_MAX_LENGTH}</small>
              <button type="submit" disabled={!draft.trim() || sending}>{sending ? <LoaderCircle className="mono-spin" size={16} /> : <Send size={16} />} Send</button>
            </div>
          </form> : <form className="mono-name-form" onSubmit={saveName}>
            <label htmlFor="mono-name">Choose a display name to join</label>
            <input id="mono-name" value={nameDraft} onChange={(event) => setNameDraft(event.target.value)}
              maxLength={DISPLAY_NAME_MAX_LENGTH} placeholder="Your name" />
            <button type="submit" disabled={!nameDraft.trim()}>Join chat <ArrowUpRight size={15} /></button>
          </form>}
          <p className="mono-footnote">No account needed. Your display name is not verified.</p>
        </footer>
      </main>
    </div>
  );
}
