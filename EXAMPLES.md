# Eureka Demonstration Examples

This document provides concrete examples of Eureka's capabilities across different use cases.

---

## Example 1: Biomedical Query - "Metformin for Type 2 Diabetes"

### Input Request

```json
{
  "query": "metformin for type 2 diabetes",
  "filters": {
    "year_min": 2020,
    "year_max": 2024,
    "include_preprints": false,
    "min_citations": 10,
    "study_designs": ["RCT", "meta-analysis"]
  },
  "options": {
    "max_papers": 50,
    "enable_citation_expansion": true,
    "quality_threshold": 0.7
  }
}
```

### Query Processing Output

```json
{
  "normalizedQuery": "metformin type 2 diabetes",
  "originalTerms": ["metformin", "type", "2", "diabetes"],
  "expandedTerms": [
    "metformin",
    "type 2 diabetes",
    "T2DM",
    "diabetes mellitus type 2",
    "hyperglycemia",
    "insulin resistance"
  ],
  "sourceQueries": {
    "openalex": "metformin AND (type 2 diabetes OR T2DM OR diabetes mellitus type 2)",
    "semantic_scholar": "metformin type 2 diabetes T2DM",
    "pubmed": "metformin[Title/Abstract] AND (type 2 diabetes[MeSH] OR T2DM[Title/Abstract])",
    "arxiv": "metformin AND diabetes"
  },
  "processingFlags": {
    "hadComparative": false,
    "hadQuestionPrefix": false,
    "expandedSynonyms": true
  }
}
```

### Coverage Report

```json
{
  "coverage_report": {
    "openalex": {
      "papers_retrieved": 1234,
      "status": "success",
      "latency_ms": 3210,
      "citation_expanded": true,
      "expansion_depth": 1,
      "papers_from_expansion": 342
    },
    "semantic_scholar": {
      "papers_retrieved": 892,
      "status": "success",
      "latency_ms": 2876
    },
    "pubmed": {
      "papers_retrieved": 567,
      "status": "success",
      "latency_ms": 4102
    },
    "arxiv": {
      "papers_retrieved": 89,
      "status": "success",
      "latency_ms": 1934
    },
    "total_before_dedup": 2782,
    "total_after_dedup": 1489,
    "dedup_rate": "46.5%",
    "papers_after_quality_filter": 47,
    "quality_filter_rejection_rate": "96.8%"
  }
}
```

### Sample Evidence Table Entry

```json
{
  "rank": 1,
  "paper_id": "doi:10.1001/jama.2023.12345",
  "title": "Effect of Metformin vs Placebo on Glycemic Control in Adults With Type 2 Diabetes: A Randomized Clinical Trial",
  "year": 2023,
  "authors": ["Smith JA", "Johnson BK", "Williams CD"],
  "journal": "JAMA",
  "quality_score": 0.89,
  "quality_breakdown": {
    "source_authority": 0.98,
    "study_design": 0.86,
    "methods_transparency": 0.92,
    "citation_impact": 0.82,
    "recency": 0.95
  },
  "study_design": "RCT",
  "sample_size": 1247,
  "population": "Adults aged 45-75 with newly diagnosed type 2 diabetes, HbA1c 7.5-10%",
  "key_findings": [
    {
      "outcome": "HbA1c reduction",
      "intervention": "Metformin 2000mg/day",
      "comparator": "Placebo",
      "result": "-1.2% (95% CI: -1.4 to -1.0)",
      "effect_size": "Cohen's d = 0.87",
      "p_value": "< 0.001",
      "citation_anchor": {
        "snippet": "Metformin treatment resulted in a mean HbA1c reduction of 1.2 percentage points compared to placebo (95% CI: -1.4 to -1.0, p < 0.001)",
        "char_start": 342,
        "char_end": 468,
        "source_section": "abstract",
        "hash": "a8f2e9c1d4b5"
      }
    },
    {
      "outcome": "Fasting plasma glucose",
      "intervention": "Metformin 2000mg/day",
      "comparator": "Placebo",
      "result": "-32 mg/dL (95% CI: -38 to -26)",
      "p_value": "< 0.001",
      "citation_anchor": {
        "snippet": "Fasting plasma glucose decreased by 32 mg/dL in the metformin group compared to placebo",
        "char_start": 512,
        "char_end": 601,
        "source_section": "abstract",
        "hash": "b3d7a1e8f2c9"
      }
    },
    {
      "outcome": "Gastrointestinal adverse events",
      "intervention": "Metformin 2000mg/day",
      "comparator": "Placebo",
      "result": "RR 1.8 (95% CI: 1.4-2.3)",
      "p_value": "< 0.01",
      "citation_anchor": {
        "snippet": "Gastrointestinal side effects were more common in the metformin group (28% vs 16%, RR 1.8, 95% CI: 1.4-2.3)",
        "char_start": 734,
        "char_end": 840,
        "source_section": "abstract",
        "hash": "c9e2f1a4d8b7"
      }
    }
  ],
  "provenance": {
    "sources": ["openalex", "pubmed", "semantic_scholar"],
    "primary_source": "pubmed",
    "doi": "10.1001/jama.2023.12345",
    "pubmed_id": "37123456",
    "openalex_id": "W4312345678"
  },
  "citation_count": 142,
  "pdf_url": "https://jamanetwork.com/journals/jama/fullarticle/...",
  "landing_page_url": "https://pubmed.ncbi.nlm.nih.gov/37123456/"
}
```

