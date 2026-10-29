// The blog at /blog: static HTML pages made from the Markdown files in
// content/blog, so search engines get real pages instead of the React app's
// empty <div id="root">. `vite build` writes them into dist/blog; `vite` serves
// them from memory and re-reads the files on every request.
//
// A post is a .md file whose name is its URL (content/blog/study-schedule.md →
// /blog/study-schedule), starting with:
//   ---
//   title: How to make a study schedule
//   description: One or two sentences for Google and link previews (≤160 chars).
//   date: 2026-10-28
//   updated: 2026-11-02   (optional)
//   draft: true           (optional; left out of the build)
//   ---
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { Marked } from 'marked'
import type { Plugin } from 'vite'

export const SITE = 'https://somastudy.app'
const POSTS_DIR = 'content/blog'
const AUTHOR = 'The Soma team'

export type Post = {
  slug: string
  title: string
  description: string
  date: string
  updated?: string
  html: string
  minutes: number
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const slugify = (s: string) =>
  s.toLowerCase().replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

const longDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })

// Headings get ids so a section can be linked to; links off the site open with
// rel="noopener".
const markdown = new Marked({
  gfm: true,
  renderer: {
    heading({ tokens, depth }) {
      const text = this.parser.parseInline(tokens)
      return `<h${depth} id="${slugify(text)}">${text}</h${depth}>\n`
    },
    link({ href, title, tokens }) {
      const text = this.parser.parseInline(tokens)
      const external = /^https?:\/\//.test(href) && !href.startsWith(SITE)
      return `<a href="${escapeHtml(href)}"${title ? ` title="${escapeHtml(title)}"` : ''}${external ? ' rel="noopener"' : ''}>${text}</a>`
    },
  },
})

function parsePost(file: string, source: string): (Post & { draft: boolean }) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(source)
  if (!match) throw new Error(`${file}: missing the --- front matter --- at the top`)
  const meta: Record<string, string> = {}
  for (const line of match[1].split(/\r?\n/)) {
    const kv = /^(\w+):\s*(.*)$/.exec(line.trim())
    if (kv) meta[kv[1]] = kv[2].replace(/^["']|["']$/g, '')
  }
  for (const key of ['title', 'description', 'date']) {
    if (!meta[key]) throw new Error(`${file}: front matter needs a "${key}:" line`)
  }
  for (const key of ['date', 'updated']) {
    if (meta[key] && !/^\d{4}-\d{2}-\d{2}$/.test(meta[key])) throw new Error(`${file}: ${key} must look like 2026-10-28`)
  }
  const body = match[2]
  return {
    slug: file.replace(/\.md$/, ''),
    title: meta.title,
    description: meta.description,
    date: meta.date,
    updated: meta.updated || undefined,
    draft: meta.draft === 'true',
    html: markdown.parse(body, { async: false }),
    minutes: Math.max(1, Math.round(body.split(/\s+/).filter(Boolean).length / 230)),
  }
}

export function loadPosts(root = process.cwd()): Post[] {
  const dir = join(root, POSTS_DIR)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(f => /^[a-z0-9-]+\.md$/.test(f))
    .map(f => parsePost(f, readFileSync(join(dir, f), 'utf8')))
    .filter(p => !p.draft)
    .map(({ draft: _draft, ...p }) => p)
    .sort((a, b) => b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug))
}

/* ─────────────  Pages  ───────────── */

