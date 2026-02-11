import { Label } from './ui/label';
import { Switch } from './ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';

export type SortOption = 'relevance' | 'year';
export type StudyDesignFilter = 'all' | 'meta' | 'review' | 'unknown';

interface FilterBarProps {
  sortBy: SortOption;
  onSortByChange: (value: SortOption) => void;
  studyDesign: StudyDesignFilter;
  onStudyDesignChange: (value: StudyDesignFilter) => void;
  explicitOnly: boolean;
  onExplicitOnlyChange: (value: boolean) => void;
}

export function FilterBar({
  sortBy,
  onSortByChange,
  studyDesign,
  onStudyDesignChange,
  explicitOnly,
  onExplicitOnlyChange,
}: FilterBarProps) {
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-3">
      <div className="min-w-[170px] space-y-1">
        <Label className="text-xs text-muted-foreground">Sort by</Label>
        <Select value={sortBy} onValueChange={(value: SortOption) => onSortByChange(value)}>
          <SelectTrigger>
            <SelectValue placeholder="Select sort" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="relevance">Relevance</SelectItem>
            <SelectItem value="year">Year</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="min-w-[200px] space-y-1">
        <Label className="text-xs text-muted-foreground">Study design</Label>
        <Select value={studyDesign} onValueChange={(value: StudyDesignFilter) => onStudyDesignChange(value)}>
          <SelectTrigger>
            <SelectValue placeholder="Select design" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="meta">Meta-analysis</SelectItem>
            <SelectItem value="review">Review</SelectItem>
            <SelectItem value="unknown">Unknown</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center gap-2 rounded-md border px-3 py-2">
        <Switch checked={explicitOnly} onCheckedChange={onExplicitOnlyChange} id="explicit-outcomes" />
        <Label htmlFor="explicit-outcomes" className="text-sm">
          Explicit cognitive outcome only
        </Label>
      </div>
    </div>
  );
}
