import { useCallback, useRef } from 'react';

// Minimal typings for the Google Picker API (loaded at runtime)
declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    gapi: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    google: any;
  }
}

// File types our backend can extract text from (mirrors drive-read.ts)
const READABLE_MIME_TYPES = [
  'application/vnd.google-apps.document',
  'application/vnd.google-apps.presentation',
  'application/vnd.google-apps.spreadsheet',
  'text/plain',
  'text/markdown',
  'text/csv',
  'text/html',
  'application/rtf',
].join(',');

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}

export interface PickedFile {
  id: string;
  name: string;
  mimeType: string;
}

/**
 * Returns an openPicker() function that launches Google's hosted file picker.
 * Uses drive.file scope — no drive.readonly, no audit.
 *
 * Requires VITE_GOOGLE_API_KEY (a browser API key restricted to your domain
 * and the Picker API, created in Google Cloud Console).
 */
export function useGooglePicker(
  googleToken: string,
  onPick: (file: PickedFile) => void,
) {
  const pickerReady = useRef(false);

  const openPicker = useCallback(async () => {
    if (!googleToken) return;

    const apiKey = import.meta.env.VITE_GOOGLE_API_KEY as string | undefined;
    if (!apiKey) {
      console.error('[Soma] VITE_GOOGLE_API_KEY is not set — cannot open Google Picker.');
      return;
    }

    // Load gapi script once
    await loadScript('https://apis.google.com/js/api.js');

    // Load picker module once
    if (!pickerReady.current) {
      await new Promise<void>(resolve => {
        window.gapi.load('picker', { callback: resolve });
      });
      pickerReady.current = true;
    }

    const { DocsView, ViewId, PickerBuilder, Action } = window.google.picker;

    // My Drive — files owned by the user
    const myFilesView = new DocsView(ViewId.DOCS)
      .setIncludeFolders(false)
      .setMimeTypes(READABLE_MIME_TYPES);

    // Shared with me — files teachers/professors shared
    const sharedView = new DocsView(ViewId.DOCS)
      .setOwnedByMe(false)
      .setIncludeFolders(false)
      .setMimeTypes(READABLE_MIME_TYPES);

    new PickerBuilder()
      .setTitle('Choose a file to attach to Soma')
      .setOAuthToken(googleToken)
      .setDeveloperKey(apiKey)
      .addView(myFilesView)
      .addView(sharedView)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .setCallback((data: any) => {
        if (data.action === Action.PICKED && data.docs?.[0]) {
          const f = data.docs[0];
          onPick({ id: f.id, name: f.name, mimeType: f.mimeType });
        }
      })
      .build()
      .setVisible(true);
  }, [googleToken, onPick]);

  return { openPicker };
}
