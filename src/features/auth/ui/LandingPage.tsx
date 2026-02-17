import { Link } from 'react-router-dom';
import { Search, FileText, Shield, ArrowRight } from 'lucide-react';
import { Button } from '@/shared/ui/Button';
import { PageShell } from '@/shared/ui/PageShell';
import { PageHeader } from '@/shared/ui/PageHeader';
import { FeatureCard } from '@/shared/ui/FeatureCard';

const Landing = () => {
  return (
    <PageShell>
      {/* Nav */}
      <header className="border-b border-border">
        <div className="container max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-primary/10">
              <Search className="h-5 w-5 text-primary" />
            </div>
            <span className="text-lg font-semibold text-foreground tracking-tight">Research Assistant</span>
          </div>
          <Link to="/auth">
            <Button variant="outline" size="sm">Sign In</Button>
          </Link>
        </div>
      </header>

      {/* Hero */}
      <main className="container max-w-4xl mx-auto px-4 py-24 text-center">
        <h1 className="text-4xl md:text-5xl font-bold text-foreground tracking-tight leading-tight">
          Evidence extraction,<br />grounded in citations
        </h1>
        <p className="mt-6 text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
          Ask a research question and get structured findings from PubMed, OpenAlex, Semantic Scholar, and arXiv — ranked by relevance, with full citation context.
        </p>
        <div className="mt-10 flex items-center justify-center gap-4">
          <Link to="/auth">
            <Button size="lg" className="gap-2">
              Get Started <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        </div>

        {/* Features */}
        <div className="mt-24 grid md:grid-cols-3 gap-8 text-left">
          <FeatureCard
            icon={Search}
            title="Multi-source search"
            description="Queries PubMed, OpenAlex, Semantic Scholar, and arXiv in parallel, then deduplicates and ranks results."
          />
          <FeatureCard
            icon={FileText}
            title="Citation-grounded"
            description="Every finding links back to its source paper with DOI, journal, and publication date."
          />
          <FeatureCard
            icon={Shield}
            title="AI synthesis"
            description="Get a narrative summary and chat with your papers to explore the evidence interactively."
          />
        </div>
      </main>
    </PageShell>
  );
};

export default Landing;