const CSS = `
:root {
  --blue-700: #1d4ed8; --blue-800: #1e40af; --blue-950: #172554; --blue-50: #eff6ff;
  --slate-50: #f8fafc; --slate-100: #f1f5f9; --slate-200: #e2e8f0; --slate-300: #cbd5e1;
  --slate-400: #94a3b8; --slate-500: #64748b; --slate-600: #475569; --slate-700: #334155; --slate-900: #0f172a;
}
*, *::before, *::after { box-sizing: border-box; }
body {
  margin: 0; min-height: 100dvh;
  font-family: 'Figtree', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  background: var(--slate-50); color: var(--slate-900);
  line-height: 1.55; letter-spacing: -0.011em; -webkit-font-smoothing: antialiased;
}
a { color: inherit; }

.nav {
  position: sticky; top: 16px; z-index: 10;
  width: calc(100% - 48px); max-width: 1160px; height: 60px; margin: 16px auto 0;
  padding: 0 10px 0 18px; background: #fff;
  border: 1px solid var(--slate-200); border-radius: 999px;
  box-shadow: 0 1px 2px rgba(15,23,42,.04), 0 8px 26px rgba(15,23,42,.07);
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
}
.brand { font-size: 19px; font-weight: 700; letter-spacing: -0.03em; text-decoration: none; }
.nav-right { display: flex; align-items: center; gap: 6px; }
.nav-link {
  font-size: 14.5px; font-weight: 500; color: var(--slate-600); text-decoration: none;
  padding: 8px 13px; border-radius: 8px; transition: color .15s, background .15s;
}
.nav-link:hover { color: var(--slate-900); background: var(--slate-100); }
.nav-link[aria-current="page"] { color: var(--slate-900); }
.btn {
  display: inline-block; font-size: 14.5px; font-weight: 600; letter-spacing: -0.01em;
  color: #fff; background: var(--blue-800); border-radius: 999px; padding: 9px 18px;
  text-decoration: none; transition: background .15s;
}
.btn:hover { background: var(--blue-950); }

.wrap { max-width: 720px; margin: 0 auto; padding: 72px 24px 0; }
.eyebrow { font-size: 14px; font-weight: 600; color: var(--blue-700); text-decoration: none; margin: 0 0 14px; display: inline-block; }
.eyebrow:hover { text-decoration: underline; }
h1 {
  font-size: clamp(32px, 4.6vw, 48px); font-weight: 600; line-height: 1.1;
  letter-spacing: -0.035em; margin: 0 0 16px; text-wrap: balance;
}
.lead { font-size: 18.5px; line-height: 1.6; color: var(--slate-600); margin: 0 0 18px; text-wrap: pretty; }
.meta { font-size: 14px; color: var(--slate-500); margin: 0; }

.list { list-style: none; padding: 0; margin: 40px 0 0; border-top: 1px solid var(--slate-200); }
.list li { border-bottom: 1px solid var(--slate-200); }
.list a { display: block; padding: 26px 0; text-decoration: none; }
.list h2 { font-size: 22px; font-weight: 600; letter-spacing: -0.02em; line-height: 1.25; margin: 0 0 8px; }
.list a:hover h2 { color: var(--blue-800); }
.list p { font-size: 16px; color: var(--slate-600); margin: 0 0 10px; line-height: 1.55; }

.post-head { padding-bottom: 32px; border-bottom: 1px solid var(--slate-200); margin-bottom: 36px; }
.prose { font-size: 17.5px; line-height: 1.72; color: var(--slate-700); }
.prose > * { margin: 0 0 1.15em; }
.prose h2 { font-size: 26px; font-weight: 600; letter-spacing: -0.025em; line-height: 1.25; color: var(--slate-900); margin: 1.9em 0 .6em; scroll-margin-top: 96px; }
.prose h3 { font-size: 20px; font-weight: 600; letter-spacing: -0.015em; line-height: 1.3; color: var(--slate-900); margin: 1.6em 0 .5em; scroll-margin-top: 96px; }
.prose strong { color: var(--slate-900); font-weight: 650; }
.prose a { color: var(--blue-700); text-decoration: underline; text-underline-offset: 2px; text-decoration-thickness: 1px; }
.prose a:hover { color: var(--blue-950); }
.prose ul, .prose ol { padding-left: 1.3em; }
.prose li { margin: .35em 0; padding-left: .2em; }
.prose li::marker { color: var(--slate-400); }
.prose blockquote { margin-left: 0; padding: 2px 0 2px 20px; border-left: 3px solid var(--slate-300); color: var(--slate-600); }
.prose code { font-family: ui-monospace, 'SF Mono', Menlo, monospace; font-size: .88em; background: var(--slate-100); padding: .12em .38em; border-radius: 5px; }
.prose hr { border: 0; border-top: 1px solid var(--slate-200); margin: 2.4em 0; }
.prose table { width: 100%; border-collapse: collapse; font-size: 15.5px; display: block; overflow-x: auto; }
.prose th, .prose td { text-align: left; padding: 10px 14px 10px 0; border-bottom: 1px solid var(--slate-200); white-space: nowrap; }
.prose th { font-weight: 600; color: var(--slate-900); font-size: 14px; }

.cta {
  margin: 56px 0 0; padding: 30px 32px; background: #fff;
  border: 1px solid var(--slate-200); border-radius: 14px;
  box-shadow: 0 1px 2px rgba(15,23,42,.04);
}
.cta h2 { font-size: 21px; font-weight: 600; letter-spacing: -0.02em; margin: 0 0 8px; }
.cta p { font-size: 16px; color: var(--slate-600); margin: 0 0 20px; line-height: 1.6; }
.cta .btn { font-size: 15px; padding: 11px 22px; border-radius: 8px; }

.more { margin-top: 64px; }
.more-title { font-size: 14.5px; font-weight: 700; margin: 0; }
.more .list { margin-top: 14px; }
.more .list a { padding: 18px 0; }
.more .list h2 { font-size: 18px; margin: 0 0 4px; }
.more .list p { font-size: 15px; margin: 0; }

.foot { border-top: 1px solid var(--slate-200); background: #fff; margin-top: 96px; }
.foot-in {
  max-width: 1160px; margin: 0 auto; padding: 32px 24px;
  display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 16px 28px;
}
.foot-links { display: flex; flex-wrap: wrap; gap: 8px 22px; }
.foot a { font-size: 14px; color: var(--slate-500); text-decoration: none; }
.foot a:hover { color: var(--slate-900); }
.foot small { font-size: 13px; color: var(--slate-400); }

@media (max-width: 640px) {
  .nav { width: calc(100% - 32px); }
  .nav-link.hide-sm { display: none; }
  .wrap { padding: 48px 16px 0; }
  .prose { font-size: 17px; }
  .cta { padding: 24px 20px; }
  .foot-in { padding: 28px 16px; }
}
`

