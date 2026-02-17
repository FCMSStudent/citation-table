import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import { RefreshCw, Sparkles, AlertCircle, AlertTriangle, Copy, Check } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { Button } from '@/shared/ui/Button';
import { Badge } from '@/shared/ui/Badge';
import { Skeleton } from '@/shared/ui/Skeleton';
import { toast } from '@/shared/ui/Sonner';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/shared/ui/Tooltip';
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/Popover';
import { getSupabase } from '@/integrations/supabase/fallback';
import type { StudyResult, SynthesisData, SynthesisWarning, NarrativeSynthesisData } from '@/shared/types/research';

interface NarrativeSynthesisProps {
  reportId: string;
  studies: StudyResult[];
  query: string;
  cachedSynthesis?: string | null;
  truncateLines?: number;
}

type ParsedSynthesis =
  | { type: 'narrative'; data: NarrativeSynthesisData }
  | { type: 'structured'; data: SynthesisData }
  | null;

function parseSynthesis(raw: string | null): ParsedSynthesis {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed.narrative && typeof parsed.narrative === 'string') {
      return { type: 'narrative', data: parsed as NarrativeSynthesisData };
    }
    if (parsed.sections && Array.isArray(parsed.sections)) {
      return { type: 'structured', data: parsed as SynthesisData };
    }
    return null;
  } catch {
    return null;
  }
}

function getCitationNumber(studyIndex: string): number | null {
  const idx = parseInt(studyIndex.replace('study-', ''), 10);
  return Number.isFinite(idx) && idx >= 0 ? idx + 1 : null;
}

