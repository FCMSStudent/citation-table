import { useState } from 'react';
import { Plus, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/shared/ui/Dialog';
import { Button } from '@/shared/ui/Button';
import { Input } from '@/shared/ui/Input';
import { Label } from '@/shared/ui/Label';
import { getSupabase } from '@/integrations/supabase/fallback';
import { toast } from 'sonner';

interface AddStudyDialogProps {
  reportId: string;
  onStudyAdded: () => void;
}

export function AddStudyDialog({ reportId, onStudyAdded }: AddStudyDialogProps) {
  const [open, setOpen] = useState(false);
  const [doi, setDoi] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!doi.trim()) return;

    setIsLoading(true);
    try {
      const client = getSupabase();
      const { data: { session } } = await client.auth.getSession();
      if (!session?.access_token) {
        toast.error('Please sign in to add studies');
        return;
      }

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const resp = await fetch(`${supabaseUrl}/functions/v1/add-study`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({ report_id: reportId, doi: doi.trim() }),
      });

      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.error || 'Failed to add study');
      }

      toast.success(`Added: ${data.study?.title || 'Study added'}`);
      setDoi('');
      setOpen(false);
      onStudyAdded();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add study');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Plus className="h-4 w-4" />
          Add Study by DOI
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Study by DOI</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="doi">DOI</Label>
            <Input
              id="doi"
              placeholder="e.g. 10.1038/s41586-023-06185-3"
              value={doi}
              onChange={(e) => setDoi(e.target.value)}
              disabled={isLoading}
            />
            <p className="text-xs text-muted-foreground">
              Enter a DOI to fetch metadata and extract study data automatically.
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={isLoading}>
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading || !doi.trim()}>
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Adding…
                </>
              ) : (
                'Add Study'
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
