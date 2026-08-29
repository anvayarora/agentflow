import { Buffer } from "node:buffer";
import { transcribeAudio, synthesizeSpeech } from "../lib/ai/providers/sarvam.ts";

if (process.env.RUN_SARVAM_E2E !== "1") {
  console.log("Sarvam suite skipped. Set RUN_SARVAM_E2E=1 for explicit provider tests.");
  process.exit(0);
}
if (!process.env.SARVAM_API_KEY) {
  console.error("SARVAM_API_KEY is required for the explicit provider suite.");
  process.exit(1);
}

const checks = [];
const add = (id, passed, evidence) => { checks.push({ id, passed, evidence }); if (!passed) throw new Error(`${id}: ${evidence}`); };
const totals = { sttSeconds: 0, ttsCharacters: 0, providerCalls: 0 };
const started = Date.now();

async function tts(text, language, speakerId, pace = "STANDARD") {
  const result = await synthesizeSpeech({ text, language, speakerId, pace });
  totals.ttsCharacters += result.characters;
  totals.providerCalls += result.cached ? 0 : 1;
  return result;
}

async function stt(audioBase64, languageCode) {
  const bytes = Buffer.from(audioBase64, "base64");
  const result = await transcribeAudio({ bytes: new Uint8Array(bytes), mimeType: "audio/wav", languageCode });
  totals.providerCalls += 1;
  totals.sttSeconds += Math.max(0.1, bytes.length / 32000);
  return result;
}

try {
  const english = await tts("Show me a wooden desk under fifteen thousand rupees.", "en-IN", "shubh");
  const hindi = await tts("मुझे पंद्रह हजार रुपये के अंदर लकड़ी की मेज चाहिए।", "hi-IN", "anand");
  const hinglish = await tts("Mujhe fifteen thousand ke andar dark wood desk chahiye.", "hinglish", "priya");
  const englishStt = await stt(english.audioBase64, "en-IN");
  const hindiStt = await stt(hindi.audioBase64, "hi-IN");
  const hinglishStt = await stt(hinglish.audioBase64, "unknown");
  add("english-stt", englishStt.transcript.length > 0, `${englishStt.languageCode || "unknown"} transcript returned`);
  add("hindi-stt", hindiStt.transcript.length > 0, `${hindiStt.languageCode || "unknown"} transcript returned`);
  add("hinglish-stt", hinglishStt.transcript.length > 0, `${hinglishStt.languageCode || "unknown"} transcript returned`);
  add("english-tts", Buffer.from(english.audioBase64, "base64").length > 64, "non-empty WAV returned");
  add("hindi-tts", Buffer.from(hindi.audioBase64, "base64").length > 64, "non-empty WAV returned");
  add("hinglish-tts", Buffer.from(hinglish.audioBase64, "base64").length > 64, "non-empty WAV returned");

  for (const speaker of ["shubh", "priya", "anand", "simran"]) { const result = await tts("Hi, I’m your AgentFlow AI salesperson.", "en-IN", speaker); add(`speaker-${speaker}`, result.audioBase64.length > 64, "configured Bulbul v3 speaker accepted"); }
  await assertReject("invalid-speaker", () => synthesizeSpeech({ text: "Hi", language: "en-IN", speakerId: "not-real", pace: "STANDARD" }));
  for (const pace of ["RELAXED", "STANDARD", "QUICK"]) { const result = await tts("A short voice preview.", "en-IN", "shubh", pace); add(`pace-${pace.toLowerCase()}`, result.audioBase64.length > 64, "preset mapped to a valid provider pace"); }
  const long = await tts("x".repeat(3200), "en-IN", "shubh"); add("long-tts", long.characters <= 2500, "application truncates long speech before the provider request");
  await assertReject("silence", () => transcribeAudio({ bytes: new Uint8Array(32000), mimeType: "audio/wav", languageCode: "unknown" }));
  await assertReject("invalid-audio", () => transcribeAudio({ bytes: new Uint8Array([1, 2, 3]), mimeType: "audio/wav" }));
  await assertReject("oversized-audio", () => transcribeAudio({ bytes: new Uint8Array(8 * 1024 * 1024 + 1), mimeType: "audio/wav" }));
  const previousBase = process.env.SARVAM_BASE_URL;
  process.env.SARVAM_BASE_URL = "https://127.0.0.1:9";
  await assertReject("provider-failure", () => synthesizeSpeech({ text: "Provider outage test.", language: "en-IN", speakerId: "shubh", pace: "STANDARD" }));
  if (previousBase === undefined) delete process.env.SARVAM_BASE_URL; else process.env.SARVAM_BASE_URL = previousBase;
  console.log(JSON.stringify({ passed: true, checks, latencyMs: Date.now() - started, totals }));
} catch (error) {
  console.error(JSON.stringify({ passed: false, checks, error: error instanceof Error ? error.message : "Sarvam suite failed.", latencyMs: Date.now() - started, totals }));
  process.exitCode = 1;
}

async function assertReject(id, fn) {
  let errorMessage = "expected a controlled failure";
  let failed = false;
  try { await fn(); } catch (error) { failed = true; errorMessage = error instanceof Error ? error.message : "controlled provider error"; }
  add(id, failed, errorMessage);
}
