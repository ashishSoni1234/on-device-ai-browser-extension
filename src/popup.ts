/**
 * popup.ts
 * Main controller for the extension popup UI.
 *
 * Features:
 * 1. Page Summarization (local + cloud via Gemini)
 * 2. Privacy Badge (local / cloud indicator)
 * 3. Local ↔ Cloud Toggle
 * 4. Explain Privacy Policy
 * 5. Chat with Page
 * 6. Model Loading Progress Bar
 * 7. Transparency Dashboard
 */

import { CreateExtensionServiceWorkerMLCEngine } from '@mlc-ai/web-llm';
import type { InitProgressReport, ChatCompletionMessageParam } from '@mlc-ai/web-llm';
import { STORAGE_KEYS, DEFAULT_STATS } from './shared-types.ts';
import type { Stats, Mode, CloudProvider, AppSettings } from './shared-types.ts';

// ─────────────────────────────────────────────
// DOM References
// ─────────────────────────────────────────────
const privacyBadge    = document.getElementById('privacyBadge')    as HTMLDivElement;
const modeToggle      = document.getElementById('modeToggle')       as HTMLInputElement;
const localLabel      = document.getElementById('localLabel')       as HTMLSpanElement;
const cloudLabel      = document.getElementById('cloudLabel')       as HTMLSpanElement;
const progressSection = document.getElementById('progressSection')  as HTMLDivElement;
const progressText    = document.getElementById('progressText')     as HTMLSpanElement;
const progressFill    = document.getElementById('progressFill')     as HTMLDivElement;
const progressPct     = document.getElementById('progressPct')      as HTMLSpanElement;
const webgpuError     = document.getElementById('webgpuError')      as HTMLDivElement;
const summarizeBtn    = document.getElementById('summarizeBtn')     as HTMLButtonElement;
const privacyBtn      = document.getElementById('privacyBtn')       as HTMLButtonElement;
const resultBox       = document.getElementById('resultBox')        as HTMLDivElement;
const resultLabel     = document.getElementById('resultLabel')      as HTMLSpanElement;
const resultContent   = document.getElementById('resultContent')    as HTMLDivElement;
const copyBtn         = document.getElementById('copyBtn')          as HTMLButtonElement;
const chatSection     = document.getElementById('chatSection')      as HTMLDivElement;
const chatMessages    = document.getElementById('chatMessages')     as HTMLDivElement;
const chatInput       = document.getElementById('chatInput')        as HTMLInputElement;
const chatSendBtn     = document.getElementById('chatSendBtn')      as HTMLButtonElement;
const clearChatBtn    = document.getElementById('clearChatBtn')     as HTMLButtonElement;
const settingsBtn     = document.getElementById('settingsBtn')      as HTMLButtonElement;
const resetStatsBtn   = document.getElementById('resetStatsBtn')    as HTMLButtonElement;
const statLocal       = document.getElementById('statLocal')        as HTMLSpanElement;
const statCloud       = document.getElementById('statCloud')        as HTMLSpanElement;
const statPages       = document.getElementById('statPages')        as HTMLSpanElement;

// ─────────────────────────────────────────────
// Application State
// ─────────────────────────────────────────────
let localEngine: Awaited<ReturnType<typeof CreateExtensionServiceWorkerMLCEngine>> | null = null;
let modelLoaded = false;
let currentMode: Mode = 'local';
let currentProvider: CloudProvider = 'gemini';
let currentSettings: AppSettings = {
  mode: 'local',
  cloudProvider: 'gemini',
  geminiKey: '',
  groqKey: '',
};

// Page context
let pageText  = '';
let pageTitle = '';

// Chat message history — uses WebLLM's own type for strict compatibility
type ChatMessage = ChatCompletionMessageParam;
let chatHistory: ChatMessage[] = [];

const SYSTEM_PROMPT =
  'You are a helpful AI assistant embedded in a browser extension. ' +
  'You answer questions based on the webpage content provided to you. ' +
  'Be concise, clear, and accurate.';

