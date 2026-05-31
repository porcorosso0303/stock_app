import MarkdownIt from "markdown-it";

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: false
});

export function renderMarkdown(source: string): string {
  return markdown.render(source.replace(/\b(?:javascript|vbscript|data):/gi, ""));
}

export function renderReportHtml(source: string): string {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <style>
      :root {
        color: #17202a;
        font-family: "Microsoft YaHei", "Segoe UI", sans-serif;
        line-height: 1.65;
      }
      body { margin: 32px 42px; }
      h1, h2, h3 { color: #12344d; page-break-after: avoid; }
      a { color: #0969da; overflow-wrap: anywhere; }
      table { border-collapse: collapse; width: 100%; }
      th, td { border: 1px solid #d0d7de; padding: 6px 8px; }
      blockquote { border-left: 3px solid #d0d7de; margin-left: 0; padding-left: 12px; }
      pre { background: #f6f8fa; padding: 12px; white-space: pre-wrap; }
      @media print {
        body { margin: 0; }
        a { color: #17202a; text-decoration: none; }
      }
    </style>
  </head>
  <body>${renderMarkdown(source)}</body>
</html>`;
}
