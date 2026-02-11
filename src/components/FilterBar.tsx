import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Switch } from './ui/switch';
import { Label } from './ui/label';

export type SortOption = 'relevance' | 'year';
export type DesignFilterOption = 'all' | 'meta' | 'review' | 'unknown';

interface FilterBarProps {
  sortBy: SortOption;
  designFilter: DesignFilterOption;
  cognitiveOnly: boolean;
  onSortByChange: (value: SortOption) => void;
  onDesignFilterChange: (value: DesignFilterOption) => void;
  onCognitiveOnlyChange: (value: boolean) => void;
}

export function FilterBar({
  sortBy,
  designFilter,
  cognitiveOnly,
  onSortByChange,
  onDesignFilterChange,
  onCognitiveOnlyChange,
}: FilterBarProps) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="grid gap-3 md:grid-cols-3">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Sort by</Label>
          <Select value={sortBy} onValueChange={(value) => onSortByChange(value as SortOption)}>
            <SelectTrigger>
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="relevance">Relevance</SelectItem>
              <SelectItem value="year">Year</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Study design</Label>
          <Select
            value={designFilter}
            onValueChange={(value) => onDesignFilterChange(value as DesignFilterOption)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Study design" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="meta">Meta-analysis</SelectItem>
              <SelectItem value="review">Review</SelectItem>
              <SelectItem value="unknown">Unknown</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-end">
          <Label className="flex items-center gap-2 text-sm cursor-pointer">
            <Switch checked={cognitiveOnly} onCheckedChange={onCognitiveOnlyChange} />
            Explicit cognitive outcome only
          </Label>
        </div>
      </div>
    </div>
  );
}
