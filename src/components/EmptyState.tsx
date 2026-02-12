import { BookOpen, Table2, Quote, FileSearch } from 'lucide-react';

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
        <div className="p-4 rounded-lg bg-card border border-border">
          <FileSearch className="h-5 w-5 text-primary mb-2" />
          <h3 className="font-medium text-foreground mb-1">Semantic Search</h3>
          <p className="text-sm text-muted-foreground">
            Searches OpenAlex + Semantic Scholar + arXiv using your natural language query
          </p>
        </div>
        
        <div className="p-4 rounded-lg bg-card border border-border">
          <Table2 className="h-5 w-5 text-primary mb-2" />
          <h3 className="font-medium text-foreground mb-1">Structured Extraction</h3>
          <p className="text-sm text-muted-foreground">
            Extracts study design, sample size, outcomes, and results into a table
          </p>
        </div>
        
        <div className="p-4 rounded-lg bg-card border border-border">
          <Quote className="h-5 w-5 text-primary mb-2" />
          <h3 className="font-medium text-foreground mb-1">Citation Grounded</h3>
          <p className="text-sm text-muted-foreground">
            Every claim linked to source text. Null when not explicitly stated.
          </p>
        </div>
      </div>
    </div>
  );
}
