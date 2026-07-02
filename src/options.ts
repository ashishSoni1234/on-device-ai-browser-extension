/**
 * options.ts
 * Settings page — supports Local mode + Cloud mode with Groq or Gemini provider.
 */

import { STORAGE_KEYS } from './shared-types.ts';
import type { Mode, CloudProvider } from './shared-types.ts';

// ─────────────────────────────────────────────
// DOM References
// ─────────────────────────────────────────────
const modeLocalRadio    = document.getElementById('modeLocal')      as HTMLInputElement;
const modeCloudRadio    = document.getElementById('modeCloud')      as HTMLInputElement;
const providerGroqRadio = document.getElementById('providerGroq')   as HTMLInputElement;
const providerGeminiRadio = document.getElementById('providerGemini') as HTMLInputElement;
const groqKeyInput      = document.getElementById('groqKey')        as HTMLInputElement;
const geminiKeyInput    = document.getElementById('geminiKey')      as HTMLInputElement;
const providerCard      = document.getElementById('providerCard')   as HTMLElement;
const keysCard          = document.getElementById('keysCard')       as HTMLElement;
const saveBtn           = document.getElementById('saveBtn')        as HTMLButtonElement;
const saveStatus        = document.getElementById('saveStatus')     as HTMLDivElement;

// ─────────────────────────────────────────────
// Load Settings
// ─────────────────────────────────────────────
async function loadSettings(): Promise<void> {
  const result = await chrome.storage.local.get([
    STORAGE_KEYS.MODE,
    STORAGE_KEYS.CLOUD_PROVIDER,
    STORAGE_KEYS.GEMINI_KEY,
    STORAGE_KEYS.GROQ_KEY,
  ]);

  const mode: Mode              = (result[STORAGE_KEYS.MODE]           as Mode)          ?? 'local';
  const provider: CloudProvider = (result[STORAGE_KEYS.CLOUD_PROVIDER] as CloudProvider) ?? 'groq';
  const geminiKey               = (result[STORAGE_KEYS.GEMINI_KEY]     as string)        ?? '';
  const groqKey                 = (result[STORAGE_KEYS.GROQ_KEY]       as string)        ?? '';

  modeLocalRadio.checked    = mode === 'local';
  modeCloudRadio.checked    = mode === 'cloud';
  providerGroqRadio.checked   = provider === 'groq';
  providerGeminiRadio.checked = provider === 'gemini';
  geminiKeyInput.value = geminiKey;
  groqKeyInput.value   = groqKey;

  updateCardVisibility(mode);
}

// ─────────────────────────────────────────────
// Save Settings
// ─────────────────────────────────────────────
async function saveSettings(): Promise<void> {
  const mode: Mode              = modeCloudRadio.checked    ? 'cloud'   : 'local';
  const provider: CloudProvider = providerGroqRadio.checked ? 'groq'    : 'gemini';
  const groqKey   = groqKeyInput.value.trim();
  const geminiKey = geminiKeyInput.value.trim();

  // Validate: active provider's key must be present in cloud mode
  if (mode === 'cloud') {
    if (provider === 'groq' && !groqKey) {
      showStatus('⚠️ Please enter your Groq API key to use Cloud Mode with Groq.', 'error');
      return;
    }
    if (provider === 'gemini' && !geminiKey) {
      showStatus('⚠️ Please enter your Gemini API key to use Cloud Mode with Gemini.', 'error');
      return;
    }
  }

  try {
    await chrome.storage.local.set({
      [STORAGE_KEYS.MODE]:           mode,
      [STORAGE_KEYS.CLOUD_PROVIDER]: provider,
      [STORAGE_KEYS.GEMINI_KEY]:     geminiKey,
      [STORAGE_KEYS.GROQ_KEY]:       groqKey,
    });
    showStatus('✅ Settings saved successfully!', 'success');
  } catch (err) {
    showStatus(`❌ Failed to save: ${String(err)}`, 'error');
  }
}

// ─────────────────────────────────────────────
// UI Helpers
// ─────────────────────────────────────────────
function updateCardVisibility(mode: Mode): void {
  const isCloud = mode === 'cloud';
  providerCard.style.opacity = isCloud ? '1' : '0.45';
  keysCard.style.opacity     = isCloud ? '1' : '0.45';
}

function showStatus(message: string, type: 'success' | 'error'): void {
  saveStatus.textContent = message;
  saveStatus.className = `save-status ${type}`;
  saveStatus.style.display = 'block';
  setTimeout(() => { saveStatus.style.display = 'none'; }, 3000);
}

// ─────────────────────────────────────────────
// Reveal Buttons
// ─────────────────────────────────────────────
document.querySelectorAll<HTMLButtonElement>('.reveal-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const targetId = btn.getAttribute('data-target');
    if (!targetId) return;
    const input = document.getElementById(targetId) as HTMLInputElement;
    if (!input) return;
    input.type = input.type === 'password' ? 'text' : 'password';
    btn.textContent = input.type === 'password' ? '👁️' : '🙈';
  });
});

// ─────────────────────────────────────────────
// Event Listeners
// ─────────────────────────────────────────────
modeLocalRadio.addEventListener('change', () => updateCardVisibility('local'));
modeCloudRadio.addEventListener('change', () => updateCardVisibility('cloud'));
saveBtn.addEventListener('click', saveSettings);

// ─────────────────────────────────────────────
// Boot
// ─────────────────────────────────────────────
loadSettings().catch(console.error);
