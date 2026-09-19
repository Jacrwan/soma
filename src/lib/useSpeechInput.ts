import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Dictation into a text field, using the browser's own speech recognition
 * (Chrome, Edge and Safari; not Firefox). Nothing is sent anywhere by this hook
 * beyond what the browser itself does to recognise speech.
 *
 * Dictated words are appended to whatever was already in the field when
 * listening started, so typing and speaking can be mixed. Listening continues
 * through pauses until stopped, which suits a long brain dump.
 */

type Recognition = {
  continuous: boolean; interimResults: boolean; lang: string;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start(): void; stop(): void; abort(): void;
};

function recognitionClass(): (new () => Recognition) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const ERRORS: Record<string, string> = {
  'not-allowed': 'Microphone access is blocked. Allow it in your browser to dictate.',
  'service-not-allowed': 'Microphone access is blocked. Allow it in your browser to dictate.',
  'audio-capture': 'No microphone was found.',
  'network': "Speech recognition couldn't reach its service. Check your connection.",
};

export function useSpeechInput(onText: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState('');
  const recognitionRef = useRef<Recognition | null>(null);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;
  const supported = recognitionClass() !== null;

  const stop = useCallback(() => { recognitionRef.current?.stop(); }, []);

  const start = useCallback((base: string) => {
    const SR = recognitionClass();
    if (!SR || recognitionRef.current) return;
    setError('');
    const recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || 'en-US';
    const prefix = base && !/\s$/.test(base) ? `${base} ` : base;
    // Rebuild from the whole session on every event instead of accumulating:
    // browsers disagree about resultIndex, and adding up finished phrases
    // duplicated them whenever an earlier phrase was reported again.
    recognition.onresult = e => {
      let text = '';
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
      onTextRef.current(`${prefix}${text}`.replace(/\s{2,}/g, ' '));
    };
    recognition.onerror = e => {
      if (e.error !== 'no-speech' && e.error !== 'aborted') setError(ERRORS[e.error] ?? 'Dictation stopped unexpectedly. Try again.');
    };
    recognition.onend = () => { recognitionRef.current = null; setListening(false); };
    recognitionRef.current = recognition;
    setListening(true);
    try { recognition.start(); }
    catch { recognitionRef.current = null; setListening(false); setError('Dictation could not start. Try again.'); }
  }, []);

  // Never leave the microphone open after the component goes away.
  useEffect(() => () => { recognitionRef.current?.abort(); }, []);

  return { supported, listening, error, start, stop };
}
