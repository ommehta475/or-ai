import { useEffect, useMemo, useRef } from 'react';
import { enhanceMarkdownContainer, renderSafeMarkdownHtml } from '../lib/markdown';

interface MarkdownMessageProps {
  content: string;
}

export function MarkdownMessage({ content }: MarkdownMessageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const safeHtml = useMemo(() => renderSafeMarkdownHtml(content), [content]);

  useEffect(() => {
    if (containerRef.current) {
      enhanceMarkdownContainer(containerRef.current);
    }
  }, [safeHtml]);

  return (
    <div
      ref={containerRef}
      className="orlixa-markdown text-[15px] text-slate-900 dark:text-slate-100"
      dangerouslySetInnerHTML={{ __html: safeHtml }}
    />
  );
}