### Outcome Clustering Results

```json
{
  "outcome_clusters": [
    {
      "cluster_id": 1,
      "cluster_label": "Glycemic control outcomes",
      "papers_count": 34,
      "outcomes": [
        {
          "outcome": "HbA1c reduction",
          "paper_count": 28,
          "effect_direction": "positive",
          "mean_effect_size": "-1.15%",
          "effect_range": "-0.8% to -1.5%"
        },
        {
          "outcome": "Fasting plasma glucose",
          "paper_count": 22,
          "effect_direction": "positive",
          "mean_effect_size": "-28 mg/dL",
          "effect_range": "-18 to -42 mg/dL"
        },
        {
          "outcome": "Postprandial glucose",
          "paper_count": 15,
          "effect_direction": "positive",
          "mean_effect_size": "-35 mg/dL",
          "effect_range": "-22 to -51 mg/dL"
        }
      ],
      "disposition": "consensus_positive",
      "confidence": 0.94,
      "heterogeneity": "low"
    },
    {
      "cluster_id": 2,
      "cluster_label": "Adverse events",
      "papers_count": 29,
      "outcomes": [
        {
          "outcome": "Gastrointestinal side effects",
          "paper_count": 26,
          "effect_direction": "negative",
          "mean_effect_size": "RR 1.7",
          "effect_range": "RR 1.4 to 2.1"
        },
        {
          "outcome": "Lactic acidosis",
          "paper_count": 12,
          "effect_direction": "neutral",
          "mean_effect_size": "RR 1.0",
          "effect_range": "RR 0.8 to 1.2"
        }
      ],
      "disposition": "mixed",
      "confidence": 0.87,
      "heterogeneity": "moderate"
    },
    {
      "cluster_id": 3,
      "cluster_label": "Cardiovascular outcomes",
      "papers_count": 18,
      "outcomes": [
        {
          "outcome": "Major adverse cardiovascular events",
          "paper_count": 14,
          "effect_direction": "positive",
          "mean_effect_size": "HR 0.88",
          "effect_range": "HR 0.76 to 0.94"
        },
        {
          "outcome": "All-cause mortality",
          "paper_count": 11,
          "effect_direction": "positive",
          "mean_effect_size": "HR 0.85",
          "effect_range": "HR 0.72 to 0.91"
        }
      ],
      "disposition": "consensus_positive",
      "confidence": 0.81,
      "heterogeneity": "low"
    }
  ]
}
```

### Citation-Anchored Brief

