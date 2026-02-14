export type EffectDirection = 'positive' | 'negative' | 'neutral' | 'mixed';

const POSITIVE_PATTERNS = [
  /\bimprov(ed|ement|ing)\b/i,
  /\benhanced?\b/i,
  /\bbeneficial\b/i,
  /\bprotective\b/i,
  /\breduced?\s+(symptoms?|risk|pain|anxiety|depression|mortality)\b/i,
  /\bsignificant\s+decrease\s+in\b/i,
  /\bsignificant\s+improvement\b/i,
  /\bsignificant\s+reduction\b/i,
  /\bpositive\s+(effect|outcome|impact|association)\b/i,
  /\bhigher\s+(efficacy|effectiveness)\b/i,
  /\blower\s+(risk|mortality|incidence)\b/i,
];

const NEGATIVE_PATTERNS = [
  /\bworsen(ed|ing)?\b/i,
  /\bincreased?\s+risk\b/i,
  /\badverse\b/i,
  /\bharmful\b/i,
  /\bdeclined?\b/i,
  /\bdeteriorate[ds]?\b/i,
  /\bnegative\s+(effect|outcome|impact|association)\b/i,
  /\bhigher\s+(risk|mortality|incidence)\b/i,
  /\bexacerbat(ed|ing)\b/i,
];

const NEUTRAL_PATTERNS = [
  /\bno\s+significant\b/i,
  /\bno\s+difference\b/i,
  /\bsimilar\b/i,
  /\bno\s+association\b/i,
  /\bno\s+effect\b/i,
  /\bnon-?significant\b/i,
  /\bnot\s+significant(ly)?\b/i,
  /\binsufficient\s+evidence\b/i,
  /\binconclusive\b/i,
];

export function getEffectDirection(keyResult: string | null | undefined): EffectDirection {
  if (!keyResult) return 'neutral';

  const hasPositive = POSITIVE_PATTERNS.some((p) => p.test(keyResult));
  const hasNegative = NEGATIVE_PATTERNS.some((p) => p.test(keyResult));
  const hasNeutral = NEUTRAL_PATTERNS.some((p) => p.test(keyResult));

  // Neutral takes precedence if explicitly stated
  if (hasNeutral && !hasPositive && !hasNegative) return 'neutral';
  if (hasPositive && hasNegative) return 'mixed';
  if (hasPositive) return 'positive';
  if (hasNegative) return 'negative';
  return 'neutral';
}
