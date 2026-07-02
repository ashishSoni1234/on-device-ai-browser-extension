# 📚 Privacy Page Assistant — Technical Documentation

Welcome to the technical documentation for the **Privacy Page Assistant**. This document explains the architecture, design patterns, and engineering decisions behind the extension, specifically designed to help recruiters, developers, and reviewers understand the codebase.

---

## 🏗️ Architecture Overview

The extension is built strictly adhering to **Chrome Manifest V3** guidelines and uses a message-passing architecture to communicate between its isolated layers. 

### 1. The Core Components
- **`src/popup.ts` (The UI Controller)**
  - Manages the user interface, DOM updates, and state.
  - Responsible for routing user requests (Summarize, Chat, Explain) to the background worker.
  - Implements the "Graceful Fallback" logic if the local GPU fails.
- **`src/background.ts` (The Engine & Orchestrator)**
  - Runs persistently in the background.
  - **Local Mode:** Hosts the `@mlc-ai/web-llm` Service Worker Engine. It handles WebGPU buffer allocations and LLM generation.
  - **Cloud Mode:** Routes secure, direct HTTP requests to Groq (Llama 3.3) and Google Gemini (1.5 Flash).
  - Manages SQLite/Storage state persistence (Transparency Dashboard).
- **`src/content.ts` (The DOM Injector)**
  - Injected directly into the active webpage.
  - Uses Mozilla's **Readability.js** to parse chaotic DOM structures into clean, readable text.
  - Scans URLs and Titles to auto-detect "Privacy Policy" or "TOS" pages dynamically.

---

## 🧠 AI Engine Integration

### Local Mode (WebGPU & WebLLM)
We leverage WebAssembly and WebGPU to run LLM inference directly on the client's device.
- **Model Used:** `SmolLM2-360M-Instruct`
- **Why this model?** Standard consumer laptops often struggle with large memory footprints. SmolLM2 requires only ~380MB of VRAM, ensuring compatibility across a vast majority of integrated GPUs without triggering Out-Of-Memory (OOM) crashes.
- **Context Limits:** The context window is strictly capped at `4,000 characters` for summaries to prevent Windows TDR (Timeout Detection and Recovery) crashes.

### Cloud Mode (API Fallback)
For devices that do not support WebGPU, or when the user desires higher-quality reasoning, the extension falls back to Cloud Mode.
- Implements OpenAI-compatible endpoints for **Groq** (Llama 3.3 70B).
- Integrates Google's **Gemini** REST API.

---

## 🛡️ Robustness & Fault Tolerance

A core engineering focus of this project is handling hardware fragmentation gracefully.

**The Graceful Cloud Fallback Mechanism:**
Consumer WebGPU is highly unstable. If a user's GPU runs out of VRAM, or if the Windows Graphics Driver resets the GPU because processing took longer than 2 seconds (TDR), the WebLLM engine will throw an `Object has already been disposed` or `DXGI_ERROR_DEVICE_REMOVED` error.

Instead of crashing the UI, `popup.ts` catches this hardware error instantly. It intercepts the failure and seamlessly forwards the exact prompt to the active Cloud Provider (Groq/Gemini). The user receives their answer instantly with a non-intrusive note: `(⚡ Auto-fallback to Cloud due to heavy hardware load)`. 

This guarantees a **100% uptime UX** regardless of the user's local hardware limits.

---

## 📊 Transparency Dashboard

The extension emphasizes user trust. Every inference tracks a metric stored in `chrome.storage.local`. The Transparency Dashboard proves to the user exactly how many requests were processed entirely on-device (Zero Data Leakage) versus how many were routed to the cloud.

---

## 🛠️ Build Pipeline
- **Vite:** Used for rapid HMR (Hot Module Replacement) during development and heavily minified chunking for production.
- **CRXJS:** Specifically configures Vite for Chrome Extensions, automatically updating `manifest.json` assets and bridging the background/popup architectures during the build process.

*This project was built to demonstrate proficiency in browser APIs, WebGPU resource management, and modern TypeScript application architecture.*