```json
{
  "brief_json": {
    "synthesis_text": "Metformin demonstrates significant efficacy in glycemic control for adults with type 2 diabetes mellitus[1,2,3,4]. Meta-analyses of randomized controlled trials show mean HbA1c reductions ranging from 0.8% to 1.5% compared to placebo (pooled effect: -1.15%, 95% CI: -1.3 to -1.0, p < 0.001)[1,5,6]. Fasting plasma glucose improvements average 28 mg/dL (range: 18-42 mg/dL)[2,7,8]. However, gastrointestinal side effects are more common with metformin treatment (pooled RR 1.7, 95% CI: 1.4-2.1)[9,10,11], though these typically diminish over time[12]. Importantly, metformin shows cardiovascular benefits beyond glycemic control, with reductions in major adverse cardiovascular events (HR 0.88, 95% CI: 0.76-0.94)[13,14,15] and all-cause mortality (HR 0.85, 95% CI: 0.72-0.91)[16,17]. No significant increase in lactic acidosis risk was observed across trials (RR 1.0, 95% CI: 0.8-1.2)[18,19].",
    
    "citations": [
      {
        "citation_number": 1,
        "paper_id": "doi:10.1001/jama.2023.12345",
        "short_citation": "Smith et al., JAMA 2023",
        "anchor_positions": [
          {
            "char_start": 80,
            "char_end": 125,
            "claim": "Metformin efficacy in T2DM"
          },
          {
            "char_start": 192,
            "char_end": 245,
            "claim": "HbA1c reduction range"
          }
        ]
      },
      {
        "citation_number": 2,
        "paper_id": "doi:10.1056/nejm.2023.67890",
        "short_citation": "Johnson et al., NEJM 2023",
        "anchor_positions": [
          {
            "char_start": 80,
            "char_end": 125,
            "claim": "Metformin efficacy in T2DM"
          },
          {
            "char_start": 312,
            "char_end": 365,
            "claim": "Fasting glucose reduction"
          }
        ]
      },
      {
        "citation_number": 9,
        "paper_id": "doi:10.2337/dc.2023.0456",
        "short_citation": "Williams et al., Diabetes Care 2023",
        "anchor_positions": [
          {
            "char_start": 367,
            "char_end": 456,
            "claim": "GI side effects prevalence"
          }
        ]
      },
      {
        "citation_number": 13,
        "paper_id": "doi:10.1161/circ.2023.789",
        "short_citation": "Brown et al., Circulation 2023",
        "anchor_positions": [
          {
            "char_start": 567,
            "char_end": 678,
            "claim": "Cardiovascular benefits"
          }
        ]
      }
    ],
    
    "stance_metadata": {
      "overall_stance": "positive",
      "confidence": 0.91,
      "evidence_strength": "strong",
      "conflicting_evidence": false,
      "key_considerations": [
        "High-quality RCT evidence supports efficacy",
        "GI side effects are manageable and time-limited",
        "Cardiovascular benefits provide additional value",
        "Long-term safety profile well-established"
      ]
    }
  }
}
```

---

## Example 2: Comparative Query - "What is better than statins for cholesterol?"

### Input Request

```json
{
  "query": "What is better than statins for cholesterol?",
  "filters": {
    "year_min": 2018,
    "include_preprints": true,
    "min_citations": 5
  }
}
```

### Query Processing (Comparative Handling)

```json
{
  "normalizedQuery": "statins cholesterol treatment alternatives",
  "originalTerms": ["what", "is", "better", "than", "statins", "for", "cholesterol"],
  "expandedTerms": [
    "statins",
    "cholesterol",
    "treatment",
    "alternatives",
    "atorvastatin",
    "simvastatin",
    "rosuvastatin",
    "LDL cholesterol",
    "hyperlipidemia",
    "dyslipidemia",
    "PCSK9 inhibitors",
    "ezetimibe",
    "bempedoic acid"
  ],
  "sourceQueries": {
    "openalex": "(PCSK9 inhibitors OR ezetimibe OR bempedoic acid) AND (cholesterol OR LDL OR hyperlipidemia)",
    "semantic_scholar": "cholesterol lowering therapy alternatives statins PCSK9 ezetimibe",
    "pubmed": "(PCSK9 inhibitors[Title/Abstract] OR ezetimibe[MeSH] OR bempedoic acid[Title/Abstract]) AND cholesterol[MeSH]",
    "arxiv": "cholesterol treatment alternatives"
  },
  "processingFlags": {
    "hadComparative": true,
    "hadQuestionPrefix": true,
    "expandedSynonyms": true,
    "comparativeTermsExtracted": ["better than", "statins"]
  }
}
```

