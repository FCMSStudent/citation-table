import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Sparkles, AlertCircle } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { Button } from './ui/button';
import { Skeleton } from './ui/skeleton';
import type { StudyResult } from '@/types/research';

interface NarrativeSynthesisProps {
  reportId: string;
  studies: StudyResult[];
  query: string;
  cachedSynthesis?: string | null;
}

export function NarrativeSynthesis({ reportId, studies, query, cachedSynthesis }: NarrativeSynthesisProps) {
  const [synthesis, setSynthesis] = useState<string | null>(cachedSynthesis || null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(async () => {
    setIsGenerating(true);
    setError(null);

    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://amzlrrrhjsqjndbrdume.supabase.co';
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFtemxycnJoanNxam5kYnJkdW1lIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA0MTQ1NDIsImV4cCI6MjA4NTk5MDU0Mn0.UbmXG7RfWAQjNX9HTkCp50m_wwSFB4P40gfuqCA-f2c';

      const res = await fetch(`${supabaseUrl}/functions/v1/synthesize-papers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${anonKey}`,
        },
        body: JSON.stringify({ report_id: reportId }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed to generate synthesis (${res.status})`);
      }

      const data = await res.json();
      setSynthesis(data.synthesis);
    } catch (err) {
      console.error('Synthesis generation failed:', err);
      setError(err instanceof Error ? err.message : 'Failed to generate synthesis');
    } finally {
      setIsGenerating(false);
    }
  }, [reportId]);

  // Auto-generate on mount if no cached synthesis
  useEffect(() => {
    if (!cachedSynthesis && studies.length > 0 && !synthesis && !isGenerating) {
      generate();
    }
  }, [cachedSynthesis, studies.length]); // eslint-disable-line react-hooks/exhaustive-deps

  if (isGenerating) {
    return (
      <div className="rounded-lg border-l-4 border-l-primary bg-gradient-to-r from-primary/5 to-transparent p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary animate-pulse" />
          <h3 className="font-semibold text-foreground">Generating Research Synthesis…</h3>
        </div>
        <div className="space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-4/6" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
        <p className="text-xs text-muted-foreground">
          Analyzing {studies.length} studies for patterns, agreement, and limitations…
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

  if (!synthesis) {
    return (
      <div className="rounded-lg border-l-4 border-l-primary bg-gradient-to-r from-primary/5 to-transparent p-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-foreground">Research Synthesis</h3>
          <Button variant="outline" size="sm" onClick={generate} className="gap-2">
            <Sparkles className="h-4 w-4" />Generate Synthesis
          </Button>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Generate an AI-powered synthesis that identifies patterns, agreement, and limitations across {studies.length} studies.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border-l-4 border-l-primary bg-gradient-to-r from-primary/5 to-transparent p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h3 className="font-semibold text-foreground">Research Synthesis</h3>
        </div>
        <Button variant="ghost" size="sm" onClick={generate} className="gap-2 text-muted-foreground hover:text-foreground">
          <RefreshCw className="h-3 w-3" />Regenerate
        </Button>
      </div>
      <div className="prose prose-sm max-w-none text-muted-foreground prose-headings:text-foreground prose-headings:text-sm prose-headings:font-semibold prose-headings:mt-4 prose-headings:mb-1 prose-p:my-1.5 prose-p:leading-relaxed">
        <ReactMarkdown>{synthesis}</ReactMarkdown>
      </div>
    </div>
  );
}
