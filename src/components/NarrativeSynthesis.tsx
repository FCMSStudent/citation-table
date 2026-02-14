import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Sparkles, AlertCircle, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Skeleton } from './ui/skeleton';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible';
import { getSupabase } from '@/integrations/supabase/fallback';
import type { StudyResult, SynthesisData, SynthesisClaim, SynthesisWarning } from '@/types/research';

interface NarrativeSynthesisProps {
  reportId: string;
  studies: StudyResult[];
  query: string;
  cachedSynthesis?: string | null;
}

function parseSynthesis(raw: string | null): SynthesisData | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed.sections && Array.isArray(parsed.sections)) return parsed as SynthesisData;
    return null;
  } catch {
    return null;
  }
}

function getAuthorLabel(title: string, year: number): string {
  // Extract first meaningful word(s) from title as author proxy
  const words = title.split(/[\s:,]+/).filter(Boolean);
  const first = words[0] || 'Study';
  return `${first} et al., ${year}`;
}

function ConfidenceDot({ level }: { level: string }) {
  const config = {
    high: { color: 'bg-emerald-500', label: 'Strong' },
    moderate: { color: 'bg-amber-500', label: 'Moderate' },
    low: { color: 'bg-muted-foreground/50', label: 'Limited' },
  }[level] || { color: 'bg-muted-foreground/50', label: 'Limited' };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center gap-1 mr-2">
            <span className={`inline-block h-2 w-2 rounded-full ${config.color}`} />
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{config.label}</span>
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs max-w-[200px]">
          Confidence based on number of supporting studies
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function CitationBadge({ studyIndex, studies }: { studyIndex: string; studies: StudyResult[] }) {
  const idx = parseInt(studyIndex.replace('study-', ''), 10);
  const study = studies[idx];
  if (!study) return <Badge variant="outline" className="text-[10px] mx-0.5">{studyIndex}</Badge>;

  const label = getAuthorLabel(study.title, study.year);

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="secondary" className="text-[10px] mx-0.5 cursor-help font-normal hover:bg-primary/20 transition-colors">
            {label}
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs max-w-[300px]">
          <p className="font-medium">{study.title}</p>
          <p className="text-muted-foreground mt-1">{study.study_design} · n={study.sample_size ?? 'NR'} · {study.citation?.doi || 'No DOI'}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function ClaimRow({ claim, studies }: { claim: SynthesisClaim; studies: StudyResult[] }) {
  return (
    <div className="flex items-start gap-2 py-2">
      <ConfidenceDot level={claim.confidence} />
      <div className="flex-1">
        <span className="text-sm text-foreground leading-relaxed">{claim.text} </span>
        <span className="inline-flex flex-wrap gap-0.5">
          {claim.citations.map((c) => (
            <CitationBadge key={c} studyIndex={c} studies={studies} />
          ))}
        </span>
      </div>
    </div>
  );
}

function WarningsPanel({ warnings }: { warnings: SynthesisWarning[] }) {
  const [open, setOpen] = useState(false);
  if (!warnings.length) return null;

  const gaps = warnings.filter((w) => w.type === 'gap');
  const quality = warnings.filter((w) => w.type === 'quality');

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mt-4">
      <CollapsibleTrigger asChild>
        <button className="flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-400 hover:underline w-full">
          <AlertTriangle className="h-4 w-4" />
          Evidence Gaps &amp; Warnings ({warnings.length})
          {open ? <ChevronUp className="h-3 w-3 ml-auto" /> : <ChevronDown className="h-3 w-3 ml-auto" />}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-3 space-y-2">
        {gaps.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-amber-800 dark:text-amber-300 uppercase tracking-wider mb-1">Evidence Gaps</p>
            <ul className="space-y-1">
              {gaps.map((w, i) => (
                <li key={i} className="text-xs text-amber-900 dark:text-amber-200 flex items-start gap-1.5">
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" />
                  {w.text}
                </li>
              ))}
            </ul>
          </div>
        )}
        {quality.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-amber-800 dark:text-amber-300 uppercase tracking-wider mb-1">Quality Concerns</p>
            <ul className="space-y-1">
              {quality.map((w, i) => (
                <li key={i} className="text-xs text-amber-900 dark:text-amber-200 flex items-start gap-1.5">
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" />
                  {w.text}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

function StructuredSynthesisView({ data, studies, onRegenerate }: { data: SynthesisData; studies: StudyResult[]; onRegenerate: () => void }) {
  return (
    <div className="rounded-lg border-l-4 border-l-primary bg-gradient-to-r from-primary/5 to-transparent p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h3 className="font-semibold text-foreground">Research Synthesis</h3>
        </div>
        <Button variant="ghost" size="sm" onClick={onRegenerate} className="gap-2 text-muted-foreground hover:text-foreground">
          <RefreshCw className="h-3 w-3" />Regenerate
        </Button>
      </div>

      <div className="space-y-4">
        {data.sections.map((section, si) => (
          <div key={si}>
            <h4 className="text-sm font-semibold text-foreground mb-1">{section.heading}</h4>
            <div className="divide-y divide-border/50">
              {section.claims.map((claim, ci) => (
                <ClaimRow key={ci} claim={claim} studies={studies} />
              ))}
            </div>
          </div>
        ))}
      </div>

      <WarningsPanel warnings={data.warnings || []} />
    </div>
  );
}

export function NarrativeSynthesis({ reportId, studies, query, cachedSynthesis }: NarrativeSynthesisProps) {
  const [rawSynthesis, setRawSynthesis] = useState<string | null>(cachedSynthesis || null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      <div className="rounded-lg border-l-4 border-l-primary bg-gradient-to-r from-primary/5 to-transparent p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary animate-pulse" />
          <h3 className="font-semibold text-foreground">Generating Evidence-Grounded Synthesis…</h3>
        </div>
        <div className="space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-4/6" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
        <p className="text-xs text-muted-foreground">
          Analyzing {studies.length} studies — grounding every claim to evidence table rows…
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
            <h3 className="font-semibold text-foreground">Synthesis Unavailable</h3>
          </div>
          <Button variant="outline" size="sm" onClick={generate} className="gap-2">
            <RefreshCw className="h-3 w-3" />Retry
          </Button>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">{error}</p>
      </div>
    );
  }

  if (!rawSynthesis) {
    return (
      <div className="rounded-lg border-l-4 border-l-primary bg-gradient-to-r from-primary/5 to-transparent p-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-foreground">Research Synthesis</h3>
          <Button variant="outline" size="sm" onClick={generate} className="gap-2">
            <Sparkles className="h-4 w-4" />Generate Synthesis
          </Button>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Generate an evidence-grounded synthesis with citation traceability across {studies.length} studies.
        </p>
      </div>
    );
  }

  // Try structured JSON format first, fall back to markdown
  const structured = parseSynthesis(rawSynthesis);

  if (structured) {
    return <StructuredSynthesisView data={structured} studies={studies} onRegenerate={generate} />;
  }

  // Legacy markdown fallback
  return (
    <div className="rounded-lg border-l-4 border-l-primary bg-gradient-to-r from-primary/5 to-transparent p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h3 className="font-semibold text-foreground">Research Synthesis</h3>
          <Badge variant="outline" className="text-[10px]">Legacy</Badge>
        </div>
        <Button variant="ghost" size="sm" onClick={generate} className="gap-2 text-muted-foreground hover:text-foreground">
          <RefreshCw className="h-3 w-3" />Regenerate
        </Button>
      </div>
      <div className="prose prose-sm max-w-none text-muted-foreground prose-headings:text-foreground prose-headings:text-sm prose-headings:font-semibold prose-headings:mt-4 prose-headings:mb-1 prose-p:my-1.5 prose-p:leading-relaxed">
        <ReactMarkdown>{rawSynthesis}</ReactMarkdown>
      </div>
    </div>
  );
}
