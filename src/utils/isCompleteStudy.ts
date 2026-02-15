import type { StudyResult } from "@/shared/types/research";

/**
 * Returns true only if the study has title, year, a known design,
 * a substantive abstract, and at least one outcome with a PICO metric.
 */
export function isCompleteStudy(study: StudyResult): boolean {
  if (!study.title || !study.year) return false;
  if (study.study_design === "unknown") return false;
  if (!study.abstract_excerpt || study.abstract_excerpt.trim().length < 50) return false;
  if (!study.outcomes || study.outcomes.length === 0) return false;

  const hasCompleteOutcome = study.outcomes.some(
    (o) =>
      o.outcome_measured &&
      (o.effect_size || o.p_value || o.intervention || o.comparator),
  );
  return hasCompleteOutcome;
}
