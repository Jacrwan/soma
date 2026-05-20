export async function sendMessage(
  messages: { role: 'user' | 'assistant'; content: string }[],
  systemPrompt: string,
): Promise<string> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages, systemPrompt }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Chat error: ${res.status}: ${body}`);
  }
  const data = await res.json() as { content: { text: string }[] };
  return data.content[0].text;
}
