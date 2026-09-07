import { marked, type Tokens } from 'marked';
import sanitize from 'sanitize-html';

function escapeHtml(text: string) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Fenced blocks carry their language on the <pre>, where the stylesheet can
// print it as the block's header. The class on <code> stays for tooling.
const renderer = {
  code({ text, lang }: Tokens.Code): string {
    const language = (lang || '').trim().split(/\s+/)[0].replace(/[^\w.+#-]/g, '').slice(0, 24);
    const attribute = language ? ` data-lang="${escapeHtml(language)}"` : '';
    const className = language ? ` class="language-${escapeHtml(language)}"` : '';
    return `<pre${attribute}><code${className}>${escapeHtml(text)}\n</code></pre>\n`;
  }
};
marked.use({ renderer });

export function renderMarkdown(text: string): string {
  return sanitize(marked.parse(text, { async: false, breaks: true, gfm: true }), {
    allowedTags: ['p', 'br', 'strong', 'em', 'del', 'blockquote', 'pre', 'code', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'a', 'table', 'thead', 'tbody', 'tr', 'th', 'td'],
    allowedAttributes: { a: ['href', 'rel', 'target'], code: ['class'], pre: ['data-lang'], ol: ['start'] },
    allowedClasses: { code: ['language-*'] },
    allowedSchemes: ['https', 'http', 'mailto'], allowProtocolRelative: false,
    transformTags: { a: sanitize.simpleTransform('a', { rel: 'noopener noreferrer', target: '_blank' }) }
  });
}