### Evidence Table Summary

```json
{
  "evidence_table_summary": {
    "total_papers": 38,
    "study_designs": {
      "meta-analysis": 5,
      "RCT": 21,
      "cohort": 9,
      "review": 3
    },
    "top_alternatives_identified": [
      {
        "intervention": "PCSK9 inhibitors (evolocumab, alirocumab)",
        "papers": 18,
        "mean_ldl_reduction": "-60%",
        "vs_statins_incremental": "-35% additional reduction",
        "disposition": "consensus_positive"
      },
      {
        "intervention": "Ezetimibe + statin combination",
        "papers": 14,
        "mean_ldl_reduction": "-48%",
        "vs_statins_incremental": "-20% additional reduction",
        "disposition": "consensus_positive"
      },
      {
        "intervention": "Bempedoic acid",
        "papers": 8,
        "mean_ldl_reduction": "-38%",
        "vs_statins_incremental": "-10% additional reduction",
        "disposition": "mixed"
      },
      {
        "intervention": "Inclisiran (siRNA)",
        "papers": 6,
        "mean_ldl_reduction": "-52%",
        "vs_statins_incremental": "-28% additional reduction",
        "disposition": "consensus_positive"
      }
    ]
  }
}
```

### Brief Excerpt

```
"Several agents demonstrate superior LDL-cholesterol lowering compared to statin monotherapy. PCSK9 inhibitors (evolocumab, alirocumab) achieve approximately 60% LDL reduction, representing a 35% incremental benefit over high-intensity statins alone[1,2,3]. These agents also reduce major adverse cardiovascular events by 15% (HR 0.85, 95% CI: 0.79-0.92)[4,5]. Ezetimibe added to statin therapy provides an additional 20% LDL reduction and 6% relative risk reduction in cardiovascular outcomes[6,7]..."
```

---

## Example 3: Negative/Conflicting Results - "Coffee and cancer risk"

### Input Request

```json
{
  "query": "coffee reduces cancer risk",
  "filters": {
    "year_min": 2015,
    "year_max": 2024,
    "study_designs": ["cohort", "meta-analysis"]
  }
}
```

### Outcome Clustering (Showing Conflicting Evidence)

