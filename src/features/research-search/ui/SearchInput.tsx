import { useState, FormEvent } from 'react';
import { Search, Loader2 } from 'lucide-react';
import { Button } from '@/shared/ui/button';

interface SearchInputProps {
  onSearch: (question: string) => void;
  isLoading: boolean;
}

export function SearchInput({ onSearch, isLoading }: SearchInputProps) {
  const [question, setQuestion] = useState('');

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (question.trim() && !isLoading) {
      onSearch(question.trim());
    }
  };

  const exampleQueries = [
    "What are the effects of sleep deprivation on cognitive performance?",
    "How does exercise affect depression symptoms?",
    "What factors influence vaccine hesitancy?",
  ];

  return (
    <div className="w-full max-w-4xl mx-auto">
      <form onSubmit={handleSubmit} className="relative">
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Enter your research question..."
            className="research-input pl-12 pr-28"
            disabled={isLoading}
            aria-label="Research question"
            maxLength={500}
          />
          <Button
            type="submit"
            disabled={!question.trim() || isLoading}
            className="absolute right-2 top-1/2 -translate-y-1/2"
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Searching
              </>
            ) : (
              'Search'
            )}
          </Button>
        </div>
      </form>
      
      {!isLoading && (
        <div className="mt-4 flex flex-wrap gap-2">
          <span className="text-sm text-muted-foreground">Try:</span>
          {exampleQueries.map((q, i) => (
            <button
              key={i}
              onClick={() => {
                setQuestion(q);
                onSearch(q);
              }}
              className="text-sm text-primary hover:underline focus:outline-none focus:underline text-left"
              aria-label={`Search for: ${q}`}
            >
              {q.length > 50 ? q.slice(0, 50) + '...' : q}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
