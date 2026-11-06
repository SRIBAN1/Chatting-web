"use client";

import {
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  ArrowDown,
  ArrowUpRight,
  Check,
  ChevronRight,
  CircleHelp,
  Database,
  Hash,
  LoaderCircle,
  MessageCircle,
  MessagesSquare,
  RefreshCw,
  Reply,
  Send,
  ShieldCheck,
  UserRound,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import { DISPLAY_NAME_MAX_LENGTH, MESSAGE_MAX_LENGTH } from "@/src/lib/validation";

type ChatMessage = {
  id: string;
  displayName: string;
  content: string;
  createdAt: string;
  replyTo?: { id: string; displayName: string; content: string } | null;
};

type MessagePage = {
  messages: ChatMessage[];
  hasMore: boolean;
  error?: string;
};

type ConnectionState = "connecting" | "connected" | "offline";

const NAME_STORAGE_KEY = "chatting-web.display-name";
const MESSAGE_ID_ORDER = new Intl.Collator(undefined, { numeric: true });

function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]) {
  const byId = new Map<string, ChatMessage>();
  for (const message of current) byId.set(message.id, message);
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort((left, right) => MESSAGE_ID_ORDER.compare(left.id, right.id));
}

async function requestMessages(path: string, signal?: AbortSignal): Promise<MessagePage> {
  const response = await fetch(path, { cache: "no-store", signal });
  const payload = (await response.json().catch(() => null)) as MessagePage | null;
  if (!response.ok || !payload) {
    throw new Error(payload?.error || "The room could not load messages.");
  }
  return payload;
}

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/u)
    .slice(0, 2)
    .map((part) => [...part][0] ?? "")
    .join("")
    .toLocaleUpperCase();
}

function nameHue(name: string) {
  let hash = 0;
  for (const character of name) hash = (hash * 31 + character.charCodeAt(0)) | 0;
  return Math.abs(hash) % 360;
}

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
}

function localDayKey(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function dateLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Conversation";

  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (localDayKey(value) === localDayKey(today.toISOString())) return "Today";
  if (localDayKey(value) === localDayKey(yesterday.toISOString())) return "Yesterday";
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: date.getFullYear() === today.getFullYear() ? undefined : "numeric",
  }).format(date);
}

function displayNameError(name: string) {
  const cleanName = name.trim();
  if (!cleanName) return "Add a name so people know who is speaking.";
  if (cleanName.length > DISPLAY_NAME_MAX_LENGTH) {
    return `Keep your name to ${DISPLAY_NAME_MAX_LENGTH} characters or fewer.`;
  }
  if (/[\u0000-\u001F\u007F]/u.test(cleanName)) {
    return "Names cannot contain control characters.";
  }
  return "";
}