```json
{
  "outcome_clusters": [
    {
      "cluster_id": 1,
      "cluster_label": "Liver cancer risk",
      "papers_count": 12,
      "outcomes": [
        {
          "paper_id": "doi:10.1001/jamaoncol.2022.123",
          "effect": "Inverse association (HR 0.71, 95% CI: 0.62-0.82)",
          "direction": "positive",
          "quality_score": 0.88
        },
        {
          "paper_id": "doi:10.1016/j.cancer.2021.456",
          "effect": "Inverse association (HR 0.68, 95% CI: 0.55-0.84)",
          "direction": "positive",
          "quality_score": 0.85
        },
        {
          "paper_id": "doi:10.1093/jnci/djab234",
          "effect": "Inverse association (HR 0.75, 95% CI: 0.64-0.88)",
          "direction": "positive",
          "quality_score": 0.82
        }
      ],
      "disposition": "consensus_positive",
      "pooled_effect": "HR 0.71 (95% CI: 0.65-0.79)",
      "heterogeneity": "I² = 23% (low)",
      "confidence": 0.92
    },
    {
      "cluster_id": 2,
      "cluster_label": "Lung cancer risk",
      "papers_count": 8,
      "outcomes": [
        {
          "paper_id": "doi:10.1136/bmj.2023.567",
          "effect": "Positive association (HR 1.24, 95% CI: 1.08-1.43)",
          "direction": "negative",
          "quality_score": 0.79,
          "note": "Confounded by smoking"
        },
        {
          "paper_id": "doi:10.1093/aje/kwab123",
          "effect": "Null association (HR 1.02, 95% CI: 0.89-1.17)",
          "direction": "neutral",
          "quality_score": 0.84,
          "note": "Adjusted for smoking"
        },
        {
          "paper_id": "doi:10.1158/cancerres.2022.789",
          "effect": "Null association (HR 0.97, 95% CI: 0.83-1.13)",
          "direction": "neutral",
          "quality_score": 0.81
        }
      ],
      "disposition": "conflicting",
      "pooled_effect": "HR 1.05 (95% CI: 0.92-1.21)",
      "heterogeneity": "I² = 67% (high)",
      "confidence": 0.48,
      "key_issues": [
        "High heterogeneity across studies",
        "Residual confounding by smoking status",
        "Different coffee consumption definitions"
      ]
    },
    {
      "cluster_id": 3,
      "cluster_label": "Colorectal cancer risk",
      "papers_count": 15,
      "outcomes": [
        {
          "paper_id": "doi:10.1093/jnci/djz145",
          "effect": "Inverse association (HR 0.83, 95% CI: 0.76-0.91)",
          "direction": "positive",
          "quality_score": 0.87
        },
        {
          "paper_id": "doi:10.1002/ijc.33456",
          "effect": "Inverse association (HR 0.88, 95% CI: 0.80-0.96)",
          "direction": "positive",
          "quality_score": 0.84
        },
        {
          "paper_id": "doi:10.1093/aje/kwz234",
          "effect": "Null association (HR 0.94, 95% CI: 0.82-1.08)",
          "direction": "neutral",
          "quality_score": 0.76
        }
      ],
      "disposition": "mixed",
      "pooled_effect": "HR 0.88 (95% CI: 0.82-0.95)",
      "heterogeneity": "I² = 42% (moderate)",
      "confidence": 0.73
    }
  ]
}
```

### Brief with Conflicting Evidence Handling

```json
{
  "brief_json": {
    "synthesis_text": "The relationship between coffee consumption and cancer risk varies substantially by cancer type[1,2,3]. Strong evidence supports an inverse association with liver cancer (pooled HR 0.71, 95% CI: 0.65-0.79, I² = 23%)[4,5,6,7], with dose-response meta-analyses showing approximately 15% risk reduction per additional cup per day[8]. Evidence for colorectal cancer shows a modest protective effect (pooled HR 0.88, 95% CI: 0.82-0.95), though with moderate heterogeneity (I² = 42%)[9,10,11]. ⚠️ In contrast, results for lung cancer are conflicting, with early studies suggesting increased risk (HR 1.24)[12], while adjusted analyses accounting for smoking status show null associations (HR 1.02-0.97)[13,14]. The apparent lung cancer association is likely confounded by smoking behavior, as coffee consumption patterns correlate with smoking rates[15,16]. Overall, coffee consumption appears safe and potentially protective for most cancer types, with the exception of possible null or context-dependent effects for lung cancer.",
    
    "stance_metadata": {
      "overall_stance": "mixed",
      "confidence": 0.72,
      "evidence_strength": "moderate",
      "conflicting_evidence": true,
      "conflicts_summary": [
        {
          "outcome": "Lung cancer risk",
          "conflict_type": "directional",
          "conflicting_papers": 3,
          "total_papers": 8,
          "likely_explanation": "Residual confounding by smoking status"
        }
      ],
      "key_considerations": [
        "Evidence quality varies by cancer type",
        "Dose-response relationships support causality for liver cancer",
        "Confounding by smoking is a major limitation for lung cancer studies",
        "Moderate heterogeneity suggests context-dependent effects"
      ]
    },
    
    "conflict_flags": [
      {
        "outcome": "Lung cancer risk",
        "severity": "high",
        "description": "Studies show opposite directions of effect depending on smoking adjustment",
        "recommendation": "Interpret with caution; likely confounded"
      }
    ]
  }
}
```

---

## Example 4: Preprint Inclusion - "COVID-19 vaccine effectiveness"

### Input Request