const MODEL_ID = 'SmolLM2-360M-Instruct-q4f16_1-MLC';

// ─────────────────────────────────────────────
// Initialization
// ─────────────────────────────────────────────
async function init(): Promise<void> {
  await loadSettings();
  updateModeUI();
  await refreshStats();
  await detectPage();

  // Check WebGPU support for local mode
  if (!navigator.gpu) {
    webgpuError.style.display = 'block';
    if (currentMode === 'local') {
      summarizeBtn.disabled = true;
      summarizeBtn.textContent = 'No WebGPU — use Cloud Mode';
    }
    return;
  }

  if (currentMode === 'local') {
    await initLocalEngine();
  } else {
    summarizeBtn.disabled = false;
  }
}

// ─────────────────────────────────────────────
// Settings
// ─────────────────────────────────────────────
async function loadSettings(): Promise<void> {
  const result = await chrome.storage.local.get([
    STORAGE_KEYS.MODE,
    STORAGE_KEYS.CLOUD_PROVIDER,
    STORAGE_KEYS.GEMINI_KEY,
    STORAGE_KEYS.GROQ_KEY,
  ]);

  currentSettings = {
    mode:          (result[STORAGE_KEYS.MODE]           as Mode)          ?? 'local',
    cloudProvider: (result[STORAGE_KEYS.CLOUD_PROVIDER] as CloudProvider) ?? 'gemini',
    geminiKey:     (result[STORAGE_KEYS.GEMINI_KEY]     as string)        ?? '',
    groqKey:       (result[STORAGE_KEYS.GROQ_KEY]       as string)        ?? '',
  };
  currentMode     = currentSettings.mode;
  currentProvider = currentSettings.cloudProvider;
  modeToggle.checked = currentMode === 'cloud';
}

async function saveMode(mode: Mode): Promise<void> {
  currentMode = mode;
  currentSettings.mode = mode;
  await chrome.storage.local.set({ [STORAGE_KEYS.MODE]: mode });
}

// ─────────────────────────────────────────────
// UI State Updates
// ─────────────────────────────────────────────
function updateModeUI(): void {
  if (currentMode === 'local') {
    privacyBadge.className = 'badge local-badge';
    privacyBadge.textContent = '🔒 100% Local — No data sent';
    localLabel.classList.add('active');
    cloudLabel.classList.remove('active');
  } else {
    const providerName = currentProvider === 'groq' ? 'Groq (Llama 3.3)' : 'Google Gemini';
    privacyBadge.className = 'badge cloud-badge';
    privacyBadge.textContent = `☁️ Cloud Mode — Data sent to ${providerName}`;
    cloudLabel.classList.add('active');
    localLabel.classList.remove('active');
  }
}

// ─────────────────────────────────────────────
// Page Detection
// ─────────────────────────────────────────────
async function detectPage(): Promise<void> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab.id) return;

    const response = await chrome.tabs.sendMessage(tab.id, { action: 'extract_text' });
    if (response?.success) {
      pageText  = response.text  ?? '';
      pageTitle = response.title ?? '';

      if (response.isPrivacyPage) {
        privacyBtn.style.display = 'flex';
      }
    }
  } catch {
    // Content script may not be injected on special pages (chrome://, PDF, etc.)
  }
}

