import DOMPurify from 'dompurify';
import hljs from 'highlight.js';
import { marked } from 'marked';

marked.setOptions({
  breaks: true,
  gfm: true,
});

export function renderSafeMarkdownHtml(markdown: string): string {
  const rawHtml = marked.parse(markdown || '', { async: false }) as string;
  return DOMPurify.sanitize(rawHtml, {
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i,
  });
}

export function enhanceMarkdownContainer(container: HTMLElement): void {
  container.querySelectorAll('pre code').forEach((block) => {
    hljs.highlightElement(block as HTMLElement);
  });

  container.querySelectorAll('a').forEach((anchor) => {
    anchor.setAttribute('target', '_blank');
    anchor.setAttribute('rel', 'noopener noreferrer');
  });

  container.querySelectorAll('pre').forEach((pre) => {
    if (pre.querySelector('.orlixa-copy-code-btn')) return;
    const codeEl = pre.querySelector('code');
    const langMatch = codeEl?.className.match(/language-([a-z0-9_+-]+)/i);
    const headerBar = document.createElement('div');
    headerBar.className =
      'orlixa-copy-code-btn absolute top-0 left-0 right-0 h-8 px-3 flex items-center justify-between border-b border-slate-800/80 text-xs text-slate-400 select-none';

    const langLabel = document.createElement('span');
    langLabel.className = 'font-mono text-[11px] text-slate-400';
    langLabel.textContent = langMatch ? langMatch[1] : 'code';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'text-xs font-medium text-sky-400 hover:text-sky-300 cursor-pointer';
    btn.textContent = 'Copy';
    btn.addEventListener('click', async () => {
      const textToCopy = codeEl ? codeEl.textContent || '' : pre.textContent || '';
      await navigator.clipboard.writeText(textToCopy);
      btn.textContent = 'Copied';
      setTimeout(() => {
        btn.textContent = 'Copy';
      }, 1500);
    });

    headerBar.appendChild(langLabel);
    headerBar.appendChild(btn);
    pre.appendChild(headerBar);
  });
}
