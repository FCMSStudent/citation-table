import { AlertTriangle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

export function MedicalDisclaimer() {
  return (
    <Alert className="mb-6 border-amber-200 bg-amber-50 dark:bg-amber-950 dark:border-amber-800">
      <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-500" />
      <AlertDescription className="text-sm text-amber-900 dark:text-amber-100">
        <strong>Medical Disclaimer:</strong> This tool retrieves and structures published research only. 
        It does not provide clinical recommendations, conclusions, or medical advice.
      </AlertDescription>
    </Alert>
  );
}