// ─────────────────────────────────────────────
// Local Engine Init
// ─────────────────────────────────────────────
async function initLocalEngine(): Promise<void> {
  if (modelLoaded && localEngine) {
    summarizeBtn.disabled = false;
    return;
  }

  progressSection.style.display = 'block';
  summarizeBtn.disabled = true;
  summarizeBtn.innerHTML = '<span class="spinner"></span> Loading AI…';

  try {
    const initProgressCallback = (report: InitProgressReport) => {
      const pct = Math.round(report.progress * 100);
      progressText.textContent = `Loading AI model… ${pct}%`;
      progressFill.style.width = `${pct}%`;
      progressPct.textContent  = `${pct}%`;
    };

    localEngine = await CreateExtensionServiceWorkerMLCEngine(MODEL_ID, {
      initProgressCallback,
    });

    modelLoaded = true;
    progressSection.style.display = 'none';
    summarizeBtn.disabled = false;
    summarizeBtn.innerHTML = '<span class="btn-icon">✨</span> Summarize this page';
  } catch (err) {
    progressSection.style.display = 'none';
    summarizeBtn.disabled = true;
    summarizeBtn.textContent = 'Model failed to load';
    showError(`Failed to load AI model: ${String(err)}`);
  }
}

// ─────────────────────────────────────────────
// AI Completion — routes to local or Gemini cloud
// ─────────────────────────────────────────────
async function complete(messages: ChatMessage[]): Promise<string> {
  if (currentMode === 'local') {
    if (!localEngine) throw new Error('Local AI model is not ready yet. Please wait.');

    try {
      const reply = await localEngine.chat.completions.create({
        messages,
        temperature: 0.7,
        max_tokens: 512,
      });
      return reply.choices[0].message.content ?? '';
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('disposed')) {
        console.warn('[PPA] Local engine disposed. Attempting auto-recovery...');
        modelLoaded = false;
        await initLocalEngine();
        
        // Retry once after recovery
        if (!localEngine) throw new Error('Failed to recover local AI model.');
        const retryReply = await localEngine.chat.completions.create({
          messages,
          temperature: 0.7,
          max_tokens: 512,
        });
        return retryReply.choices[0].message.content ?? '';
      }
      throw err;
    }

  } else {
    // Cloud mode — pick API key based on selected provider
    const apiKey = currentProvider === 'groq'
      ? currentSettings.groqKey
      : currentSettings.geminiKey;

    const providerLabel = currentProvider === 'groq' ? 'Groq' : 'Gemini';

    if (!apiKey || apiKey.trim() === '') {
      const hint = currentProvider === 'groq'
        ? 'Get a free key at console.groq.com'
        : 'Get a free key at aistudio.google.com/apikey';
      throw new Error(`No ${providerLabel} API key found. Click ⚙️ Settings and add your key. ${hint}`);
    }

    const response = await chrome.runtime.sendMessage({
      action: 'cloud_complete',
      payload: { provider: currentProvider, apiKey, messages },
    });

    if (!response?.success) {
      throw new Error(response?.error ?? 'Cloud request failed.');
    }
    return response.result as string;
  }
}

