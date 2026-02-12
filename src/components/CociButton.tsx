import { useState } from "react";
import { Button } from "@/components/ui/button";
import { fetchCociForDoi, type CociCitation } from "@/lib/coci";
import { Loader2 } from "lucide-react";

interface CociButtonProps {
  doi: string;
}

/**
 * CociButton - React component that displays a button to fetch and show COCI citations
 * 
 * @param doi - The DOI to query for citations
 */
export function CociButton({ doi }: CociButtonProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [citations, setCitations] = useState<CociCitation[] | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  const handleFetchCitations = async () => {
    if (!doi) {
      setError("No DOI provided");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await fetchCociForDoi(doi);
      setCitations(result.citations);
      setIsExpanded(true);
    } catch (err) {
      console.error("Error fetching COCI citations:", err);
      setError(err instanceof Error ? err.message : "Failed to fetch citations");
      setCitations(null);
    } finally {
      setIsLoading(false);
    }
  };

  const handleToggle = () => {
    if (isExpanded) {
      setIsExpanded(false);
    } else if (citations) {
      setIsExpanded(true);
    } else {
      handleFetchCitations();
    }
  };

  return (
    <div className="space-y-3">
      <Button
        onClick={handleToggle}
        disabled={isLoading}
        variant="outline"
        size="sm"
        className="w-full sm:w-auto"
      >
        {isLoading ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Loading COCI citations...
          </>
        ) : isExpanded ? (
          "Hide COCI citations"
        ) : citations ? (
          `Show COCI citations (${citations.length})`
        ) : (
          "Show COCI citations"
        )}
      </Button>

      {error && (
        <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">
          <strong>Error:</strong> {error}
        </div>
      )}

      {isExpanded && citations && citations.length > 0 && (
        <div className="border rounded-md p-4 bg-muted/30">
          <h3 className="text-sm font-semibold mb-3">
            COCI Citations ({citations.length})
          </h3>
          <ul className="space-y-2 text-sm">
            {citations.map((citation, index) => (
              <li key={index} className="border-l-2 border-primary/30 pl-3">
                <div className="font-mono text-xs">
                  <span className="text-muted-foreground">Citing:</span>{" "}
                  <span className="font-medium">{citation.citing}</span>
                </div>
                <div className="font-mono text-xs">
                  <span className="text-muted-foreground">Cited:</span>{" "}
                  <span className="font-medium">{citation.cited}</span>
                </div>
                {citation.citation_date && (
                  <div className="text-xs text-muted-foreground mt-1">
                    Date: {citation.citation_date}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {isExpanded && citations && citations.length === 0 && (
        <div className="text-sm text-muted-foreground bg-muted/30 p-3 rounded-md">
          No citations found in COCI for this DOI.
        </div>
      )}
    </div>
  );
}
