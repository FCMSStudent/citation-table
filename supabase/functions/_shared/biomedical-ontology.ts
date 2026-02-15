export interface BiomedicalConcept {
  id: string;
  preferredTerm: string;
  synonyms: string[];
  forbiddenExpansions?: string[];
  maxExpansions?: number;
}

export const BIOMEDICAL_ONTOLOGY: BiomedicalConcept[] = [
  {
    id: "sleep_deprivation",
    preferredTerm: "sleep deprivation",
    synonyms: ["sleep restriction", "sleep loss", "partial sleep deprivation", "insufficient sleep"],
    forbiddenExpansions: ["sleep quality"],
    maxExpansions: 3,
  },
  {
    id: "cognitive_performance",
    preferredTerm: "cognitive performance",
    synonyms: ["working memory", "attention", "executive function", "reaction time"],
    maxExpansions: 3,
  },
  {
    id: "hypertension",
    preferredTerm: "blood pressure",
    synonyms: ["hypertension", "systolic blood pressure", "diastolic blood pressure"],
    maxExpansions: 3,
  },
  {
    id: "depression",
    preferredTerm: "depression",
    synonyms: ["depressive symptoms", "major depressive disorder", "mood symptoms"],
    maxExpansions: 3,
  },
  {
    id: "anxiety",
    preferredTerm: "anxiety",
    synonyms: ["anxious symptoms", "anxiety disorder", "state anxiety"],
    maxExpansions: 3,
  },
  {
    id: "insomnia",
    preferredTerm: "insomnia",
    synonyms: ["sleep onset insomnia", "sleep maintenance insomnia", "sleeplessness"],
    maxExpansions: 2,
  },
  {
    id: "vaccine_hesitancy",
    preferredTerm: "vaccine hesitancy",
    synonyms: ["vaccine confidence", "vaccine acceptance", "vaccine refusal"],
    forbiddenExpansions: ["anti-vaccine"],
    maxExpansions: 2,
  },
  {
    id: "glycemic_control",
    preferredTerm: "glycemic control",
    synonyms: ["glycaemic control", "blood glucose", "hemoglobin a1c", "hba1c"],
    maxExpansions: 3,
  },
  {
    id: "body_weight",
    preferredTerm: "body weight",
    synonyms: ["body mass index", "bmi", "weight loss", "weight gain"],
    maxExpansions: 3,
  },
  {
    id: "cardiovascular_outcomes",
    preferredTerm: "cardiovascular outcomes",
    synonyms: ["major adverse cardiovascular events", "mace", "cardiovascular mortality"],
    maxExpansions: 2,
  },
];