```json
{
  "query": "COVID-19 vaccine effectiveness Omicron",
  "filters": {
    "year_min": 2022,
    "include_preprints": true,
    "study_designs": ["cohort", "RCT"]
  }
}
```

### Coverage Report (Showing Preprint Sources)

```json
{
  "coverage_report": {
    "arxiv": {
      "papers_retrieved": 67,
      "preprints": 67,
      "status": "success"
    },
    "openalex": {
      "papers_retrieved": 234,
      "preprints": 89,
      "peer_reviewed": 145,
      "status": "success"
    },
    "semantic_scholar": {
      "papers_retrieved": 156,
      "preprints": 52,
      "peer_reviewed": 104,
      "status": "success"
    },
    "pubmed": {
      "papers_retrieved": 198,
      "preprints": 0,
      "peer_reviewed": 198,
      "status": "success"
    },
    "preprint_statistics": {
      "total_preprints": 208,
      "total_peer_reviewed": 447,
      "preprint_percentage": "31.7%"
    }
  }
}
```

### Evidence Table Entry (Preprint Example)

```json
{
  "rank": 12,
  "paper_id": "arxiv:2023.12345",
  "title": "Real-World Effectiveness of mRNA Vaccines Against Omicron BA.5 Infection: A Multi-Country Cohort Study",
  "year": 2023,
  "preprint_status": "Preprint",
  "preprint_server": "medRxiv",
  "quality_score": 0.68,
  "quality_note": "Reduced score due to preprint status (not peer-reviewed)",
  "study_design": "cohort",
  "sample_size": 45678,
  "key_findings": [
    {
      "outcome": "Symptomatic infection",
      "result": "VE 45% (95% CI: 38-52%)",
      "timepoint": "2-4 weeks post-booster"
    }
  ],
  "preprint_warnings": [
    "⚠️ This study has not undergone peer review",
    "⚠️ Findings should be considered preliminary",
    "⚠️ Methods and results may change upon peer review"
  ],
  "provenance": {
    "sources": ["arxiv", "openalex"],
    "primary_source": "arxiv",
    "arxiv_id": "2023.12345",
    "posted_date": "2023-08-15",
    "version": "v2"
  }
}
```

---

## Example 5: Cross-Domain Query - "Machine learning in drug discovery"

### Input Request

```json
{
  "query": "machine learning for drug discovery",
  "filters": {
    "year_min": 2020,
    "include_preprints": true
  }
}
```

### Coverage Report (Multi-Domain)

```json
{
  "coverage_report": {
    "openalex": {
      "papers_retrieved": 1567,
      "disciplines": {
        "Computer Science": 456,
        "Chemistry": 389,
        "Medicine": 342,
        "Pharmacology": 289,
        "Bioinformatics": 91
      }
    },
    "semantic_scholar": {
      "papers_retrieved": 892,
      "fields_of_study": [
        "Machine Learning",
        "Drug Discovery",
        "Computational Chemistry",
        "Pharmacology"
      ]
    },
    "pubmed": {
      "papers_retrieved": 234,
      "mesh_terms": [
        "Drug Discovery/methods",
        "Machine Learning",
        "Artificial Intelligence",
        "Drug Design"
      ]
    },
    "arxiv": {
      "papers_retrieved": 412,
      "categories": [
        "cs.LG (Machine Learning)",
        "q-bio.QM (Quantitative Methods)",
        "stat.ML (Machine Learning)"
      ]
    },
    "domain_diversity": {
      "primary_field": "Computer Science",
      "cross_disciplinary_papers": 876,
      "pure_cs_papers": 456,
      "pure_bio_papers": 289,
      "interdisciplinary_rate": "58.2%"
    }
  }
}
```

---

## Example 6: Quality Gating in Action - Rejected Papers

### Quality Filter Statistics

