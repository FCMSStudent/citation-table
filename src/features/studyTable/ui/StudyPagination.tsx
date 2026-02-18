import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/shared/ui/Button';
import { cn } from '@/shared/lib/utils';
import { useStudyTableContext } from '@/features/studyTable/ui/StudyTableContext';

export function StudyPagination() {
  const state = useStudyTableContext();
  if (state.mainStudies.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-3">
      <span className="text-sm text-muted-foreground">Showing {state.startItem}-{state.endItem} of {state.mainStudies.length}</span>
      <div className="flex items-center gap-1">
        <Button variant="outline" size="sm" disabled={state.currentPage === 1} onClick={() => state.setCurrentPage((p) => p - 1)} className="gap-1">
          <ChevronLeft className="h-4 w-4" /> Prev
        </Button>

        {state.pageWindow[0] > 1 && (
          <>
            <button type="button" onClick={() => state.setCurrentPage(1)} className="h-8 min-w-8 rounded border px-2 text-xs">1</button>
            {state.pageWindow[0] > 2 && <span className="px-1 text-xs text-muted-foreground">…</span>}
          </>
        )}

        {state.pageWindow.map((page) => (
          <button
            key={page}
            type="button"
            onClick={() => state.setCurrentPage(page)}
            className={cn('h-8 min-w-8 rounded border px-2 text-xs', page === state.currentPage ? 'border-primary bg-primary/10 text-foreground' : 'text-muted-foreground')}
          >
            {page}
          </button>
        ))}

        {state.pageWindow[state.pageWindow.length - 1] < state.totalPages && (
          <>
            {state.pageWindow[state.pageWindow.length - 1] < state.totalPages - 1 && <span className="px-1 text-xs text-muted-foreground">…</span>}
            <button type="button" onClick={() => state.setCurrentPage(state.totalPages)} className="h-8 min-w-8 rounded border px-2 text-xs">{state.totalPages}</button>
          </>
        )}

        <Button variant="outline" size="sm" disabled={state.currentPage === state.totalPages} onClick={() => state.setCurrentPage((p) => p + 1)} className="gap-1">
          Next <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
