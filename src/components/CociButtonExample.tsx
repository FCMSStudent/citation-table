/**
 * Example usage of the CociButton component
 * 
 * This file demonstrates how to integrate the COCI citations button
 * into your React application to display citation data from OpenCitations.
 */

import { CociButton } from "@/components/CociButton";

export function CociButtonExample() {
  // Example DOI - replace with actual DOI from your data
  const exampleDoi = "10.1371/journal.pone.0000001";

  return (
    <div className="space-y-6 max-w-2xl mx-auto p-6">
      <div className="space-y-2">
        <h2 className="text-2xl font-bold">COCI Citation Button Example</h2>
        <p className="text-muted-foreground">
          Click the button below to fetch and display citation data from OpenCitations COCI API.
        </p>
      </div>

      {/* Basic usage */}
      <div className="border rounded-lg p-4 space-y-3">
        <h3 className="font-semibold">Basic Usage</h3>
        <CociButton doi={exampleDoi} />
      </div>

      {/* Multiple DOIs example */}
      <div className="border rounded-lg p-4 space-y-4">
        <h3 className="font-semibold">Multiple Papers</h3>
        <div className="space-y-3">
          <div>
            <p className="text-sm text-muted-foreground mb-2">
              Paper 1: {exampleDoi}
            </p>
            <CociButton doi={exampleDoi} />
          </div>
          <div>
            <p className="text-sm text-muted-foreground mb-2">
              Paper 2: 10.1093/nar/gkaa1106
            </p>
            <CociButton doi="10.1093/nar/gkaa1106" />
          </div>
        </div>
      </div>

      {/* Integration example */}
      <div className="border rounded-lg p-4 space-y-3">
        <h3 className="font-semibold">Integration with Study Results</h3>
        <p className="text-sm text-muted-foreground">
          The CociButton can be integrated into study cards or result tables.
          Simply pass the DOI from your StudyResult object:
        </p>
        <pre className="bg-muted p-3 rounded text-xs overflow-x-auto">
          {`<StudyCard study={study}>
  {study.citation.doi && (
    <CociButton doi={study.citation.doi} />
  )}
</StudyCard>`}
        </pre>
      </div>

      {/* Configuration note */}
      <div className="border rounded-lg p-4 space-y-3 bg-muted/30">
        <h3 className="font-semibold">Configuration Required</h3>
        <p className="text-sm text-muted-foreground">
          The COCI integration requires:
        </p>
        <ul className="text-sm text-muted-foreground list-disc pl-5 space-y-1">
          <li>
            <code className="bg-background px-1 rounded">VITE_SUPABASE_URL</code> 
            {" "}environment variable set in <code className="bg-background px-1 rounded">.env.local</code>
          </li>
          <li>
            The <code className="bg-background px-1 rounded">coci</code> Supabase Edge Function 
            deployed to your Supabase project
          </li>
          <li>
            Deploy with: <code className="bg-background px-1 rounded">supabase functions deploy coci</code>
          </li>
        </ul>
      </div>
    </div>
  );
}
