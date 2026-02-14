import * as React from "react";
import { FileText, FileX, Loader2, Download } from "lucide-react";
import type { StudyPdf } from "@/types/research";
import { Button } from "./button";
import { sanitizeUrl } from "@/lib/utils";

interface PdfLinkProps {
  /** Links derived from study data (PDF url, arXiv, etc.) */
  links?: { label: string; url: string }[];
  /** Sci-Hub / stored PDF data */
  pdfData?: StudyPdf;
  /** Compact mode: icon-only buttons */
  compact?: boolean;
}

export function PdfLink({ links = [], pdfData, compact = false }: PdfLinkProps) {
  // Merge Sci-Hub downloaded link into links list
  const allLinks = [...links];
  if (pdfData?.status === "downloaded" && pdfData.public_url) {
    allLinks.push({ label: "Sci-Hub", url: pdfData.public_url });
  }

  if (allLinks.length > 0) {
    if (compact) {
      return (
        <div className="flex gap-0.5">
          {allLinks.map((link, i) => (
            <Button key={i} variant="ghost" size="sm" className="h-7 w-7 p-0" asChild>
              <a
                href={sanitizeUrl(link.url)}
                target="_blank"
                rel="noopener noreferrer"
                title={link.label}
              >
                {link.label === "Sci-Hub" ? (
                  <Download className="h-3.5 w-3.5" />
                ) : (
                  <FileText className="h-3.5 w-3.5" />
                )}
              </a>
            </Button>
          ))}
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-1">
        {allLinks.map((link, i) => (
          <a
            key={i}
            href={sanitizeUrl(link.url)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <FileText className="h-3.5 w-3.5" /> {link.label}
          </a>
        ))}
      </div>
    );
  }

  // Pending state
  if (pdfData?.status === "pending") {
    return <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />;
  }

  // No PDF available
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <FileX className="h-3.5 w-3.5" /> No
    </span>
  );
}