// Vercel Web Analytics, as the app sends it: origin + path only
// (see src/main.tsx). Production builds only; the script exists only on Vercel.
const ANALYTICS = `<script>
window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };
window.va('beforeSend', function (e) { var u = new URL(e.url); return Object.assign({}, e, { url: u.origin + u.pathname }); });
</script>
<script defer src="/_vercel/insights/script.js"></script>`

type PageOptions = { analytics: boolean }

function page(o: PageOptions & {
  title: string
  description: string
  path: string
  type: 'website' | 'article'
  head?: string
  current: 'index' | 'post'
  body: string
}) {
  const url = `${SITE}${o.path}`
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(o.title)}</title>
<meta name="description" content="${escapeHtml(o.description)}" />
<link rel="canonical" href="${url}" />
<link rel="icon" type="image/x-icon" href="/favicon.ico" />
<link rel="icon" type="image/png" href="/soma-cross-icon.png" />
<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
<link rel="alternate" type="application/rss+xml" title="Soma blog" href="${SITE}/blog/rss.xml" />
<meta property="og:type" content="${o.type}" />
<meta property="og:url" content="${url}" />
<meta property="og:title" content="${escapeHtml(o.title)}" />
<meta property="og:description" content="${escapeHtml(o.description)}" />
<meta property="og:site_name" content="Soma" />
<meta name="twitter:card" content="summary" />
<meta name="twitter:title" content="${escapeHtml(o.title)}" />
<meta name="twitter:description" content="${escapeHtml(o.description)}" />
${o.head ?? ''}<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700&display=swap" rel="stylesheet" />
<style>${CSS}</style>
${o.analytics ? ANALYTICS : ''}
</head>
<body>
<nav class="nav">
  <a href="/" class="brand">soma</a>
  <div class="nav-right">
    <a href="/blog" class="nav-link"${o.current === 'index' ? ' aria-current="page"' : ''}>Blog</a>
    <a href="/login" class="nav-link hide-sm">Log in</a>
    <a href="/signup" class="btn">Get started</a>
  </div>
