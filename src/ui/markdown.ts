// Minimal, dependency-free Markdown renderer for notes preview.
// Supports: #/##/### headings, **bold**, *italic*, `code`, - lists,
// > quotes, ![alt](assets/img.png) images (resolved to data URIs by the
// caller), [text](url) links (rendered as plain styled text — no navigation,
// the app is offline by design), and paragraphs.

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inline(md: string, assets: Map<string, string>): string {
  let out = escapeHtml(md);
  // images: ![alt](assets/name)
  out = out.replace(/!\[([^\]]*)\]\(assets\/([^)]+)\)/g, (_m, alt, name) => {
    const data = assets.get(name);
    if (!data) return `<span class="md-missing-img">[${escapeHtml(alt || name)}]</span>`;
    return `<img src="${data}" alt="${escapeHtml(alt)}" class="md-img" />`;
  });
  // links become styled text (offline app: no navigation)
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<span class="md-link" title="$2">$1</span>');
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
  return out;
}

export function renderMarkdown(md: string, assets: Map<string, string>): string {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const html: string[] = [];
  let inList = false;
  let para: string[] = [];

  const flushPara = () => {
    if (para.length) {
      html.push(`<p>${inline(para.join(" "), assets)}</p>`);
      para = [];
    }
  };
  const closeList = () => {
    if (inList) {
      html.push("</ul>");
      inList = false;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      flushPara();
      closeList();
      html.push(`<h${h[1].length}>${inline(h[2], assets)}</h${h[1].length}>`);
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      flushPara();
      if (!inList) {
        html.push("<ul>");
        inList = true;
      }
      html.push(`<li>${inline(line.replace(/^[-*]\s+/, ""), assets)}</li>`);
      continue;
    }
    if (/^>\s?/.test(line)) {
      flushPara();
      closeList();
      html.push(`<blockquote>${inline(line.replace(/^>\s?/, ""), assets)}</blockquote>`);
      continue;
    }
    if (line.trim() === "") {
      flushPara();
      closeList();
      continue;
    }
    closeList();
    para.push(line);
  }
  flushPara();
  closeList();
  return html.join("\n");
}

/** Extract `assets/<name>` references so the caller can load them. */
export function assetRefs(md: string): string[] {
  const out = new Set<string>();
  for (const m of md.matchAll(/!\[[^\]]*\]\(assets\/([^)]+)\)/g)) {
    out.add(m[1]);
  }
  return [...out];
}
