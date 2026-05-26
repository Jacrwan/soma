const MESSAGES = {
  ai:       "Sorry, I'm having trouble responding right now. Please try again in a moment.",
  canvas:   "Couldn't connect to Canvas. Check your URL and token in Settings.",
  calendar: "Google Calendar is unavailable right now. Try reconnecting in Settings.",
  auth:     "Something went wrong with your account. Please try signing in again.",
  data:     "Your data couldn't be loaded. Please refresh the page.",
  general:  "Something went wrong. Please try again.",
} as const;

export function friendlyError(context: keyof typeof MESSAGES): string {
  return MESSAGES[context];
}
