import { useState, useRef, useEffect } from 'react';
import { Copy, Check } from 'lucide-react';
import { Button } from './Button';
import { toast } from './Sonner';

export function CopyButton({ content, label = 'Copy', className }: { content: string, label?: string, className?: string }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const handleCopy = async () => {
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      toast.success(label === 'Copy' ? 'Copied to clipboard' : `${label} copied to clipboard`);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      toast.error('Failed to copy to clipboard');
    }
  };

  return (
    <Button variant="ghost" size="sm" onClick={handleCopy} className={className}
      aria-label={copied ? 'Copied' : (label === 'Copy' ? 'Copy to clipboard' : `Copy ${label.toLowerCase()}`)}>
      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      <span>{copied ? 'Copied' : label}</span>
    </Button>
  );
}
