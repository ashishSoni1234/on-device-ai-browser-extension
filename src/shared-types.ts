/**
 * shared-types.ts
 * Shared TypeScript interfaces and types used across all scripts.
 */

/** Storage keys used in chrome.storage.local */
export const STORAGE_KEYS = {
  MODE: 'ppa_mode',              // 'local' | 'cloud'
  CLOUD_PROVIDER: 'ppa_cloud_provider', // 'gemini' | 'groq'
  GEMINI_KEY: 'ppa_gemini_key',
  GROQ_KEY: 'ppa_groq_key',
  STATS: 'ppa_stats',
} as const;

/** Extension operating mode */
export type Mode = 'local' | 'cloud';

/** Cloud provider */
export type CloudProvider = 'gemini' | 'groq';

/** Transparency dashboard statistics */
export interface Stats {
  localSummarizations: number;
  cloudRequests: number;
  localPages: number;
}

/** Default stats values */
export const DEFAULT_STATS: Stats = {
  localSummarizations: 0,
  cloudRequests: 0,
  localPages: 0,
};

/** Settings stored in chrome.storage.local */
export interface AppSettings {
  mode: Mode;
  cloudProvider: CloudProvider;
  geminiKey: string;
  groqKey: string;
}