</nav>
<main class="wrap">
${o.body}
</main>
<footer class="foot">
  <div class="foot-in">
    <div class="foot-links">
      <a href="/">Home</a>
      <a href="/blog">Blog</a>
      <a href="/pricing">Pricing</a>
      <a href="/privacy">Privacy</a>
      <a href="/terms">Terms</a>
      <a href="/contact">Contact</a>
    </div>
    <small>© ${new Date().getFullYear()} Soma. Not affiliated with Canvas, Instructure, Google, or any school.</small>
  </div>
</footer>
</body>
</html>
`
}

const jsonLd = (data: unknown) =>
  `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>\n`

const postItem = (p: Post, withMeta = true) => `<li><a href="/blog/${p.slug}">
  <h2>${escapeHtml(p.title)}</h2>
  <p>${escapeHtml(p.description)}</p>${withMeta ? `\n  <span class="meta"><time datetime="${p.date}">${longDate(p.date)}</time> · ${p.minutes} min read</span>` : ''}
</a></li>`

export function renderIndex(posts: Post[], o: PageOptions) {
  const description = 'Practical guides for students: planning your week, keeping up with Canvas, working out your grade, and studying with a timer.'
  return page({
    ...o,
    title: 'Blog | Soma',
    description,
    path: '/blog',
    type: 'website',
    current: 'index',
    head: jsonLd({
      '@context': 'https://schema.org',
      '@type': 'Blog',
      name: 'Soma blog',
      url: `${SITE}/blog`,
      description,
      publisher: { '@type': 'Organization', name: 'Soma', url: SITE },
      blogPost: posts.map(p => ({ '@type': 'BlogPosting', headline: p.title, url: `${SITE}/blog/${p.slug}`, datePublished: p.date })),
    }),
    body: `<h1>The Soma blog</h1>
<p class="lead">${description}</p>
${posts.length ? `<ul class="list">\n${posts.map(p => postItem(p)).join('\n')}\n</ul>` : '<p class="meta">No posts yet.</p>'}`,
  })
}

export function renderPost(post: Post, posts: Post[], o: PageOptions) {
  const url = `${SITE}/blog/${post.slug}`
  const others = posts.filter(p => p.slug !== post.slug).slice(0, 3)
  return page({
    ...o,
    title: `${post.title} | Soma`,
    description: post.description,
    path: `/blog/${post.slug}`,
    type: 'article',
    current: 'post',
    head: `<meta property="article:published_time" content="${post.date}" />
${post.updated ? `<meta property="article:modified_time" content="${post.updated}" />\n` : ''}${jsonLd({
      '@context': 'https://schema.org',
      '@type': 'BlogPosting',
      headline: post.title,
      description: post.description,
      url,
      mainEntityOfPage: url,
      datePublished: post.date,
      dateModified: post.updated ?? post.date,
      author: { '@type': 'Organization', name: AUTHOR, url: SITE },
      publisher: { '@type': 'Organization', name: 'Soma', url: SITE, logo: { '@type': 'ImageObject', url: `${SITE}/apple-touch-icon.png` } },
    })}${jsonLd({
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Soma', item: SITE },
        { '@type': 'ListItem', position: 2, name: 'Blog', item: `${SITE}/blog` },
        { '@type': 'ListItem', position: 3, name: post.title, item: url },
      ],
    })}`,
    body: `<article>