export function ChatRoom() {
  const [displayName, setDisplayName] = useState("");
  const [nameDraft, setNameDraft] = useState("");
  const [nameError, setNameError] = useState("");
  const [isEditingName, setIsEditingName] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [connectionError, setConnectionError] = useState("");
  const [sendError, setSendError] = useState("");
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [sending, setSending] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const latestMessageId = useRef("0");
  const messageListRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const nameDialogRef = useRef<HTMLDialogElement>(null);
  const pinnedToBottom = useRef(true);

  useEffect(() => {
    try {
      const savedName = window.localStorage.getItem(NAME_STORAGE_KEY) ?? "";
      setDisplayName(savedName);
      setNameDraft(savedName);
    } catch {
      setDisplayName("");
    }
  }, []);

  useEffect(() => {
    const dialog = nameDialogRef.current;
    if (isEditingName) {
      if (dialog && !dialog.open) dialog.showModal();
      return;
    }
    if (dialog?.open) dialog.close();
  }, [isEditingName]);

  useEffect(() => {
    if (!isEditingName) return;
    const timeout = window.setTimeout(() => nameInputRef.current?.focus(), 40);
    return () => window.clearTimeout(timeout);
  }, [isEditingName]);

  useEffect(() => {
    const controller = new AbortController();
    setConnection("connecting");
    setConnectionError("");

    void requestMessages("/api/messages?limit=50", controller.signal)
      .then((page) => {
        if (controller.signal.aborted) return;
        setMessages(page.messages);
        setHasOlderMessages(page.hasMore);
        latestMessageId.current = page.messages.at(-1)?.id ?? "0";
        setConnection("connected");
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setConnection("offline");
        setConnectionError(error instanceof Error ? error.message : "The room could not connect.");
      });

    return () => controller.abort();
  }, [retryCount]);

  useEffect(() => {
    if (connection !== "connected") return;
    let stopped = false;
    let timer: number | undefined;

    const poll = async () => {
      if (document.visibilityState === "visible") {
        try {
          let cursor = latestMessageId.current || "0";
          let pageCount = 0;
          let hasMore = true;

          while (hasMore && pageCount < 5 && !stopped) {
            const params = new URLSearchParams({ afterId: cursor, limit: "100" });
            const page = await requestMessages(`/api/messages?${params.toString()}`);
            if (page.messages.length === 0) break;

            setMessages((existing) => mergeMessages(existing, page.messages));
            cursor = page.messages.at(-1)?.id ?? cursor;
            latestMessageId.current = cursor;
            hasMore = page.hasMore;
            pageCount += 1;
          }
        } catch (error) {
          if (!stopped) {
            setConnection("offline");
            setConnectionError(error instanceof Error ? error.message : "The room lost its connection.");
          }
        }
      }

      if (!stopped) timer = window.setTimeout(poll, 3500);
    };

    timer = window.setTimeout(poll, 3500);
    return () => {
      stopped = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [connection]);

  useEffect(() => {
    if (pinnedToBottom.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [messages]);

  const saveName = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const validationError = displayNameError(nameDraft);
      if (validationError) {
        setNameError(validationError);
        return;
      }

      const cleanName = nameDraft.trim();
      try {
        window.localStorage.setItem(NAME_STORAGE_KEY, cleanName);
      } catch {
        // The chosen name remains usable for this page even if browser storage is disabled.
      }
      setDisplayName(cleanName);
      setNameDraft(cleanName);
      setNameError("");
      setIsEditingName(false);
    },
    [nameDraft],
  );

  const sendMessage = useCallback(async () => {
    const content = draft.trim();
    const cleanName = displayName.trim();
    if (!cleanName) {
      setNameDraft("");
      setIsEditingName(true);
      return;
    }
    if (!content || sending) return;

    setSending(true);
    setSendError("");
    try {
      const response = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: cleanName, content, replyToId: replyingTo?.id ?? null }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { message?: ChatMessage; error?: string }
        | null;

      if (!response.ok || !payload?.message) {
        const error = payload?.error || "Your message could not be saved. Try again.";
        setSendError(error);
        if (response.status >= 500) {
          setConnection("offline");
          setConnectionError(error);
        }
        return;
      }

      latestMessageId.current = payload.message.id;
      setMessages((existing) => mergeMessages(existing, [payload.message as ChatMessage]));
      setDraft("");
      setReplyingTo(null);
      pinnedToBottom.current = true;
      setSendError("");
    } catch {
      setSendError("Your message could not be sent. Check your connection and try again.");
      setConnection("offline");
      setConnectionError("The room lost its connection. Your message was not saved.");
    } finally {
      setSending(false);
    }
  }, [displayName, draft, replyingTo, sending]);

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void sendMessage();
    }
  };

  const loadEarlier = async () => {
    const firstMessage = messages[0];
    const list = messageListRef.current;
    if (!firstMessage || !list || loadingOlder) return;

    const previousHeight = list.scrollHeight;
    const previousTop = list.scrollTop;
    setLoadingOlder(true);
    try {
      const params = new URLSearchParams({ beforeId: firstMessage.id, limit: "50" });
      const page = await requestMessages(`/api/messages?${params.toString()}`);
      setMessages((existing) => mergeMessages(page.messages, existing));
      setHasOlderMessages(page.hasMore);
      window.requestAnimationFrame(() => {
        if (messageListRef.current) {
          messageListRef.current.scrollTop = previousTop + messageListRef.current.scrollHeight - previousHeight;
        }
      });
    } catch (error) {
      setSendError(error instanceof Error ? error.message : "Earlier messages could not be loaded.");
    } finally {
      setLoadingOlder(false);
    }
  };

  const handleScroll = () => {
    const list = messageListRef.current;
    if (!list) return;
    pinnedToBottom.current = list.scrollHeight - list.clientHeight - list.scrollTop < 120;
  };

  const retryConnection = () => setRetryCount((count) => count + 1);
  const avatarStyle = (name: string): CSSProperties => ({ "--avatar-hue": nameHue(name) } as CSSProperties);

  return (
    <div className="chat-shell">
      <aside className="sidebar" aria-label="Room information">
        <a className="brand" href="/" aria-label="Chatting Web home">
          <img className="brand-mark" src="/chat-mark.svg" alt="" />
          <span className="brand-wordmark">chatting<span>web</span></span>
        </a>

        <div className="sidebar-section-label">YOUR SPACE</div>
        <div className="room-nav-card" aria-current="page">
          <span className="room-nav-icon"><Hash size={17} strokeWidth={2.4} /></span>
          <span className="room-nav-copy">
            <strong>The Lobby</strong>
            <small>One room for everyone</small>
          </span>
          <span className="room-nav-dot" aria-label="Public room" />
        </div>

        <div className="sidebar-note">
          <div className="note-icon"><MessagesSquare size={18} /></div>
          <p className="sidebar-section-label">A LITTLE CONTEXT</p>
          <p>Drop in, say hello, and pick up the conversation whenever you like.</p>
          <div className="saved-note"><Database size={14} /><span>Messages stay in the shared history</span></div>
        </div>

        <div className="sidebar-bottom">
          <div className="profile-card">
            <div className="profile-avatar" style={displayName ? avatarStyle(displayName) : undefined}>
              {displayName ? initials(displayName) : <UserRound size={18} />}
            </div>
            <div className="profile-copy">
              <span className="profile-caption">YOU ARE CHATTING AS</span>
              <strong>{displayName || "A guest"}</strong>
            </div>
            <button
              className="icon-button profile-edit"
              type="button"
              onClick={() => {
                setNameDraft(displayName);
                setNameError("");
                setIsEditingName(true);
              }}
              aria-label={displayName ? "Change display name" : "Choose a display name"}
              title={displayName ? "Change display name" : "Choose a display name"}
            >
              <ArrowUpRight size={16} />
            </button>
          </div>
          <div className="sidebar-footnote"><ShieldCheck size={14} /><span>No account. Just a name.</span></div>
        </div>
      </aside>

      <main className="chat-main">
        <div className="mobile-topbar">
          <a className="mobile-brand" href="/" aria-label="Chatting Web home">
            <img src="/chat-mark.svg" alt="" />
            <span>chatting<span>web</span></span>
          </a>
          <button
            className="mobile-name-button"
            type="button"
            onClick={() => {
              setNameDraft(displayName);
              setNameError("");
              setIsEditingName(true);
            }}
            aria-label={displayName ? `Change display name, currently ${displayName}` : "Choose a display name"}
          >
            <UserRound size={16} />
            <span>{displayName || "Choose a name"}</span>
          </button>
        </div>

        <header className="room-header">
          <div className="room-heading">
            <div className="room-kicker"><span className="room-kicker-line" /> OPEN ROOM <span className="room-kicker-separator">/</span> NO SIGN-UP</div>
            <h1>The Lobby</h1>
            <p>A shared room for whatever is on your mind.</p>
          </div>
          <div className={`connection-pill connection-${connection}`} aria-live="polite">
            {connection === "connected" ? <Wifi size={15} /> : connection === "offline" ? <WifiOff size={15} /> : <LoaderCircle className="spin" size={15} />}
            <span>{connection === "connected" ? "Connected" : connection === "offline" ? "Reconnecting" : "Connecting"}</span>
          </div>
        </header>

        <div className="conversation" ref={messageListRef} onScroll={handleScroll} aria-label="Chat conversation">
          <div className="conversation-inner">
            <div className="room-intro">
              <div className="intro-mark"><MessageCircle size={22} /></div>
              <div>
                <p className="intro-label">YOU FOUND THE ROOM</p>
                <h2>Good conversations start somewhere.</h2>
                <p>Say what you like. Everyone here can read the shared conversation.</p>
              </div>
            </div>

            {connection === "offline" && (
              <div className="connection-alert" role="alert">
                <div className="connection-alert-icon"><Database size={18} /></div>
                <div className="connection-alert-copy">
                  <strong>The room can’t reach its database.</strong>
                  <span>{connectionError || "Check the PostgreSQL connection and try again."}</span>
                </div>
                <button className="retry-button" type="button" onClick={retryConnection}>
                  <RefreshCw size={14} /> <span>Try again</span>
                </button>
              </div>
            )}

            {hasOlderMessages && messages.length > 0 && (
              <div className="older-row">
                <button className="older-button" type="button" onClick={loadEarlier} disabled={loadingOlder}>
                  {loadingOlder ? <LoaderCircle className="spin" size={15} /> : <ArrowDown size={15} />}
                  <span>{loadingOlder ? "Loading earlier messages" : "Load earlier messages"}</span>
                </button>
              </div>
            )}

            {connection === "connecting" && messages.length === 0 && (
              <div className="loading-state" role="status">
                <LoaderCircle className="spin" size={18} />
                <span>Restoring the conversation…</span>
              </div>
            )}

            {connection === "connected" && messages.length === 0 && (
              <div className="empty-state">
                <div className="empty-state-icon"><MessageCircle size={23} /></div>
                <strong>This room is ready when you are.</strong>
                <span>Be the first to start the conversation.</span>
              </div>
            )}

            <div className="message-list" role="log" aria-label="Messages, shown in chronological order" aria-live="polite" aria-relevant="additions">
              {messages.map((message, index) => {
                const showDate = index === 0 || localDayKey(messages[index - 1].createdAt) !== localDayKey(message.createdAt);
                return (
                  <Fragment key={message.id}>
                    {showDate && <div className="date-divider"><span>{dateLabel(message.createdAt)}</span></div>}
                    <article className="message-row">
                      <div className="message-avatar" style={avatarStyle(message.displayName)} aria-hidden="true">
                        {initials(message.displayName)}
                      </div>
                      <div className="message-content">
                        <div className="message-meta">
                          <span className="message-sender">{message.displayName}</span>
                          <time className="message-time" dateTime={message.createdAt} title={new Date(message.createdAt).toLocaleString()}>
                            {formatTime(message.createdAt)}
                          </time>
                        </div>
                        {message.replyTo && (
                          <div className="reply-context" aria-label={`Reply to ${message.replyTo.displayName}`}>
                            <span>Replying to {message.replyTo.displayName}</span>
                            <p>{message.replyTo.content}</p>
                          </div>
                        )}
                        <p className="message-bubble">{message.content}</p>
                        <button
                          className="message-reply-button"
                          type="button"
                          onClick={() => {
                            setReplyingTo(message);
                            document.getElementById("chat-message")?.focus();
                          }}
                          aria-label={`Reply to ${message.displayName}'s message`}
                        >
                          <Reply size={13} /> Reply
                        </button>
                      </div>
                    </article>
                  </Fragment>
                );
              })}
              <div ref={bottomRef} className="conversation-bottom" />
            </div>
          </div>
        </div>

        <footer className="composer-area">
          <div className="composer-inner">
            {displayName ? (
              <form
                className="composer"
                onSubmit={(event) => {
                  event.preventDefault();
                  void sendMessage();
                }}
              >
                {replyingTo && (
                  <div className="reply-composer">
                    <div className="reply-composer-copy">
                      <span>Replying to {replyingTo.displayName}</span>
                      <p>{replyingTo.content}</p>
                    </div>
                    <button className="icon-button reply-cancel" type="button" onClick={() => setReplyingTo(null)} aria-label="Cancel reply">
                      <X size={16} />
                    </button>
                  </div>
                )}
                <label className="sr-only" htmlFor="chat-message">Write a message</label>
                <textarea
                  id="chat-message"
                  value={draft}
                  onChange={(event) => {
                    setDraft(event.target.value);
                    if (sendError) setSendError("");
                  }}
                  onKeyDown={handleComposerKeyDown}
                  placeholder={`Write a message as ${displayName}…`}
                  maxLength={MESSAGE_MAX_LENGTH}
                  rows={1}
                  aria-describedby="composer-hint message-error"
                  disabled={sending}
                />
                <div className="composer-actions">
                  <span className="composer-hint" id="composer-hint">Enter to send <span>·</span> Shift + Enter for a new line</span>
                  <span className="character-count">{draft.length}/{MESSAGE_MAX_LENGTH}</span>
                  <button className="send-button" type="submit" disabled={!draft.trim() || sending} aria-label="Send message">
                    {sending ? <LoaderCircle className="spin" size={17} /> : <Send size={17} />}
                    <span>{sending ? "Sending" : "Send"}</span>
                  </button>
                </div>
                <div className="send-error" id="message-error" role="alert">{sendError}</div>
              </form>
            ) : (
              <div className="join-panel">
                <div className="join-copy">
                  <div className="join-icon"><UserRound size={18} /></div>
                  <div>
                    <strong>Choose a name to join the conversation.</strong>
                    <span>No account or password required.</span>
                  </div>
                </div>
                <button
                  className="join-button"
                  type="button"
                  onClick={() => {
                    setNameDraft("");
                    setNameError("");
                    setIsEditingName(true);
                  }}
                >
                  Pick a name <ChevronRight size={16} />
                </button>
              </div>
            )}
            <p className="composer-privacy"><CircleHelp size={13} /> Your name is a display name, not a verified account.</p>
          </div>
        </footer>
      </main>

      {isEditingName && (
        <dialog
          ref={nameDialogRef}
          className="name-dialog"
          aria-labelledby="name-dialog-title"
          onCancel={(event) => {
            event.preventDefault();
            setIsEditingName(false);
          }}
        >
          <div className="dialog-topline"><span>STEP INTO THE ROOM</span><button className="icon-button dialog-close" type="button" onClick={() => setIsEditingName(false)} aria-label="Close name dialog"><X size={18} /></button></div>
          <div className="dialog-icon"><UserRound size={21} /></div>
          <h2 id="name-dialog-title">What should we call you?</h2>
          <p>Choose the name that will appear beside your messages. No account or password needed.</p>
          <form onSubmit={saveName}>
            <label htmlFor="display-name">Your display name</label>
            <input
              ref={nameInputRef}
              id="display-name"
              name="displayName"
              value={nameDraft}
              onChange={(event) => {
                setNameDraft(event.target.value);
                if (nameError) setNameError("");
              }}
              maxLength={DISPLAY_NAME_MAX_LENGTH}
              autoComplete="nickname"
              placeholder="e.g. Alex"
            />
            <div className="dialog-field-meta"><span className="name-error" role="alert">{nameError}</span><span>{nameDraft.length}/{DISPLAY_NAME_MAX_LENGTH}</span></div>
            <div className="dialog-actions">
              <button className="dialog-cancel" type="button" onClick={() => setIsEditingName(false)}>Not now</button>
              <button className="dialog-save" type="submit">Join the room <ArrowUpRight size={16} /></button>
            </div>
          </form>
        </dialog>
      )}
    </div>
  );
}
