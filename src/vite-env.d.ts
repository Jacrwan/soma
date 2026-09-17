/// <reference types="vite/client" />

declare const __DASHBOARD_V2_ENABLED__: boolean;

interface Window {
  SpeechRecognition: typeof SpeechRecognition;
  webkitSpeechRecognition: typeof SpeechRecognition;
}
