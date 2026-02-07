import { AlertCircle, Info } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ErrorMessageProps {
  message: string;
  variant?: 'error' | 'info';
}

export function ErrorMessage({ message, variant = 'error' }: ErrorMessageProps) {
  const isInfo = variant === 'info' || message.toLowerCase().includes('no papers');
  
  return (
    <div 
      className={cn(
        "flex items-start gap-3 p-4 rounded-lg animate-fade-in",
        isInfo ? "bg-info/10 text-info" : "bg-destructive/10 text-destructive"
      )}
    >
      {isInfo ? (
        <Info className="h-5 w-5 flex-shrink-0 mt-0.5" />
      ) : (
        <AlertCircle className="h-5 w-5 flex-shrink-0 mt-0.5" />
      )}
      <p className="text-sm">{message}</p>
    </div>
  );
}
