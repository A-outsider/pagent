import { renderMarkdown } from '@/shared/utils/markdown';
import { cn } from '@/shared/utils/utils';

export function MarkdownContent({
  text,
  streaming,
}: {
  text: string;
  streaming?: boolean;
}) {
  return (
    <div
      className={cn(
        'pagent-md',
        streaming && 'is-streaming',
      )}
      dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }}
    />
  );
}
