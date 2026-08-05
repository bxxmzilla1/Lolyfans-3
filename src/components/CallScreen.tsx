"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { mediaUrl } from "@/lib/utils";
import { IconMic, IconPhone, IconPhoneOff, IconUser } from "./Icons";

/** Minimal typing for the browser SpeechRecognition API (not in lib.dom). */
type SpeechResultEvent = {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
};
type SpeechRec = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: SpeechResultEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  start: () => void;
  stop: () => void;
};

function makeRecognition(): SpeechRec | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRec;
    webkitSpeechRecognition?: new () => SpeechRec;
  };
  const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

function mmss(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

type Phase = "idle" | "starting" | "live" | "ended";
type LiveStatus = "listening" | "thinking" | "speaking";

/**
 * Fan-side voice call with the creator's chatbot ($1/min).
 *
 * The loop that makes it feel like a call: the browser transcribes speech
 * locally (SpeechRecognition — zero upload latency), each finished sentence
 * is one round trip to /api/call/turn (which returns the chatbot's text the
 * moment it answers), and the reply audio STREAMS from /api/call/tts so
 * playback starts on the first chunk instead of after full generation.
 */
export default function CallScreen({
  ownerName,
  avatarPath,
  hasCard,
  voiceReady,
}: {
  ownerName: string;
  avatarPath: string | null;
  hasCard: boolean;
  voiceReady: boolean;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [status, setStatus] = useState<LiveStatus>("listening");
  const [error, setError] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [minutes, setMinutes] = useState(0);
  const [fanCaption, setFanCaption] = useState("");
  const [botCaption, setBotCaption] = useState("");
  const [supported, setSupported] = useState(true);

  const callIdRef = useRef<string | null>(null);
  const recRef = useRef<SpeechRec | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const phaseRef = useRef<Phase>("idle");
  const statusRef = useRef<LiveStatus>("listening");
  phaseRef.current = phase;
  statusRef.current = status;

  useEffect(() => {
    setSupported(!!makeRecognition());
  }, []);

  const stopRecognition = useCallback(() => {
    const rec = recRef.current;
    if (rec) {
      rec.onend = null;
      try {
        rec.stop();
      } catch {
        // already stopped
      }
      recRef.current = null;
    }
  }, []);

  const finishCall = useCallback(
    (message?: string) => {
      stopRecognition();
      audioRef.current?.pause();
      audioRef.current = null;
      if (message) setError(message);
      setPhase("ended");
      const callId = callIdRef.current;
      if (callId) {
        void fetch("/api/call/end", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ callId }),
        }).catch(() => {});
      }
    },
    [stopRecognition]
  );

  // ---- speech → turn → spoken reply -------------------------------------
  const startListening = useCallback(function startListening() {
    const rec = makeRecognition();
    if (!rec) return;
    stopRef.current();
    recRef.current = rec;
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = navigator.language || "en-US";
    rec.onresult = (e) => {
      let interim = "";
      let finalText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interim += r[0].transcript;
      }
      if (interim) setFanCaption(interim.trim());
      const said = finalText.trim();
      if (said) {
        setFanCaption(said);
        void sendRef.current(said);
      }
    };
    // Chrome ends recognition after silence — keep it running for the call.
    rec.onend = () => {
      if (phaseRef.current === "live" && statusRef.current === "listening") {
        startListening();
      }
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        finishRef.current("Microphone access was blocked — allow it and call again.");
      }
    };
    try {
      rec.start();
    } catch {
      // start() throws if called while already running — harmless
    }
    // Flip the ref synchronously: speech landing before the re-render must
    // already count as "listening" or it would be dropped.
    statusRef.current = "listening";
    setStatus("listening");
  }, []);

  const sendTurn = useCallback(
    async (text: string) => {
      const callId = callIdRef.current;
      if (!callId || statusRef.current !== "listening") return;
      // Synchronous flip so two rapid-fire final results can't double-send.
      statusRef.current = "thinking";
      setStatus("thinking");
      stopRecognition();
      try {
        const res = await fetch("/api/call/turn", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ callId, text }),
        });
        const data = await res.json().catch(() => ({}));
        if (phaseRef.current !== "live") return;
        if (!res.ok) {
          if (res.status === 409) finishCall("The call has ended.");
          else startListening();
          return;
        }
        if (!data.reply) {
          // Chatbot didn't answer in time — keep the line open.
          startListening();
          return;
        }
        setBotCaption(String(data.reply));
        setStatus("speaking");
        const audio = new Audio(
          `/api/call/tts?turn=${encodeURIComponent(data.turnId)}`
        );
        audioRef.current = audio;
        const resume = () => {
          if (phaseRef.current === "live") startListening();
        };
        audio.onended = resume;
        audio.onerror = resume;
        void audio.play().catch(resume);
      } catch {
        if (phaseRef.current === "live") startListening();
      }
    },
    [finishCall, startListening, stopRecognition]
  );

  // Refs so startListening/sendTurn can reference each other without a
  // dependency cycle.
  const sendRef = useRef(sendTurn);
  const stopRef = useRef(stopRecognition);
  const finishRef = useRef(finishCall);
  sendRef.current = sendTurn;
  stopRef.current = stopRecognition;
  finishRef.current = finishCall;

  // ---- start / timers -----------------------------------------------------
  async function start() {
    if (phase !== "idle") return;
    setError("");
    setPhase("starting");
    try {
      const res = await fetch("/api/call/start", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPhase("idle");
        setError(data.error || "Could not start the call");
        return;
      }
      callIdRef.current = data.callId;
      setMinutes(1);
      setElapsed(0);
      setFanCaption("");
      setBotCaption("");
      setPhase("live");
      startListening();
    } catch {
      setPhase("idle");
      setError("Could not start the call");
    }
  }

  // Second counter + per-minute billing tick while live.
  useEffect(() => {
    if (phase !== "live") return;
    const secTimer = setInterval(() => setElapsed((s) => s + 1), 1000);
    const tickTimer = setInterval(async () => {
      const callId = callIdRef.current;
      if (!callId) return;
      try {
        const res = await fetch("/api/call/tick", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ callId }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) setMinutes(data.minutesCharged ?? 0);
        else finishRef.current(data.error || "The call has ended.");
      } catch {
        // transient network error — the next tick retries
      }
    }, 60_000);
    return () => {
      clearInterval(secTimer);
      clearInterval(tickTimer);
    };
  }, [phase]);

  // Closing the tab still ends (and stops billing) the call.
  useEffect(() => {
    const onLeave = () => {
      const callId = callIdRef.current;
      if (callId && phaseRef.current === "live") {
        navigator.sendBeacon(
          "/api/call/end",
          new Blob([JSON.stringify({ callId })], { type: "application/json" })
        );
      }
    };
    window.addEventListener("pagehide", onLeave);
    return () => window.removeEventListener("pagehide", onLeave);
  }, []);

  useEffect(() => stopRecognition, [stopRecognition]);

  // ---- UI -----------------------------------------------------------------
  const statusLabel =
    status === "listening"
      ? "Listening — just talk"
      : status === "thinking"
      ? `${ownerName} is thinking…`
      : `${ownerName} is speaking`;

  return (
    <div className="min-h-dvh bg-bg text-fg flex flex-col items-center justify-between p-6">
      {/* Top: rate + live meter */}
      <div className="w-full max-w-sm flex items-center justify-between text-xs text-muted">
        <span className="px-2.5 py-1 rounded-full bg-card2 border border-line font-semibold">
          $1/min
        </span>
        {phase === "live" && (
          <span className="px-2.5 py-1 rounded-full bg-card2 border border-line font-semibold tabular-nums">
            {mmss(elapsed)} · ${minutes}
          </span>
        )}
      </div>

      {/* Middle: avatar + status + captions */}
      <div className="flex flex-col items-center gap-4 w-full max-w-sm text-center">
        <div className="relative">
          {phase === "live" && status === "speaking" && (
            <>
              <span className="call-ring absolute inset-0 rounded-full bg-accent/40" />
              <span className="call-ring call-ring-delay absolute inset-0 rounded-full bg-accent/30" />
            </>
          )}
          <div
            className={`relative w-28 h-28 rounded-full overflow-hidden border-2 ${
              phase === "live" ? "border-accent" : "border-line"
            } bg-card2 flex items-center justify-center`}
          >
            {avatarPath ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={mediaUrl(avatarPath)}
                alt={ownerName}
                className="w-full h-full object-cover"
              />
            ) : (
              <IconUser className="w-10 h-10 text-muted" />
            )}
          </div>
        </div>

        <div>
          <p className="text-xl font-extrabold">{ownerName}</p>
          <p className="text-sm text-muted mt-0.5">
            {phase === "idle" && "Voice call"}
            {phase === "starting" && "Connecting…"}
            {phase === "live" && statusLabel}
            {phase === "ended" &&
              `Call ended · ${mmss(elapsed)} · $${minutes}`}
          </p>
        </div>

        {phase === "live" && (
          <div className="w-full space-y-2 min-h-20">
            {fanCaption && (
              <p className="text-sm text-muted">
                <span className="font-semibold text-fg/70">You:</span>{" "}
                {fanCaption}
              </p>
            )}
            {botCaption && (
              <p className="text-sm text-accent">
                <span className="font-semibold">{ownerName}:</span> {botCaption}
              </p>
            )}
          </div>
        )}

        {phase === "live" && status === "listening" && (
          <span className="flex items-center gap-1.5 text-xs text-green-400">
            <IconMic className="w-3.5 h-3.5" />
            Mic on
          </span>
        )}

        {error && <p className="text-sm text-red-400">{error}</p>}
        {!supported && (
          <p className="text-sm text-amber-400">
            Your browser doesn&apos;t support live speech — try Chrome or Safari.
          </p>
        )}
        {!voiceReady && (
          <p className="text-sm text-muted">
            Voice calls aren&apos;t available on this profile yet.
          </p>
        )}
        {voiceReady && !hasCard && phase === "idle" && (
          <p className="text-sm text-muted">
            Calls need a saved card — unlock any paid content or top up once
            and your card is saved automatically.
          </p>
        )}
      </div>

      {/* Bottom: call controls */}
      <div className="flex flex-col items-center gap-3 pb-[env(safe-area-inset-bottom)]">
        {phase === "live" || phase === "starting" ? (
          <button
            type="button"
            onClick={() => finishCall()}
            aria-label="Hang up"
            className="w-16 h-16 rounded-full bg-red-500 text-white flex items-center justify-center shadow-lg active:scale-95 transition-transform"
          >
            <IconPhoneOff className="w-7 h-7" />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => (phase === "ended" ? router.push("/chat") : void start())}
            disabled={phase === "idle" && (!supported || !voiceReady || !hasCard)}
            className={`h-14 px-8 rounded-full font-bold flex items-center gap-2.5 shadow-lg active:scale-95 transition-transform disabled:opacity-40 ${
              phase === "ended"
                ? "bg-card2 border border-line text-fg"
                : "bg-green-500 text-white"
            }`}
          >
            <IconPhone className="w-5 h-5" />
            {phase === "ended" ? "Back to chat" : "Call · $1/min"}
          </button>
        )}
        {phase === "idle" && (
          <button
            type="button"
            onClick={() => router.push("/chat")}
            className="text-sm text-muted"
          >
            Back to chat
          </button>
        )}
      </div>
    </div>
  );
}
