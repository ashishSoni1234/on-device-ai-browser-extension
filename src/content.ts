/**
 * content.ts
 * Injected into every webpage. Responsible for:
 * 1. Extracting clean article text using Mozilla's Readability.js
 * 2. Detecting privacy policy / terms of service pages
 * 3. Sending results back to the popup via chrome.runtime.onMessage
 */

import { Readability } from '@mozilla/readability';

/**
 * Detects whether the current page is a Privacy Policy or Terms of Service page
 * by checking the URL path and page title.
 */
function detectPrivacyPage(): boolean {
  const url = window.location.href.toLowerCase();
  const title = document.title.toLowerCase();

  const urlPatterns = [
    '/privacy', '/terms', '/tos', '/legal', '/gdpr',
    '/data-policy', '/cookie-policy', '/user-agreement',
  ];
  const titlePatterns = [
    'privacy policy', 'terms of service', 'terms and conditions',
    'cookie policy', 'data policy', 'user agreement', 'legal',
  ];

  const urlMatch = urlPatterns.some((p) => url.includes(p));
  const titleMatch = titlePatterns.some((p) => title.includes(p));

  return urlMatch || titleMatch;
}

/**
 * Listen for messages from the popup.
 */
chrome.runtime.onMessage.addListener(
  (
    request: { action: string },
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response?: object) => void,
  ) => {
    if (request.action === 'extract_text') {
      try {
        // Readability mutates the DOM clone — never mutate the live document!
        const documentClone = document.cloneNode(true) as Document;
        const reader = new Readability(documentClone);
        const article = reader.parse();

        if (article && article.textContent && article.textContent.trim().length > 50) {
          sendResponse({
            success: true,
            text: article.textContent.trim(),
            title: article.title || document.title,
            isPrivacyPage: detectPrivacyPage(),
          });
        } else {
          // Fallback: grab all paragraph text if Readability returns nothing useful
          const paragraphs = Array.from(document.querySelectorAll('p'))
            .map((p) => p.textContent?.trim())
            .filter((t) => t && t.length > 20)
            .join('\n');

          if (paragraphs.length > 50) {
            sendResponse({
              success: true,
              text: paragraphs,
              title: document.title,
              isPrivacyPage: detectPrivacyPage(),
            });
          } else {
            sendResponse({
              success: false,
              error: 'Could not extract meaningful text from this page. Try a different page.',
            });
          }
        }
      } catch (err) {
        sendResponse({ success: false, error: `Extraction error: ${String(err)}` });
      }
    }

    // Return true to keep the message channel open for async sendResponse
    return true;
  },
);

console.log('[Privacy Page Assistant] Content script loaded on', window.location.href);
