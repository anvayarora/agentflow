import assert from "node:assert/strict";
import test from "node:test";

const context = { organizationId: "prompt6-org", actorType: "customer", actorId: "demo-customer", correlationId: "prompt6-correlation" };
const salespersonRepo = await import("../lib/server/repositories/salesperson.ts");
const commerceRepo = await import("../lib/server/repositories/commerce.ts");
const voice = await import("../lib/voice/service.ts");
const sarvam = await import("../lib/ai/providers/sarvam.ts");

test("salesperson profiles are constrained, tenant-scoped, and session selections persist", async () => {
  salespersonRepo.resetSalespersonRepositoryForTests();
  commerceRepo.resetCommerceRepositoryForTests();
  const profiles = await salespersonRepo.getSalespersonRepository().ensureDefaults(context);
  assert.equal(profiles.length, 3);
  assert.equal(profiles.find((profile) => profile.isMerchantDefault)?.displayName, "Maya");
  const session = await commerceRepo.getCommerceRepository().createSession(context, "customer-haven-new");
  const aarav = profiles.find((profile) => profile.displayName === "Aarav");
  assert.ok(aarav);
  const selected = await voice.ensureVoiceSession(context, session.id, aarav.id, "hinglish", true);
  assert.equal(selected.salesperson.displayName, "Aarav");
  const persisted = await commerceRepo.getCommerceRepository().getSession(context, session.id);
  assert.equal(persisted?.salespersonProfileId, aarav.id);
  assert.equal(persisted?.preferredLanguage, "hinglish");
  await assert.rejects(() => salespersonRepo.getSalespersonRepository().select({ ...context, organizationId: "other-org" }, "salesperson-aarav"), /not available/i);
});

test("language detection is explicit and conversational, not demographic inference", () => {
  assert.equal(voice.detectConversationLanguage("मुझे लकड़ी की मेज चाहिए"), "hi-IN");
  assert.equal(voice.detectConversationLanguage("Mujhe dark wood desk chahiye"), "hinglish");
  assert.equal(voice.detectConversationLanguage("Show me a compact desk"), "en-IN");
});

test("Sarvam STT/TTS adapters use server authentication, safe limits, real speaker validation, and cache previews", async () => {
  sarvam.resetSarvamCacheForTests();
  const previousKey = process.env.SARVAM_API_KEY;
  process.env.SARVAM_API_KEY = "test-only-key";
  let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    calls += 1;
    assert.equal(new Headers(init?.headers).get("api-subscription-key"), "test-only-key");
    if (String(input).endsWith("/speech-to-text")) return new Response(JSON.stringify({ request_id: "stt-test", transcript: "Mujhe desk chahiye", language_code: "hinglish" }), { status: 200 });
    return new Response(JSON.stringify({ request_id: "tts-test", audios: ["UklGRg=="] }), { status: 200 });
  };
  try {
    const transcript = await sarvam.transcribeAudio({ bytes: new Uint8Array([1, 2, 3]), mimeType: "audio/wav" });
    assert.equal(transcript.transcript, "Mujhe desk chahiye");
    const speech = await sarvam.synthesizeSpeech({ text: "Mujhe teen options mile hain.", language: "hinglish", speakerId: "priya", pace: "STANDARD" });
    assert.equal(speech.cached, false);
    const cached = await sarvam.synthesizeSpeech({ text: "Mujhe teen options mile hain.", language: "hinglish", speakerId: "priya", pace: "STANDARD" });
    assert.equal(cached.cached, true);
    assert.equal(calls, 2);
    await assert.rejects(() => sarvam.synthesizeSpeech({ text: "Hi", language: "en-IN", speakerId: "not-a-speaker", pace: "STANDARD" }), /not supported/i);
    await assert.rejects(() => sarvam.transcribeAudio({ bytes: new Uint8Array(8 * 1024 * 1024 + 1) }), /8 MB/i);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.SARVAM_API_KEY; else process.env.SARVAM_API_KEY = previousKey;
  }
});
