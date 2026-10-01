// Past tense the model uses for things that only happen on Accept, with the
// plain verb to suggest instead.
const VERBS: Record<string, string> = {
  removed: 'remove', deleted: 'delete', moved: 'move', added: 'add', renamed: 'rename', updated: 'update',
  rescheduled: 'reschedule', scheduled: 'schedule', extended: 'extend', combined: 'combine', merged: 'merge',
  marked: 'mark', shortened: 'shorten', created: 'create', replaced: 'replace', changed: 'change',
  shifted: 'shift', dropped: 'drop', cancelled: 'cancel', canceled: 'cancel',
};
const verb = `(${Object.keys(VERBS).join('|')})`;
// A sentence (or a clause after "Got it —") that opens with a claim: "Removed X",
// "I've moved X", "Renamed and moved X".
const CLAIM = new RegExp(`(^|[.!?]\\s+|[—–:]\\s*|\\s-\\s)(?:I(?:'ve| have)\\s+)?${verb}\\b(?:(\\s+and\\s+)${verb}\\b)?`, 'gi');

/**
 * Soma is told never to say a change was made, since it is a proposal until
 * Accept, and still wrote "Removed Lab 4 from today" above an unaccepted
 * card. A sentence that opens by claiming a change is reworded as the
 * suggestion it is: "Removed Lab 4" → "Suggested: remove Lab 4".
 */
export function asProposal(reply: string): string {
  return reply.replace(CLAIM, (_all, lead: string, first: string, and?: string, second?: string) => {
    const opens = lead === '' || /[.!?]\s+$/.test(lead);
    return `${lead}${opens ? 'Suggested' : 'suggested'}: ${VERBS[first.toLowerCase()]}${and && second ? `${and}${VERBS[second.toLowerCase()]}` : ''}`;
  });
}