<header class="post-head">
  <a href="/blog" class="eyebrow">Blog</a>
  <h1>${escapeHtml(post.title)}</h1>
  <p class="lead">${escapeHtml(post.description)}</p>
  <p class="meta">${AUTHOR} · <time datetime="${post.date}">${longDate(post.date)}</time>${post.updated ? ` · Updated <time datetime="${post.updated}">${longDate(post.updated)}</time>` : ''} · ${post.minutes} min read</p>
</header>
<div class="prose">
${post.html}</div>
</article>
<aside class="cta">
  <h2>Let Soma do the planning</h2>
  <p>Soma pulls every assignment from Canvas, turns your deadlines into a plan for the day, and keeps the time you actually study, course by course.</p>
  <a href="/signup" class="btn">Try Soma free</a>
</aside>
${others.length ? `<section class="more">
  <p class="more-title">More from the blog</p>
  <ul class="list">
${others.map(p => postItem(p, false)).join('\n')}
  </ul>
</section>` : ''}`,
  })
}

export function renderRss(posts: Post[]) {
  const rfc822 = (iso: string) => new Date(`${iso}T12:00:00Z`).toUTCString()
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>Soma blog</title>
  <link>${SITE}/blog</link>
  <atom:link href="${SITE}/blog/rss.xml" rel="self" type="application/rss+xml" />
  <description>Practical guides for students from the makers of Soma.</description>
  <language>en-us</language>
${posts.map(p => `  <item>
    <title>${escapeHtml(p.title)}</title>
    <link>${SITE}/blog/${p.slug}</link>
    <guid>${SITE}/blog/${p.slug}</guid>
    <pubDate>${rfc822(p.date)}</pubDate>
    <description>${escapeHtml(p.description)}</description>
  </item>`).join('\n')}
</channel>
</rss>
`
}

export function renderSitemap(posts: Post[]) {
  const newest = posts[0]
  const urls = [
    ...(newest ? [{ loc: `${SITE}/blog`, lastmod: newest.updated ?? newest.date }] : []),
    ...posts.map(p => ({ loc: `${SITE}/blog/${p.slug}`, lastmod: p.updated ?? p.date })),
  ]
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url>\n    <loc>${u.loc}</loc>\n    <lastmod>${u.lastmod}</lastmod>\n  </url>`).join('\n')}
</urlset>
`
}

/** Every blog file, keyed by its path under the site root. */
export function blogFiles(posts: Post[], o: PageOptions): Record<string, string> {
  const files: Record<string, string> = {
    'blog/index.html': renderIndex(posts, o),
    'blog/rss.xml': renderRss(posts),
    'blog/sitemap.xml': renderSitemap(posts),
  }
  for (const p of posts) files[`blog/${p.slug}.html`] = renderPost(p, posts, o)
  return files
}

export function blogPlugin(): Plugin {
  let root = process.cwd()
  let outDir = 'dist'
  let production = false
  return {
    name: 'soma-blog',
    configResolved(config) {
      root = config.root
      outDir = resolve(config.root, config.build.outDir)
      production = config.command === 'build' && config.mode === 'production'
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '').split(/[?#]/)[0].replace(/\/$/, '')
        if (path !== '/blog' && !path.startsWith('/blog/')) return next()
        try {
          const files = blogFiles(loadPosts(root), { analytics: false })
          const key = path === '/blog' ? 'blog/index.html' : path.endsWith('.xml') ? path.slice(1) : `${path.slice(1)}.html`
          const body = files[key]
          res.statusCode = body ? 200 : 404
          res.setHeader('Content-Type', key.endsWith('.xml') ? 'application/xml; charset=utf-8' : 'text/html; charset=utf-8')
          res.end(body ?? '<!doctype html><title>Not found</title><p>No such post. <a href="/blog">Back to the blog</a></p>')
        } catch (err) {
          next(err)
        }
      })
    },
    closeBundle() {
      if (this.meta.watchMode) return
      const files = blogFiles(loadPosts(root), { analytics: production })
      for (const [path, body] of Object.entries(files)) {
        const out = join(outDir, path)
        mkdirSync(dirname(out), { recursive: true })
        writeFileSync(out, body)
      }
    },
  }
}
