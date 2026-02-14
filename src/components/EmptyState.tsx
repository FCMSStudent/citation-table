import { FileSearch, Table2, Quote } from 'lucide-react';
import { FeatureCard } from './ui/feature-card';
import { IconBox } from './ui/icon-box';
import { BookOpen } from 'lucide-react';

export function EmptyState() {
  return (
    <div className="w-full max-w-2xl mx-auto py-16 text-center animate-fade-in">
      <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-6">
        <BookOpen className="h-8 w-8 text-primary" />
      </div>
      
      <h2 className="text-2xl font-semibold text-foreground mb-3">
        Research Question → Structured Evidence
      </h2>
      
      <p className="text-muted-foreground mb-8 max-w-lg mx-auto">
        Ask any research question. We'll search academic papers, extract structured data 
        from abstracts, and present citation-grounded results—no hallucinations, no inference.
      </p>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-left">
        <FeatureCard
          icon={FileSearch}
          title="Semantic Search"
          description="Searches OpenAlex + Semantic Scholar + arXiv using your natural language query"
        />
        <FeatureCard
          icon={Table2}
          title="Structured Extraction"
          description="Extracts study design, sample size, outcomes, and results into a table"
        />
        <FeatureCard
          icon={Quote}
          title="Citation Grounded"
          description="Every claim linked to source text. Null when not explicitly stated."
        />
      </div>
    </div>
  );
}
