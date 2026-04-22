import type { ReportCitation } from "@t3tools/contracts";
import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { CitationBadge } from "./CitationBadge";
import { SourcesList } from "./SourcesList";

// ---------------------------------------------------------------------------
// Citation link injection
// ---------------------------------------------------------------------------

/**
 * Transforms `[N]` markers in the markdown into inline links `[N](#cite-N)`
 * for any N that exists in the citation map. Inline markdown links like
 * `[1](some-url)` and image syntax `![1](...)` are left untouched.
 *
 * This is done via a pure string transform so no extra remark/rehype plugins
 * are needed. react-markdown renders the link, and we intercept `href="#cite-N"`
 * in the `a` component override.
 */
function injectCitationLinks(content: string, validIndices: ReadonlySet<number>): string {
  if (validIndices.size === 0) return content;
  // Match [N] that is NOT preceded by ! (image) and NOT followed by ( (real link) or : (definition)
  return content.replace(/(?<!!)\[(\d+)\](?![(:[\]])/g, (match, num: string) => {
    const n = parseInt(num, 10);
    return validIndices.has(n) ? `[${n}](#cite-${n})` : match;
  });
}

// ---------------------------------------------------------------------------
// ReportMarkdown
// ---------------------------------------------------------------------------

interface ReportMarkdownProps {
  content: string;
  citations?: ReadonlyArray<ReportCitation>;
}

export function ReportMarkdown({ content, citations = [] }: ReportMarkdownProps) {
  const citationsByIndex = useMemo(() => new Map(citations.map((c) => [c.index, c])), [citations]);

  // Determine which citation indices are still present in the current content
  // (after any manual user edits). This drives both badge rendering and the
  // sources footer — if [N] is deleted from the text, it vanishes from sources.
  const visibleIndices = useMemo(() => {
    const indices = new Set<number>();
    // Must use the same regex as injectCitationLinks to stay in sync
    const re = /(?<!!)\[(\d+)\](?![(:[\]])/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(content)) !== null) {
      const n = parseInt(match[1]!, 10);
      if (citationsByIndex.has(n)) indices.add(n);
    }
    return indices;
  }, [content, citationsByIndex]);

  const processedContent = useMemo(
    () => injectCitationLinks(content, new Set(citationsByIndex.keys())),
    [content, citationsByIndex],
  );

  return (
    <div className="report-markdown w-full min-w-0 text-sm leading-relaxed text-foreground">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Intercept citation links (#cite-N) and render as CitationBadge.
          // All other links are rendered normally.
          a: ({ href, children, ...rest }) => {
            if (typeof href === "string" && href.startsWith("#cite-")) {
              const n = parseInt(href.slice(6), 10);
              const citation = citationsByIndex.get(n);
              return (
                <CitationBadge
                  index={n}
                  documentName={citation?.documentName}
                  excerpt={citation?.excerpt}
                />
              );
            }
            return (
              <a href={href} {...rest}>
                {children}
              </a>
            );
          },
        }}
      >
        {processedContent}
      </ReactMarkdown>
      <SourcesList citations={citations} visibleIndices={visibleIndices} />
    </div>
  );
}