function WarningsPopover({ warnings }: { warnings: SynthesisWarning[] }) {
  if (!warnings.length) return null;
  const gaps = warnings.filter((w) => w.type === 'gap');
  const quality = warnings.filter((w) => w.type === 'quality');

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="inline-flex items-center gap-1.5 text-xs text-amber-700 hover:text-amber-800 dark:text-amber-400 dark:hover:text-amber-300">
          <AlertTriangle className="h-3.5 w-3.5" />
          Warnings ({warnings.length})
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 max-w-[90vw]">
        <div className="space-y-3">
          {gaps.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-900 dark:text-amber-300">Evidence gaps</p>
              <ul className="mt-1 space-y-1 text-xs text-amber-800 dark:text-amber-200">
                {gaps.map((w, i) => (
                  <li key={i} className="flex gap-2">
                    <span>•</span>
                    <span>{w.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {quality.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-900 dark:text-amber-300">Quality concerns</p>
              <ul className="mt-1 space-y-1 text-xs text-amber-800 dark:text-amber-200">
                {quality.map((w, i) => (
                  <li key={i} className="flex gap-2">
                    <span>•</span>
                    <span>{w.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function SummaryFrame({
  titleAddon,
  warnings,
  children,
  onRegenerate,
  contentToCopy,
}: {
  titleAddon?: ReactNode;
  warnings?: SynthesisWarning[];
  children: ReactNode;
  onRegenerate: () => void;
  contentToCopy?: string;
}) {
  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) window.clearTimeout(copyTimeoutRef.current);
    };
  }, []);

  const handleCopy = async () => {
    if (!contentToCopy) return;
    try {
      await navigator.clipboard.writeText(contentToCopy);
      setCopied(true);
      toast.success('Summary copied to clipboard');

      if (copyTimeoutRef.current) window.clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = window.setTimeout(() => {
        setCopied(false);
        copyTimeoutRef.current = null;
      }, 2000);
    } catch (err) {
      toast.error('Failed to copy summary');
    }
  };

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h3 className="font-semibold text-foreground">Summary</h3>
          {titleAddon}
        </div>
        <div className="flex items-center gap-3">
          {contentToCopy && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCopy}
              className="gap-2 text-muted-foreground hover:text-foreground"
            >
              {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              {copied ? 'Copied' : 'Copy'}
            </Button>
          )}
          {!!warnings?.length && <WarningsPopover warnings={warnings} />}
          <Button
            variant="ghost"
            size="sm"
            onClick={onRegenerate}
            className="gap-2 text-muted-foreground hover:text-foreground"
          >
            <RefreshCw className="h-3 w-3" />
            Regenerate
          </Button>
        </div>
      </div>
      {children}
    </div>
  );
}

function ElicitStyleView({
  data,
  onRegenerate,
  truncateLines,
}: {
  data: NarrativeSynthesisData;
  onRegenerate: () => void;
  truncateLines: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const canExpand = data.narrative.length > 360;

  return (
    <SummaryFrame
      warnings={data.warnings || []}
      onRegenerate={onRegenerate}
      contentToCopy={data.narrative}
    >
      <div
        className="prose prose-sm max-w-none text-foreground prose-p:my-2.5 prose-p:leading-relaxed prose-strong:text-foreground prose-strong:font-semibold"
        style={
          !expanded && canExpand
            ? {
                display: '-webkit-box',
                WebkitLineClamp: truncateLines,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }
            : undefined
        }
      >
        <ReactMarkdown>{data.narrative}</ReactMarkdown>
      </div>
      {canExpand && (
        <button
          type="button"
          className="mt-2 text-xs text-primary hover:underline"
          onClick={() => setExpanded((prev) => !prev)}
          aria-expanded={expanded}
        >
          {expanded ? 'Read less' : 'Read more'}
        </button>
      )}
    </SummaryFrame>
  );
}

function StructuredSynthesisView({
  data,
  onRegenerate,
}: {
  data: SynthesisData;
  onRegenerate: () => void;
}) {
  const contentToCopy = useMemo(() => {
    return data.sections
      .map((section) => {
        const claimsText = section.claims.map((c) => c.text).join('\n');
        return `${section.heading}\n${claimsText}`;
      })
      .join('\n\n');
  }, [data.sections]);

  return (
    <SummaryFrame
      titleAddon={
        <Badge variant="outline" className="text-[10px]">
          Legacy
        </Badge>
      }
      warnings={data.warnings || []}
      onRegenerate={onRegenerate}
      contentToCopy={contentToCopy}
    >
      <div className="space-y-4">
        {data.sections.map((section, si) => (
          <div key={si}>
            <h4 className="text-sm font-semibold text-foreground mb-1">{section.heading}</h4>
            <div className="space-y-2">
              {section.claims.map((claim, ci) => (
                <div key={ci} className="text-sm text-foreground leading-relaxed">
                  {claim.text}{' '}
                  <span className="inline-flex flex-wrap gap-1 align-middle">
                    {claim.citations.map((c) => {
                      const refNum = getCitationNumber(c);
                      const refLabel = refNum ? `[${refNum}]` : c;
                      return (
                        <TooltipProvider key={`${c}-${ci}`}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="rounded border px-1.5 py-0.5 text-[11px] text-muted-foreground">
                                {refLabel}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="text-xs max-w-[220px]">
                              Study reference {refLabel}
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      );
                    })}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </SummaryFrame>
  );
}

export function NarrativeSynthesis({
  reportId,
  studies,
  query,
  cachedSynthesis,
  truncateLines = 6,
}: NarrativeSynthesisProps) {
  const [rawSynthesis, setRawSynthesis] = useState<string | null>(cachedSynthesis || null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  void query;

  const generate = useCallback(async () => {
    setIsGenerating(true);
    setError(null);

    try {
      const client = getSupabase();
      const { data: result, error: invokeError } = await client.functions.invoke('synthesize-papers', {
        body: { report_id: reportId },
      });

      if (invokeError) {
        throw new Error(invokeError.message || 'Failed to generate synthesis');
      }

      setRawSynthesis(result.synthesis);
    } catch (err) {
      console.error('Synthesis generation failed:', err);
      setError(err instanceof Error ? err.message : 'Failed to generate synthesis');
    } finally {
      setIsGenerating(false);
    }
  }, [reportId]);

  useEffect(() => {
    if (!cachedSynthesis && studies.length > 0 && !rawSynthesis && !isGenerating) {
      generate();
    }
  }, [cachedSynthesis, studies.length]); // eslint-disable-line react-hooks/exhaustive-deps

  if (isGenerating) {
    return (
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary animate-pulse" />
          <h3 className="font-semibold text-foreground">Generating summary…</h3>
        </div>
        <div className="space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-4/6" />
          <Skeleton className="h-4 w-full" />
        </div>
        <p className="text-xs text-muted-foreground">
          Analyzing {studies.length} studies with citation grounding.
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border-l-4 border-l-destructive bg-destructive/5 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-destructive" />
            <h3 className="font-semibold text-foreground">Summary unavailable</h3>
          </div>
          <Button variant="outline" size="sm" onClick={generate} className="gap-2">
            <RefreshCw className="h-3 w-3" />
            Retry
          </Button>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">{error}</p>
      </div>
    );
  }

  if (!rawSynthesis) {
    return (
      <div className="rounded-lg border bg-card p-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-foreground">Summary</h3>
          <Button variant="outline" size="sm" onClick={generate} className="gap-2">
            <Sparkles className="h-4 w-4" />
            Generate
          </Button>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Generate an evidence-grounded summary across {studies.length} studies.
        </p>
      </div>
    );
  }

  const parsed = parseSynthesis(rawSynthesis);

  if (parsed?.type === 'narrative') {
    return <ElicitStyleView data={parsed.data} onRegenerate={generate} truncateLines={truncateLines} />;
  }

  if (parsed?.type === 'structured') {
    return <StructuredSynthesisView data={parsed.data} onRegenerate={generate} />;
  }

  if (rawSynthesis.trimStart().startsWith('{') || rawSynthesis.trimStart().startsWith('[')) {
    return (
      <div className="rounded-lg border-l-4 border-l-destructive bg-destructive/5 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-destructive" />
            <h3 className="font-semibold text-foreground">Summary data corrupted</h3>
          </div>
          <Button variant="outline" size="sm" onClick={generate} className="gap-2">
            <RefreshCw className="h-3 w-3" />
            Regenerate
          </Button>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Cached summary payload was invalid JSON. Regenerate to recover.
        </p>
      </div>
    );
  }

  return (
    <SummaryFrame
      titleAddon={
        <Badge variant="outline" className="text-[10px]">
          Legacy
        </Badge>
      }
      onRegenerate={generate}
      contentToCopy={rawSynthesis || ''}
    >
      <div
        className="prose prose-sm max-w-none text-muted-foreground prose-headings:text-foreground prose-headings:text-sm prose-headings:font-semibold prose-headings:mt-4 prose-headings:mb-1 prose-p:my-1.5 prose-p:leading-relaxed"
        style={{
          display: '-webkit-box',
          WebkitLineClamp: truncateLines,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        <ReactMarkdown>{rawSynthesis}</ReactMarkdown>
      </div>
    </SummaryFrame>
  );
}
