import { Filter, RotateCcw } from 'lucide-react';
import { Badge } from '@/shared/ui/Badge';
import { Button } from '@/shared/ui/Button';
import { Input } from '@/shared/ui/Input';
import { Switch } from '@/shared/ui/Switch';
import { Tabs, TabsList, TabsTrigger } from '@/shared/ui/Tabs';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/shared/ui/DropdownMenu';
import { StudyBulkActions } from '@/features/studyTable/ui/StudyBulkActions';
import { useStudyTableContext } from '@/features/studyTable/ui/StudyTableContext';
import type { SortOption, StudyDesignFilter, ViewMode } from '@/features/studyTable/model/useStudyTableState';

export function StudyFiltersBar() {
  const state = useStudyTableContext();

  return (
    <div className="sticky top-[68px] z-20 mb-4 rounded-lg border bg-background/95 p-2 backdrop-blur-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs value={state.viewMode} onValueChange={(nextMode) => state.setViewMode(nextMode as ViewMode)}>
          <TabsList>
            <TabsTrigger value="summary">Summary</TabsTrigger>
            <TabsTrigger value="studies">Studies</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex items-center gap-2">
          <select
            value={state.sortBy}
            onChange={(e) => {
              state.trackFirstInteraction('sort_change');
              state.setSortBy(e.target.value as SortOption);
              state.setCurrentPage(1);
            }}
            className="h-9 rounded-md border bg-background px-2 text-sm"
            aria-label="Sort studies"
          >
            <option value="relevance">Sort: Relevance</option>
            <option value="year">Sort: Year</option>
          </select>

          <StudyBulkActions />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2">
                <Filter className="h-4 w-4" />
                More filters
                {state.activeFilterCount > 0 && (
                  <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                    {state.activeFilterCount}
                  </Badge>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[320px] p-3" onCloseAutoFocus={(e) => e.preventDefault()}>
              <div className="space-y-3" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Study design</label>
                  <select
                    value={state.studyDesign}
                    onChange={(e) => {
                      state.setStudyDesign(e.target.value as StudyDesignFilter);
                      state.setCurrentPage(1);
                    }}
                    className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm"
                  >
                    <option value="all">All</option>
                    <option value="rct">RCT</option>
                    <option value="cohort">Cohort</option>
                    <option value="cross-sectional">Cross-sectional</option>
                    <option value="meta">Meta-analysis</option>
                    <option value="review">Review</option>
                    <option value="unknown">Unknown</option>
                  </select>
                </div>

                <div className="flex items-center justify-between rounded-md border px-3 py-2">
                  <label htmlFor="explicit-only-filter" className="text-sm text-foreground">Explicit outcomes only</label>
                  <Switch
                    id="explicit-only-filter"
                    checked={state.explicitOnly}
                    onCheckedChange={(checked) => {
                      state.setExplicitOnly(checked);
                      state.setCurrentPage(1);
                    }}
                  />
                </div>

                <div>
                  <label htmlFor="find-results-filter" className="text-xs font-medium text-muted-foreground">Find in results</label>
                  <Input
                    id="find-results-filter"
                    value={state.findInput}
                    onChange={(e) => {
                      state.setFindInput(e.target.value);
                      state.setCurrentPage(1);
                    }}
                    placeholder="Filter visible fields..."
                    className="mt-1 h-9"
                  />
                </div>

                <Button type="button" variant="ghost" size="sm" className="w-full gap-2" onClick={state.handleResetFilters}>
                  <RotateCcw className="h-3.5 w-3.5" />
                  Reset filters
                </Button>
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}