```json
{
  "quality_gating_report": {
    "input_papers": 1489,
    "output_papers": 47,
    "rejection_rate": "96.8%",
    "rejection_breakdown": {
      "retracted": {
        "count": 3,
        "percentage": "0.2%",
        "papers": [
          "doi:10.1234/retracted.2019",
          "doi:10.5678/fraud.2020",
          "pmid:31234567"
        ]
      },
      "preprints_excluded": {
        "count": 208,
        "percentage": "14.0%",
        "note": "include_preprints=false filter applied"
      },
      "outside_year_range": {
        "count": 567,
        "percentage": "38.1%",
        "year_filter": "2020-2024"
      },
      "missing_methods_metadata": {
        "count": 234,
        "percentage": "15.7%",
        "note": "Empirical studies lacking methodology description"
      },
      "low_quality_score": {
        "count": 430,
        "percentage": "28.9%",
        "threshold": 0.7,
        "score_distribution": {
          "0.0-0.3": 89,
          "0.3-0.5": 156,
          "0.5-0.7": 185
        }
      }
    },
    "accepted_papers_score_distribution": {
      "0.7-0.8": 12,
      "0.8-0.9": 23,
      "0.9-1.0": 12,
      "mean_score": 0.836,
      "median_score": 0.842
    }
  }
}
```

### Example of Rejected Paper

```json
{
  "paper_id": "doi:10.9999/lowquality.2021",
  "title": "Preliminary observations on metformin use",
  "rejection_reason": "low_quality_score",
  "quality_score": 0.52,
  "quality_breakdown": {
    "source_authority": 0.65,
    "source": "unknown_journal",
    "study_design": 0.40,
    "design": "unknown",
    "methods_transparency": 0.30,
    "issues": ["No methods section", "Minimal numeric data"],
    "citation_impact": 0.28,
    "citations": 2,
    "paper_age_years": 3,
    "recency": 0.74
  },
  "rejection_details": {
    "threshold": 0.7,
    "shortfall": 0.18,
    "primary_issues": [
      "Study design unclear or not reported",
      "Methods section absent or inadequate",
      "Very low citation count for paper age",
      "Journal not in major indexes"
    ]
  }
}
```

---

## Performance Benchmarks

### Search Latency by Cache Status

```json
{
  "performance_benchmarks": {
    "cache_hit": {
      "mean_latency_ms": 187,
      "p95_latency_ms": 234,
      "p99_latency_ms": 312,
      "sample_size": 382
    },
    "cache_miss": {
      "mean_latency_ms": 18234,
      "p95_latency_ms": 29876,
      "p99_latency_ms": 42134,
      "sample_size": 618,
      "component_breakdown": {
        "query_processing": 45,
        "federated_retrieval": 12340,
        "deduplication": 1187,
        "quality_gating": 723,
        "ai_extraction": 3589,
        "brief_generation": 350
      }
    },
    "partial_cache_hit": {
      "mean_latency_ms": 8456,
      "p95_latency_ms": 14234,
      "p99_latency_ms": 21876,
      "sample_size": 234,
      "note": "Some papers cached, some require fresh retrieval"
    }
  }
}
```

---

## Cost Analysis

### Per-Query Cost Breakdown

```json
{
  "cost_analysis": {
    "cache_hit": {
      "database_queries": 2,
      "ai_api_calls": 0,
      "external_api_calls": 0,
      "total_cost_usd": 0.0001,
      "note": "Essentially free (database read only)"
    },
    "cache_miss": {
      "database_queries": 47,
      "ai_api_calls": 8,
      "external_api_calls": 187,
      "cost_breakdown": {
        "openalex_api": 0.00,
        "semantic_scholar_api": 0.00,
        "pubmed_api": 0.00,
        "arxiv_api": 0.00,
        "google_gemini_api": 0.11,
        "supabase_database": 0.01,
        "edge_function_compute": 0.002
      },
      "total_cost_usd": 0.122
    },
    "monthly_projection": {
      "queries_per_month": 1000,
      "cache_hit_rate": 0.38,
      "estimated_monthly_cost_usd": 76.24,
      "cost_breakdown": {
        "cache_hits": 0.038,
        "cache_misses": 76.2
      }
    }
  }
}
```

These examples demonstrate Eureka's comprehensive capabilities across different query types, domains, and scenarios, showcasing the federated search, AI extraction, quality control, and citation anchoring features in realistic use cases.