// ─────────────────────────────────────────────
// Summarization
// ─────────────────────────────────────────────
async function handleSummarize(): Promise<void> {
  if (!pageText) {
    await detectPage();
    if (!pageText) {
      showResult(
        '❌ Could not extract text from this page. Try a different page (e.g., a Wikipedia article).',
        '📄 Summary',
      );
      return;
    }
  }

  setSummarizeLoading(true);

  try {
    const truncatedText = pageText.substring(0, 10_000);
    const messages: ChatMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Please summarize the following webpage content in 3-4 concise sentences. Focus on the key points.\n\nPage Title: ${pageTitle}\n\nContent:\n${truncatedText}`,
      },
    ];

    const summary = await complete(messages);
    showResult(summary, '📄 Summary');

    // Set chat context to the current page
    chatHistory = [
      {
        role: 'system',
        content: `${SYSTEM_PROMPT}\n\nWebpage Title: ${pageTitle}\n\nWebpage Content (first 8000 chars):\n${truncatedText.substring(0, 8000)}`,
      },
    ];
    chatSection.style.display = 'block';

    // Update stats
    if (currentMode === 'local') {
      await incrementStat('localSummarizations');
      await incrementStat('localPages');
    } else {
      await incrementStat('cloudRequests');
    }
    await refreshStats();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    showResult(`❌ Error: ${msg}`, '📄 Summary');
  } finally {
    setSummarizeLoading(false);
  }
}

// ─────────────────────────────────────────────
// Privacy Policy Explanation
// ─────────────────────────────────────────────
async function handlePrivacyExplain(): Promise<void> {
  if (!pageText) {
    await detectPage();
    if (!pageText) {
      showResult('❌ Could not extract text from this page.', '🔍 Privacy Analysis');
      return;
    }
  }

  privacyBtn.disabled = true;
  privacyBtn.innerHTML = '<span class="spinner"></span> Analyzing…';

  try {
    const truncatedText = pageText.substring(0, 12_000);
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: 'You are a privacy policy expert. Analyze privacy policies clearly and concisely.',
      },
      {
        role: 'user',
        content: `Analyze the following privacy policy and provide a structured summary covering:

1. **Data Collected**: What personal data is collected?
2. **Third-Party Sharing**: Is data shared with third parties? Who?
3. **Data Retention**: How long is data kept?
4. **User Rights**: What control do users have over their data?
5. **🚩 Red Flags**: Any concerning clauses (data selling, indefinite retention, broad sharing, etc.)?

Be direct and use bullet points. Highlight red flags clearly.

Privacy Policy Text:
${truncatedText}`,
      },
    ];

    const analysis = await complete(messages);
    showResult(analysis, '🔍 Privacy Policy Analysis', true);

    // Set chat context
    chatHistory = [
      {
        role: 'system',
        content: `${SYSTEM_PROMPT}\n\nPrivacy Policy Content:\n${truncatedText.substring(0, 8000)}`,
      },
    ];
    chatSection.style.display = 'block';

    if (currentMode === 'local') {
      await incrementStat('localSummarizations');
      await incrementStat('localPages');
    } else {
      await incrementStat('cloudRequests');
    }
    await refreshStats();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    showResult(`❌ Error: ${msg}`, '🔍 Privacy Analysis');
  } finally {
    privacyBtn.disabled = false;
    privacyBtn.innerHTML = '<span class="btn-icon">🔍</span> Explain this Privacy Policy';
  }
}

// ─────────────────────────────────────────────
// Chat with Page
// ─────────────────────────────────────────────
async function handleChatSend(): Promise<void> {
  const question = chatInput.value.trim();
  if (!question) return;

  if (chatHistory.length === 0) {
    appendChatMessage('assistant', '⚠️ Please summarize the page first so I have context.');
    return;
  }

  chatInput.value = '';
  chatSendBtn.disabled = true;
  appendChatMessage('user', question);

  // Show a thinking indicator
  const thinkingEl = appendChatMessage('assistant', '…');
  chatHistory.push({ role: 'user', content: question });

  try {
    const answer = await complete(chatHistory);
    chatHistory.push({ role: 'assistant', content: answer });
    thinkingEl.textContent = answer;

    if (currentMode === 'local') {
      await incrementStat('localSummarizations');
    } else {
      await incrementStat('cloudRequests');
    }
    await refreshStats();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    thinkingEl.textContent = `❌ ${msg}`;
    thinkingEl.classList.add('error-msg');
    chatHistory.pop(); // Remove failed user message from history
  } finally {
    chatSendBtn.disabled = false;
    chatInput.focus();
  }
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
function showResult(text: string, label: string, highlightRedFlags = false): void {
  resultBox.style.display = 'block';
  resultLabel.textContent = label;

  if (highlightRedFlags) {
    const lines = text.split('\n');
    const html = lines
      .map((line) => {
        const isRedFlag =
          /🚩|red flag|data sell|sell.*data|indefinite|third.party|third party|share.*data/i.test(line);
        return isRedFlag
          ? `<span class="red-flag">${escapeHtml(line)}</span>`
          : escapeHtml(line);
      })
      .join('\n');
    resultContent.innerHTML = html;
  } else {
    resultContent.textContent = text;
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function showError(message: string): void {
  showResult(`❌ ${message}`, '⚠️ Error');
}

function setSummarizeLoading(isLoading: boolean): void {
  summarizeBtn.disabled = isLoading;
  summarizeBtn.innerHTML = isLoading
    ? '<span class="spinner"></span> Summarizing…'
    : '<span class="btn-icon">✨</span> Summarize this page';
}

function appendChatMessage(role: 'user' | 'assistant', text: string): HTMLDivElement {
  const div = document.createElement('div');
  div.className = `msg ${role}`;
  div.textContent = text;
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return div;
}

// ─────────────────────────────────────────────
// Stats
// ─────────────────────────────────────────────
async function refreshStats(): Promise<void> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.STATS);
  const stats: Stats = (result[STORAGE_KEYS.STATS] as Stats) ?? DEFAULT_STATS;
  statLocal.textContent = String(stats.localSummarizations ?? 0);
  statCloud.textContent = String(stats.cloudRequests       ?? 0);
  statPages.textContent = String(stats.localPages          ?? 0);
}

async function incrementStat(key: keyof Stats): Promise<void> {
  await chrome.runtime.sendMessage({ action: 'increment_stat', payload: { key } });
}

// ─────────────────────────────────────────────
// Event Listeners
// ─────────────────────────────────────────────

summarizeBtn.addEventListener('click', handleSummarize);
privacyBtn.addEventListener('click', handlePrivacyExplain);

// Mode toggle
modeToggle.addEventListener('change', async () => {
  const newMode: Mode = modeToggle.checked ? 'cloud' : 'local';
  await saveMode(newMode);
  updateModeUI();

  if (newMode === 'local') {
    summarizeBtn.disabled = true;
    await initLocalEngine();
  } else {
    progressSection.style.display = 'none';
    // Reload provider in case user changed it in settings
    const result = await chrome.storage.local.get([STORAGE_KEYS.CLOUD_PROVIDER, STORAGE_KEYS.GEMINI_KEY, STORAGE_KEYS.GROQ_KEY]);
    currentProvider = (result[STORAGE_KEYS.CLOUD_PROVIDER] as CloudProvider) ?? 'gemini';
    currentSettings.geminiKey = (result[STORAGE_KEYS.GEMINI_KEY] as string) ?? '';
    currentSettings.groqKey   = (result[STORAGE_KEYS.GROQ_KEY]   as string) ?? '';
    updateModeUI();

    const activeKey = currentProvider === 'groq' ? currentSettings.groqKey : currentSettings.geminiKey;
    if (!activeKey || activeKey.trim() === '') {
      const hint = currentProvider === 'groq' ? 'console.groq.com' : 'aistudio.google.com/apikey';
      showResult(
        `⚠️ Cloud Mode selected but no ${currentProvider === 'groq' ? 'Groq' : 'Gemini'} API key found.\n\nClick the ⚙️ Settings button and add your key from:\n${hint}`,
        '⚙️ Setup Required',
      );
    }
    summarizeBtn.disabled = false;
  }
});

// Settings button
settingsBtn.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

// Copy button
copyBtn.addEventListener('click', async () => {
  const text = resultContent.textContent ?? '';
  await navigator.clipboard.writeText(text);
  copyBtn.textContent = '✅ Copied!';
  setTimeout(() => { copyBtn.textContent = '📋 Copy'; }, 1500);
});

// Chat
chatSendBtn.addEventListener('click', handleChatSend);
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleChatSend();
  }
});

// Clear chat
clearChatBtn.addEventListener('click', () => {
  chatMessages.innerHTML = '';
  chatHistory = chatHistory.slice(0, 1); // Keep system message
});

// Reset stats
resetStatsBtn.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ action: 'reset_stats' });
  await refreshStats();
});

// ─────────────────────────────────────────────
// Boot
// ─────────────────────────────────────────────
init().catch(console.error);
