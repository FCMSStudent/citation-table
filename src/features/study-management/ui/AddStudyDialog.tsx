import { useState } from 'react';
import { Plus, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/shared/ui/Dialog';
import { Button } from '@/shared/ui/Button';
import { Input } from '@/shared/ui/Input';
import { Label } from '@/shared/ui/Label';
import { useAddStudyMutation } from '@/entities/report/api/report.mutations';
import { toast } from 'sonner';

interface AddStudyDialogProps {
  reportId: string;
}

export function AddStudyDialog({ reportId }: AddStudyDialogProps) {
  const [open, setOpen] = useState(false);
  const [doi, setDoi] = useState('');
  const addStudyMutation = useAddStudyMutation(reportId);
  const isLoading = addStudyMutation.isPending;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!doi.trim()) return;

    try {
      const data = await addStudyMutation.mutateAsync(doi);

      toast.success(`Added: ${data.study?.title || 'Study added'}`);
      setDoi('');
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add study');
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
