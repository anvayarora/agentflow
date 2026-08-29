"use client";

import { useEffect, useRef, useState } from "react";

type Profile = { id: string; displayName: string; description: string; speakerId: string; languageSupport: string[]; tonePreset: string; pacePreset: string; isMerchantDefault: boolean };
type VoiceState = "IDLE" | "LISTENING" | "PROCESSING_SPEECH" | "THINKING" | "EXECUTING_ACTION" | "SPEAKING" | "WAITING_FOR_SHOPPER" | "ERROR";

const stateCopy: Record<VoiceState, string> = { IDLE: "Tap the microphone when you’re ready.", LISTENING: "Listening…", PROCESSING_SPEECH: "Understanding…", THINKING: "Finding the right next step…", EXECUTING_ACTION: "Updating the store…", SPEAKING: "Speaking…", WAITING_FOR_SHOPPER: "Your turn.", ERROR: "Voice is unavailable. You can keep chatting by text." };

export default function VoiceSalesperson({ initialSessionId }: { initialSessionId?: string | null }) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selected, setSelected] = useState<Profile | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(initialSessionId || null);
  const [language, setLanguage] = useState("en-IN");
  const [state, setState] = useState<VoiceState>("IDLE");
  const [text, setText] = useState("");
  const [transcript, setTranscript] = useState("");
  const [lastReply, setLastReply] = useState("");
  const [voiceOn, setVoiceOn] = useState(true);
  const [message, setMessage] = useState("");
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const audio = useRef<HTMLAudioElement | null>(null);

  useEffect(() => { const timer = window.setTimeout(() => { void fetch("/api/salespeople").then((response) => response.json() as Promise<{ profiles?: Profile[] }>).then(async (body) => { const next = body.profiles || []; const defaultProfile = next.find((profile) => profile.isMerchantDefault) || next[0] || null; setProfiles(next); setSelected(defaultProfile); if (!sessionId && defaultProfile && initialSessionId) { const sessionResponse = await fetch("/api/voice/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: initialSessionId, salespersonProfileId: defaultProfile.id, language, voiceEnabled: false, selectorOpened: true }) }); const sessionBody = await sessionResponse.json() as { sessionId?: string }; if (sessionResponse.ok && sessionBody.sessionId) setSessionId(sessionBody.sessionId); } }).catch(() => setMessage("Salesperson selector is unavailable.")); }, 0); return () => window.clearTimeout(timer); }, [initialSessionId, sessionId, language]);

  const ensureSession = async () => {
    if (sessionId) return sessionId;
    const response = await fetch("/api/voice/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ salespersonProfileId: selected?.id, language, voiceEnabled: voiceOn, selectorOpened: true }) });
    const body = await response.json() as { sessionId?: string; salesperson?: Profile; error?: string };
    if (!response.ok || !body.sessionId) throw new Error(body.error || "Voice session unavailable.");
    setSessionId(body.sessionId); if (body.salesperson) setSelected(body.salesperson); return body.sessionId;
  };

  const selectProfile = async (profile: Profile) => { setSelected(profile); setMessage(""); try { await fetch("/api/voice/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: sessionId || undefined, salespersonProfileId: profile.id, language, voiceEnabled: voiceOn }) }); } catch { setMessage("Could not save that salesperson choice."); } };
  const preview = async (profile: Profile) => { setMessage(""); try { const response = await fetch("/api/voice/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ salespersonProfileId: profile.id, language, preview: true, text: "Hi, I’m your AgentFlow AI salesperson. Tell me what you’re shopping for." }) }); const body = await response.json() as { audioBase64?: string; mimeType?: string; error?: string }; if (!response.ok || !body.audioBase64) throw new Error(body.error || "Voice preview unavailable."); audio.current?.pause(); audio.current = new Audio(`data:${body.mimeType || "audio/wav"};base64,${body.audioBase64}`); await audio.current.play(); } catch (error) { setMessage(error instanceof Error ? error.message : "Voice preview unavailable."); } };

  const sendTurn = async (value: string, inputMode: "text" | "voice" = "text") => {
    const request = value.trim(); if (!request) return;
    setTranscript(request); setText(""); setState("THINKING"); setMessage("");
    try { const currentSession = await ensureSession(); const response = await fetch("/api/voice/turn", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: currentSession, salespersonProfileId: selected?.id, language, voiceEnabled: voiceOn, inputMode, message: request, storefrontContext: { pageType: "home", url: window.location.href } }) }); const body = await response.json() as { message?: string; products?: Array<{ id?: string }>; ui?: { type?: string }; voice?: { audioBase64?: string; mimeType?: string; error?: string }; error?: string }; if (!response.ok && !body.message) throw new Error(body.error || "The salesperson is unavailable."); const reply = body.message || "I can keep helping by text."; setLastReply(reply); if (body.voice?.audioBase64 && voiceOn) { setState("SPEAKING"); audio.current?.pause(); audio.current = new Audio(`data:${body.voice.mimeType || "audio/wav"};base64,${body.voice.audioBase64}`); audio.current.onended = () => setState("WAITING_FOR_SHOPPER"); await audio.current.play(); } else setState("WAITING_FOR_SHOPPER"); applySemanticAction(request, body.products || [], body.ui?.type); } catch (error) { setState("ERROR"); setMessage(error instanceof Error ? error.message : "The salesperson is unavailable."); }
  };

  const toggleMic = async () => {
    if (state === "SPEAKING") { audio.current?.pause(); audio.current = null; setState("IDLE"); }
    if (recorder.current) { recorder.current.stop(); return; }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") { setMessage("This browser does not provide microphone input. Use the text box below."); setState("ERROR"); return; }
    try { const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); const next = new MediaRecorder(stream); chunks.current = []; next.ondataavailable = (event) => { if (event.data.size) chunks.current.push(event.data); }; next.onstop = async () => { stream.getTracks().forEach((track) => track.stop()); recorder.current = null; setState("PROCESSING_SPEECH"); try { const form = new FormData(); form.append("file", new Blob(chunks.current, { type: next.mimeType || "audio/webm" }), "voice-turn.webm"); if (sessionId) form.append("sessionId", sessionId); const response = await fetch("/api/voice/stt", { method: "POST", body: form }); const body = await response.json() as { transcript?: string; error?: string }; if (!response.ok || !body.transcript) throw new Error(body.error || "No speech was detected."); setState("EXECUTING_ACTION"); await sendTurn(body.transcript, "voice"); } catch (error) { setState("ERROR"); setMessage(error instanceof Error ? error.message : "Voice input failed."); } }; recorder.current = next; next.start(); setState("LISTENING"); } catch { setState("ERROR"); setMessage("Microphone permission is needed for voice shopping."); }
  };

  return <section className="voice-salesperson-panel" aria-label="AI salesperson"><div className="voice-panel-heading"><div><span className="customer-section-label">Shop with a salesperson</span><h2>Choose who walks the store with you.</h2><p>Every option is an AgentFlow AI salesperson. The voice and tone can change; prices and policy never do.</p></div><span className={`voice-state voice-state-${state.toLowerCase()}`}><i />{stateCopy[state]}</span></div><div className="voice-profile-row">{profiles.map((profile) => <article className={selected?.id === profile.id ? "voice-profile selected" : "voice-profile"} key={profile.id}><button type="button" onClick={() => void selectProfile(profile)}><span className="voice-profile-avatar">{profile.displayName.slice(0, 1)}</span><strong>{profile.displayName}</strong><small>{profile.description}</small><em>{profile.languageSupport.join(" · ")}</em></button><button className="voice-preview-button" type="button" onClick={() => void preview(profile)}>Preview voice</button></article>)}</div><div className="voice-controls"><label>Language<select value={language} onChange={(event) => setLanguage(event.target.value)}><option value="en-IN">English</option><option value="hi-IN">हिन्दी</option><option value="hinglish">Hinglish</option></select></label><button className={voiceOn ? "voice-mic-button active" : "voice-mic-button"} type="button" onClick={() => void toggleMic()} aria-label={state === "LISTENING" ? "Stop listening" : "Start microphone"}>{state === "LISTENING" ? "■" : "●"}<span>{state === "LISTENING" ? "Stop" : "Talk"}</span></button><label className="voice-toggle"><input type="checkbox" checked={voiceOn} onChange={(event) => setVoiceOn(event.target.checked)} /> Voice replies</label></div><div className="voice-text-turn"><input aria-label="Type to your AI salesperson" value={text} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void sendTurn(text); }} placeholder="Try: Mujhe 15k ke andar dark wood desk chahiye" /><button className="customer-button customer-button-dark" type="button" onClick={() => void sendTurn(text)}>Send</button></div>{transcript ? <p className="voice-transcript"><strong>You:</strong> {transcript}</p> : null}{lastReply ? <p className="voice-reply"><strong>{selected?.displayName || "AI salesperson"}:</strong> {lastReply}</p> : null}{message ? <p className="voice-error">{message}</p> : null}</section>;
}

function applySemanticAction(text: string, products: Array<{ id?: string }>, uiType?: string) {
  const value = text.toLowerCase();
  if (value.includes("scroll down") || value.includes("thoda neeche") || value.includes("neeche dikhao")) window.scrollBy({ top: Math.round(window.innerHeight * 0.82), behavior: "smooth" });
  else if (value.includes("scroll up") || value.includes("upar jao")) window.scrollBy({ top: -Math.round(window.innerHeight * 0.82), behavior: "smooth" });
  else if (value.includes("accessor")) document.querySelector("#catalogue")?.scrollIntoView({ behavior: "smooth" });
  else if (value.includes("cart") || value.includes("basket")) document.querySelector(".basket-button")?.scrollIntoView({ behavior: "smooth", block: "center" });
  else if (value.includes("shortlist")) document.querySelector("#catalogue")?.scrollIntoView({ behavior: "smooth" });
  else if (value.includes("compare") || uiType === "COMPARISON") document.querySelector("#conversation")?.scrollIntoView({ behavior: "smooth" });
  else if (value.includes("first") || value.includes("pehla") || value.includes("pahla") || value.includes("second") || value.includes("doosra") || value.includes("dusra") || value.includes("open product")) {
    const index = value.includes("second") || value.includes("doosra") || value.includes("dusra") ? 1 : 0;
    const productId = products[index]?.id;
    if (productId) document.querySelector(`[data-product-id="${CSS.escape(productId)}"]`)?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    if (productId) document.querySelector(`[data-product-id="${CSS.escape(productId)}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}
