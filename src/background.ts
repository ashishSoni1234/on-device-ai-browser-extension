/**
 * background.ts
 * Extension Service Worker — runs persistently in the background.
 *
 * Responsibilities:
 * 1. Hosts the WebLLM ExtensionServiceWorkerMLCEngineHandler (local AI engine).
 * 2. Handles cloud API calls (Google Gemini / Groq) when cloud mode is active.
 * 3. Updates transparency stats in chrome.storage.local.
 * 4. Sends loading progress updates to the popup.
 */

import {
  MLCEngine,
  ExtensionServiceWorkerMLCEngineHandler,
} from '@mlc-ai/web-llm';
import type { InitProgressReport } from '@mlc-ai/web-llm';
import { STORAGE_KEYS, DEFAULT_STATS } from './shared-types.ts';
import type { Stats, AppSettings, CloudProvider } from './shared-types.ts';

// ─────────────────────────────────────────────
// WebLLM Engine Setup (Local Mode)
// ─────────────────────────────────────────────
const engine = new MLCEngine();
let handler: ExtensionServiceWorkerMLCEngineHandler;
let modelLoaded = false;
const MODEL_ID = 'SmolLM2-360M-Instruct-q4f16_1-MLC';

chrome.runtime.onConnect.addListener((port: chrome.runtime.Port) => {
  if (port.name === 'web_llm_service_worker') {
    if (handler === undefined) {
      handler = new ExtensionServiceWorkerMLCEngineHandler(port);
      handler.engine = engine;
    } else {
      handler.setPort(port);
    }
    port.onMessage.addListener(handler.onmessage.bind(handler));
  }
});

// ─────────────────────────────────────────────
// Message Handler (from popup)
// ─────────────────────────────────────────────
chrome.runtime.onMessage.addListener(
  (
    request: { action: string; payload?: Record<string, unknown> },
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ) => {
    switch (request.action) {
      case 'load_model':
        loadModel()
          .then(() => sendResponse({ success: true, modelLoaded }))
          .catch((e) => sendResponse({ success: false, error: String(e) }));
        return true;

      case 'get_model_status':
        sendResponse({ modelLoaded });
        break;

      case 'cloud_complete':
        handleCloudRequest(request.payload as unknown as CloudPayload)
          .then((result) => sendResponse({ success: true, result }))
          .catch((e) => sendResponse({ success: false, error: e.message || String(e) }));
        return true;

      case 'increment_stat':
        incrementStat(request.payload as { key: keyof Stats }).then(() =>
          sendResponse({ success: true }),
        );
        return true;

      case 'get_stats':
        getStats().then((stats) => sendResponse({ stats }));
        return true;

      case 'reset_stats':
        resetStats().then(() => sendResponse({ success: true }));
        return true;
    }
    return false;
  },
);

// ─────────────────────────────────────────────
// Model Loading
// ─────────────────────────────────────────────
async function loadModel(): Promise<void> {
  if (modelLoaded) return;

  const initProgressCallback = (report: InitProgressReport) => {
    chrome.runtime.sendMessage({
      action: 'model_progress',
      progress: report.progress,
      text: report.text,
    }).catch(() => {});
  };

  engine.setInitProgressCallback(initProgressCallback);
  await engine.reload(MODEL_ID);
  modelLoaded = true;
  chrome.runtime.sendMessage({ action: 'model_ready' }).catch(() => {});
}

// ─────────────────────────────────────────────
// Cloud API Handler — routes to Gemini or Groq
// ─────────────────────────────────────────────
interface CloudPayload {
  provider: CloudProvider;
  apiKey: string;
  messages: Array<{ role: string; content: string }>;
}

async function handleCloudRequest(payload: CloudPayload): Promise<string> {
  const { provider, apiKey, messages } = payload;

  if (!apiKey || apiKey.trim() === '') {
    throw new Error(`${provider === 'groq' ? 'Groq' : 'Gemini'} API key is missing. Please add it in Settings (⚙️).`);
  }

  if (provider === 'groq') {
    return handleGroqRequest(apiKey, messages);
  }

  return handleGeminiRequest(apiKey, messages);
}

/**
 * Groq API — OpenAI-compatible endpoint.
 * Uses Llama 3.3 70B (best quality on Groq free tier).
 * Docs: https://console.groq.com/docs/openai
 */
async function handleGroqRequest(
  apiKey: string,
  messages: Array<{ role: string; content: string }>,
): Promise<string> {
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages,
      temperature: 0.7,
      max_tokens: 600,
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({
      error: { message: response.statusText },
    }));
    const msg = (err as { error?: { message?: string } }).error?.message ?? response.statusText;
    throw new Error(`Groq Error: ${msg}`);
  }

  const data = await response.json() as {
    choices: Array<{ message: { content: string } }>;
  };
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('Groq returned an empty response.');
  return text;
}

/**
 * Google Gemini REST API.
 * Uses gemini-1.5-flash (free tier available).
 * Docs: https://ai.google.dev/api/generate-content
 */
async function handleGeminiRequest(
  apiKey: string,
  messages: Array<{ role: string; content: string }>,
): Promise<string> {
  // Gemini separates system instruction from conversation
  const systemMessage = messages.find((m) => m.role === 'system');
  const chatMessages  = messages.filter((m) => m.role !== 'system');

  // Convert to Gemini format: roles are "user" and "model" (not "assistant")
  const contents = chatMessages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  const requestBody: Record<string, unknown> = {
    contents,
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 600,
    },
  };

  if (systemMessage?.content) {
    requestBody['systemInstruction'] = {
      parts: [{ text: systemMessage.content }],
    };
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({
      error: { message: response.statusText },
    }));
    const msg = (err as { error?: { message?: string } }).error?.message ?? response.statusText;
    throw new Error(`Gemini Error: ${msg}`);
  }

  const data = await response.json() as {
    candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
  };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned an empty response.');
  return text;
}

// ─────────────────────────────────────────────
// Stats Persistence
// ─────────────────────────────────────────────
async function getStats(): Promise<Stats> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.STATS);
  return (result[STORAGE_KEYS.STATS] as Stats) ?? DEFAULT_STATS;
}

async function incrementStat(payload: { key: keyof Stats }): Promise<void> {
  const stats = await getStats();
  stats[payload.key] = (stats[payload.key] ?? 0) + 1;
  await chrome.storage.local.set({ [STORAGE_KEYS.STATS]: stats });
}

async function resetStats(): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.STATS]: { ...DEFAULT_STATS } });
}

// ─────────────────────────────────────────────
// Startup — pre-warm local model if in local mode
// ─────────────────────────────────────────────
async function loadSettings(): Promise<AppSettings> {
  const result = await chrome.storage.local.get([
    STORAGE_KEYS.MODE,
    STORAGE_KEYS.CLOUD_PROVIDER,
    STORAGE_KEYS.GEMINI_KEY,
    STORAGE_KEYS.GROQ_KEY,
  ]);
  return {
    mode:          (result[STORAGE_KEYS.MODE]           as AppSettings['mode'])          ?? 'local',
    cloudProvider: (result[STORAGE_KEYS.CLOUD_PROVIDER] as AppSettings['cloudProvider']) ?? 'gemini',
    geminiKey:     (result[STORAGE_KEYS.GEMINI_KEY]     as string)                       ?? '',
    groqKey:       (result[STORAGE_KEYS.GROQ_KEY]       as string)                       ?? '',
  };
}

loadSettings().then((settings) => {
  if (settings.mode === 'local') {
    loadModel().catch((e) => console.error('[PPA] Model pre-load failed:', e));
  }
});

console.log('[Privacy Page Assistant] Background service worker started.');
