import { Info } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface QueryNormalizationNoticeProps {
  originalQuery: string;
  normalizedQuery: string;
}

export function QueryNormalizationNotice({ originalQuery, normalizedQuery }: QueryNormalizationNoticeProps) {
  return (
    <Alert className="mb-4 border-blue-200 bg-blue-50 dark:bg-blue-950 dark:border-blue-800">
      <Info className="h-4 w-4 text-blue-600 dark:text-blue-500" />
      <AlertDescription className="text-sm text-blue-900 dark:text-blue-100">
        <strong>Query Normalization:</strong> Your query was normalized to enable safe literature retrieval.
        <div className="mt-2 space-y-1">
          <div><span className="font-medium">Original:</span> "{originalQuery}"</div>
          <div><span className="font-medium">Normalized:</span> "{normalizedQuery}"</div>
        </div>
      </AlertDescription>
    </Alert>
  );
}
