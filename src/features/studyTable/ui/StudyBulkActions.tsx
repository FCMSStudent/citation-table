import { Download } from 'lucide-react';
import { Button } from '@/shared/ui/Button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/shared/ui/DropdownMenu';
import { useStudyTableContext } from '@/features/studyTable/ui/StudyTableContext';

export function StudyBulkActions() {
  const state = useStudyTableContext();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Download className="h-4 w-4" />
          Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={state.handleExportCSVPapers}>CSV (Paper-level)</DropdownMenuItem>
        <DropdownMenuItem onClick={state.handleExportCSVOutcomes}>CSV (Outcomes)</DropdownMenuItem>
        <DropdownMenuItem onClick={state.handleExportRIS}>RIS</DropdownMenuItem>
        <DropdownMenuItem onClick={state.handleExportManifest}>Export manifest (JSON)</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
