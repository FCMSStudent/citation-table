import * as React from "react";
import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

interface StudyMetaProps {
  title: string;
  citation: string | null | undefined;
  year: number | null | undefined;
  citationCount?: number | null;
  preprintStatus?: string;
  doi?: string | null;
  className?: string;
}

function extractAuthors(citation: string | null | undefined): string {
  if (!citation) return "Unknown";
  const match = citation.match(/^([^,(]+)/);
  return match ? match[1].replace(/\set al\.?$/i, "").trim() : "Unknown";
}

export function StudyMeta({
  title,
  citation,
  year,
  citationCount,
  preprintStatus,
  doi,
  className,
}: StudyMetaProps) {
  const authors = extractAuthors(citation);

  return (
    <div className={cn(className)}>
      <div className="font-medium leading-tight text-foreground">{title}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">
        {authors}, {year || "—"}
        {citationCount != null && (
          <span className="ml-1.5">({citationCount} cit.)</span>
        )}
        {preprintStatus === "Preprint" && (
          <span className="ml-1.5 rounded bg-amber-100 px-1 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-900/50 dark:text-amber-200">
            Preprint
          </span>
        )}
      </div>
      {doi && (
        <div className="mt-1 flex gap-1">
          <a
            href={`https://doi.org/${doi}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-0.5 text-xs text-primary hover:underline"
          >
            DOI <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      )}
    </div>
  );
}
