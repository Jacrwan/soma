/// <reference types="vite/client" />

declare const __DASHBOARD_V2_ENABLED__: boolean;
/** package.json version, stamped in at build time. */
declare const __APP_VERSION__: string;

interface Window {
  SpeechRecognition: typeof SpeechRecognition;
  webkitSpeechRecognition: typeof SpeechRecognition;
}
