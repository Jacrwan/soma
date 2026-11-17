// Turns the short text Claude writes for study kits into safe HTML:
// \( \) and \[ \] (and $$ $$) math via KaTeX, \ce{} chemistry via mhchem,
// **bold**, `code` and fenced code blocks. Everything else is escaped, so
// material from a student's file can never inject markup.
import katex from 'katex';
import 'katex/contrib/mhchem';
import 'katex/dist/katex.min.css';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const math = (tex, display) => {
  try { return katex.renderToString(tex, { displayMode: display, throwOnError: false, strict: 'ignore', trust: false, maxExpand: 500, output: 'html' }); } catch { return `<code>${esc(tex)}</code>`; }
};

/** HTML for one piece of kit text. */
export function rich(text) {
  const keep = [];
  const hold = (html) => `\u0000${keep.push(html) - 1}\u0000`;
  let s = String(text ?? '');
  // Fenced code blocks first, then display math, inline math, chemistry, inline code.
  s = s.replace(/```[a-zA-Z0-9+#-]*\n?([\s\S]*?)```/g, (_, code) => hold(`<pre class="rx-pre"><code>${esc(code.replace(/\n$/, ''))}</code></pre>`));
  s = s.replace(/\\\[([\s\S]+?)\\\]/g, (_, tex) => hold(`<span class="rx-display">${math(tex, true)}</span>`));
  s = s.replace(/\$\$([\s\S]+?)\$\$/g, (_, tex) => hold(`<span class="rx-display">${math(tex, true)}</span>`));
  s = s.replace(/\\\(([\s\S]+?)\\\)/g, (_, tex) => hold(math(tex, false)));
  s = s.replace(/\\ce\{((?:[^{}]|\{[^{}]*\})*)\}/g, (_, ce) => hold(math(`\\ce{${ce}}`, false)));
  s = s.replace(/`([^`\n]+)`/g, (_, code) => hold(`<code class="rx-code">${esc(code)}</code>`));
  s = esc(s).replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => keep[Number(i)]);
}

export const RICH_CSS = `
.rx-display { display: block; margin: 8px 0; overflow-x: auto; overflow-y: hidden; }
.rx-pre { margin: 8px 0; padding: 10px 12px; border-radius: 10px; background: rgba(0,0,0,0.35); overflow-x: auto; text-align: left; font-size: 13px; line-height: 1.45; }
.rx-pre code, .rx-code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.rx-code { padding: 1px 6px; border-radius: 6px; background: rgba(0,0,0,0.28); font-size: .92em; }
.sh-flip .rx-code, .sh-flip .rx-pre { background: rgba(0,0,0,0.07); }
.katex { font-size: 1.08em; }
`;
