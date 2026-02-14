import type { StudyResult } from '@/types/research';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { ScrollArea } from './ui/scroll-area';

interface CompareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  studies: StudyResult[];
}

export function CompareDialog({ open, onOpenChange, studies }: CompareDialogProps) {
  if (studies.length === 0) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>Compare Studies ({studies.length})</DialogTitle>
        </DialogHeader>
        <ScrollArea className="h-[60vh]">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="border p-2 text-left font-semibold text-muted-foreground">Attribute</th>
                  {studies.map((s) => (
                    <th key={s.study_id} className="border p-2 text-left font-semibold min-w-[200px]">
                      {s.title.length > 60 ? s.title.slice(0, 60) + '…' : s.title}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <Row label="Year" values={studies.map((s) => String(s.year || '—'))} />
                <Row label="Design" values={studies.map((s) => s.study_design || 'Unknown')} />
                <Row label="Review Type" values={studies.map((s) => s.review_type || 'None')} />
                <Row label="Sample Size" values={studies.map((s) => s.sample_size != null ? String(s.sample_size) : '—')} />
                <Row label="Population" values={studies.map((s) => s.population || '—')} />
                <Row label="Preprint" values={studies.map((s) => s.preprint_status)} />
                <Row label="Source" values={studies.map((s) => s.source)} />
                <Row
                  label="Key Outcomes"
                  values={studies.map((s) =>
                    s.outcomes
                      ?.filter((o) => o.key_result)
                      .map((o) => `${o.outcome_measured}: ${o.key_result}`)
                      .join('\n') || '—'
                  )}
                  multiline
                />
              </tbody>
            </table>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, values, multiline = false }: { label: string; values: string[]; multiline?: boolean }) {
  return (
    <tr>
      <td className="border p-2 font-medium text-muted-foreground bg-muted/30 whitespace-nowrap">{label}</td>
      {values.map((v, i) => (
        <td key={i} className="border p-2">
          {multiline ? (
            <div className="whitespace-pre-line text-xs">{v}</div>
          ) : (
            v
          )}
        </td>
      ))}
    </tr>
  );
}
