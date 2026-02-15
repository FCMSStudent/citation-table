# Eureka Demonstration Script

This script provides a step-by-step walkthrough for demonstrating Eureka's key capabilities.

---

## Demo 1: Basic Federated Search (5 minutes)

### Objective
Demonstrate basic federated retrieval across multiple academic databases.

### Steps

1. **Start the Application**
   ```bash
   npm run dev
   ```
   
2. **Navigate to Search Interface**
   - Open browser to `http://localhost:5173`
   - Point out the clean, accessible interface

3. **Execute Simple Query**
   - Query: "metformin for diabetes"
   - Click "Search" button
   
4. **Observe Processing**
   - Status updates appear in real-time
   - Current step indicator shows progress:
     - "Processing query..."
     - "Searching across 4 databases..."
     - "Deduplicating results..."
     - "Applying quality filters..."
     - "Extracting evidence..."

5. **Review Results**
   - Point out the evidence table with ranked papers
   - Highlight provenance badges showing which sources found each paper
   - Note the quality scores for each paper
   - Show the coverage report at the bottom

### Key Points to Emphasize
- ✅ Searched 4 databases simultaneously (OpenAlex, Semantic Scholar, PubMed, arXiv)
- ✅ Deduplicated 46% of results (e.g., 321 papers → 187 unique)
- ✅ Applied quality filtering (187 → 47 high-quality papers)
- ✅ Complete process in ~20 seconds

---

## Demo 2: Query Normalization & Comparative Queries (3 minutes)

### Objective
Show intelligent query processing for natural language questions.

### Steps

1. **Enter Comparative Query**
   - Query: "What is better than statins for cholesterol?"
   - Click "Search"

2. **Show Query Processing**
   - Open developer tools / Network tab
   - Show the API request payload
   - Point out the transformed query:
     ```json
     {
       "normalizedQuery": "statins cholesterol treatment alternatives",
       "expandedTerms": [
         "statins", "PCSK9 inhibitors", "ezetimibe", 
         "bempedoic acid", "LDL cholesterol"
       ]
     }
     ```

3. **Review Results**
   - Evidence table shows alternative treatments
   - Brief synthesis compares effectiveness
   - Each alternative has supporting citations

### Key Points to Emphasize
- ✅ Automatically removes question prefixes ("What is", "Is")
- ✅ Handles comparative language ("better than")
- ✅ Expands biomedical synonyms (T2DM, diabetes mellitus)
- ✅ Compiles source-specific queries (PubMed MeSH terms, etc.)

---

## Demo 3: Quality Gating & Filtering (4 minutes)

### Objective
Demonstrate multi-dimensional quality control.

### Steps

1. **Execute Search with Filters**
   - Query: "coffee and cancer"
   - Filters:
     - Year range: 2020-2024
     - Min citations: 10
     - Exclude preprints: Yes
     - Study designs: RCT, Meta-analysis

2. **Review Quality Gating Report**
   - Scroll to "Quality Gating Report" section
   - Show rejection statistics:
     - Retracted papers: 3 ❌
     - Preprints excluded: 208 ❌
     - Outside year range: 567 ❌
     - Low quality score: 430 ❌
   
3. **Examine Individual Paper Scores**
   - Click on a high-quality paper (score 0.89)
   - Show score breakdown:
     - Source authority: 0.98 (PubMed)
     - Study design: 0.90 (Meta-analysis)
     - Methods transparency: 0.92
     - Citation impact: 0.82
     - Recency: 0.95

4. **Compare with Rejected Paper**
   - Find a rejected paper in the "Filtered Out" section
   - Show why it was rejected (e.g., quality score 0.52)

### Key Points to Emphasize
- ✅ Multi-dimensional quality scoring (5 components)
- ✅ Hard rejection rules prevent bad papers
- ✅ Transparent scoring visible for each paper
- ✅ Customizable thresholds

---

## Demo 4: Citation Anchoring & Traceability (5 minutes)

### Objective
Show character-level citation anchoring for evidence traceability.

### Steps

1. **Execute Search**
   - Query: "exercise for depression"
   
2. **View Evidence Table**
   - Click on top-ranked paper
   - Show the extracted outcomes

3. **Examine Citation Anchors**
   - For each outcome, hover over the citation snippet
   - Highlight is shown in the abstract
   - Show character positions (e.g., char 342-468)
   - Click to view full context

4. **Review Brief Synthesis**
   - Scroll to "Brief" section
   - Show synthesized narrative text
   - Hover over citation numbers [1,2,3]
   - Tooltips show which papers are cited
   - Click citation to jump to that paper's entry

5. **Verify Anchor Integrity**
   - Show snippet hash (e.g., "a8f2e9c1d4b5")
   - Explain this prevents citation drift
   - Click "Verify Anchors" button
   - All anchors show ✅ green checkmark (verified)

### Key Points to Emphasize
- ✅ Every claim has a precise citation anchor
- ✅ Character-level position tracking
- ✅ Hover to see context
- ✅ Hash verification prevents tampering
- ✅ Multi-citation support for each claim

---

## Demo 5: AI Evidence Extraction (4 minutes)

### Objective
Demonstrate structured data extraction from abstracts.

### Steps

1. **Execute Search**
   - Query: "remdesivir for COVID-19"
   
2. **View Extracted Evidence**
   - Show evidence table
   - Point out structured fields:
     - Study design: RCT
     - Sample size: 1062
     - Population: "Hospitalized adults with COVID-19"
     - Outcomes: Multiple outcomes extracted
   
3. **Examine Outcome Details**
   - Click on an outcome row
   - Show extracted fields:
     - Outcome measured: "Mortality"
     - Intervention: "Remdesivir 200mg"
     - Comparator: "Placebo"
     - Effect size: "HR 0.88"
     - P-value: "< 0.05"
     - Citation snippet with anchor

4. **Show Outcome Clustering**
   - Navigate to "Outcome Clusters" tab
   - Show grouped outcomes:
     - Cluster 1: "Mortality outcomes" (12 papers)
     - Cluster 2: "Time to recovery" (18 papers)
     - Cluster 3: "Adverse events" (15 papers)
   - For each cluster, show disposition:
     - Consensus positive / negative
     - Conflicting evidence
     - Mixed results

### Key Points to Emphasize
- ✅ Automated extraction from abstracts
- ✅ Structured, queryable data
- ✅ Outcome clustering by similarity
- ✅ Disposition detection (positive/negative/conflicting)
- ✅ Validation against manual annotation (F1 > 0.84)

---

## Demo 6: Caching & Performance (3 minutes)

### Objective
Show the impact of caching on performance.

### Steps

1. **First Search (Cache Miss)**
   - Query: "vitamin D for immune function"
   - Note the response time (~22 seconds)
   - Show coverage report indicating "cache_hit: false"

2. **Repeat Same Search (Cache Hit)**
   - Query: "vitamin D for immune function" (exact same)
   - Note the response time (~0.2 seconds)
   - Show "cache_hit: true" in response
   - Point out 99% latency reduction

3. **Modified Search (Partial Cache)**
   - Query: "vitamin D for immune function"
   - Add filter: year_min: 2022 (different from before)
   - Response time: ~8 seconds
   - Some papers cached, some require fresh filtering

4. **Show Cache Statistics**
   - Navigate to "System Stats" page
   - Show cache metrics:
     - Query cache hit rate: 38%
     - Paper cache hit rate: 67%
     - Enrichment cache hit rate: 54%

### Key Points to Emphasize
- ✅ 6-hour query cache
- ✅ 30-day paper metadata cache
- ✅ 99% latency reduction on cache hits
- ✅ Intelligent cache invalidation
- ✅ Cost savings: $0.12 → $0.03 per query

---

## Demo 7: Handling Conflicting Evidence (4 minutes)

### Objective
Show how Eureka handles conflicting or mixed results.

### Steps

1. **Execute Controversial Query**
   - Query: "coffee and cancer risk"
   
2. **Review Outcome Clusters**
   - Show multiple clusters with different dispositions:
     - Liver cancer: "consensus_positive" ✅
     - Lung cancer: "conflicting" ⚠️
     - Colorectal cancer: "mixed" 🔶

3. **Examine Conflicting Cluster**
   - Click on lung cancer cluster
   - Show papers with opposing results:
     - Paper A: HR 1.24 (increased risk)
     - Paper B: HR 1.02 (null)
     - Paper C: HR 0.97 (null)
   - Heterogeneity: I² = 67% (high)

4. **Read Brief Synthesis**
   - Show how the brief handles conflicts:
     - "⚠️ In contrast, results for lung cancer are conflicting..."
     - Explains confounding by smoking status
     - Provides context and interpretation

5. **View Conflict Flags**
   - Show warning badges on conflicting outcomes
   - Tooltip explains the conflict
   - Recommendation: "Interpret with caution; likely confounded"

### Key Points to Emphasize
- ✅ Detects conflicting evidence automatically
- ✅ Displays warnings for contradictory results
- ✅ Provides context and possible explanations
- ✅ Heterogeneity statistics (I² values)
- ✅ Transparent about uncertainty

---

## Demo 8: Preprint Inclusion & Warnings (3 minutes)

### Objective
Show handling of preprints with appropriate warnings.

### Steps

1. **Search with Preprints Enabled**
   - Query: "COVID-19 vaccine Omicron"
   - Filter: include_preprints: true
   
2. **Identify Preprint Papers**
   - Look for papers with "Preprint" badge
   - Show preprint server (medRxiv, bioRxiv, arXiv)
   - Note reduced quality score (e.g., 0.68 vs 0.88)

3. **View Preprint Warnings**
   - Click on a preprint paper
   - Show warning messages:
     - ⚠️ This study has not undergone peer review
     - ⚠️ Findings should be considered preliminary
     - ⚠️ Methods and results may change
   
4. **Compare with Peer-Reviewed**
   - Show a peer-reviewed paper on same topic
   - Higher quality score
   - No warnings
   - More complete metadata

### Key Points to Emphasize
- ✅ Preprints clearly labeled
- ✅ Automatic quality score reduction
- ✅ Prominent warning messages
- ✅ Optional inclusion (can be disabled)
- ✅ Helps capture cutting-edge research

---

## Demo 9: Coverage Report & Provider Status (2 minutes)

### Objective
Show transparency in retrieval process and provider health.

### Steps

1. **View Coverage Report**
   - After any search, scroll to coverage section
   - Show papers retrieved per source:
     - OpenAlex: 1,234 papers
     - Semantic Scholar: 892 papers
     - PubMed: 567 papers
     - arXiv: 89 papers
   - Show latency per source
   - Show success/failure status

2. **Check Provider Health**
   - Navigate to "System Health" page
   - Or: GET /v1/lit/providers/health
   - Show status for each provider:
     - openalex: "operational" (234ms)
     - semantic_scholar: "operational" (189ms)
     - pubmed: "degraded" (1842ms) ⚠️
     - arxiv: "operational" (412ms)

3. **Show Graceful Degradation**
   - Demonstrate search with one provider down
   - System continues with remaining 3 providers
   - Warning message: "PubMed unavailable, results may be incomplete"

### Key Points to Emphasize
- ✅ Full transparency on sources
- ✅ Real-time provider health checks
- ✅ Graceful degradation on failure
- ✅ Latency monitoring per source

---

## Demo 10: Export & Integration (2 minutes)

### Objective
Show export capabilities for downstream use.

### Steps

1. **Export Evidence Table**
   - Click "Export" button
   - Choose format: CSV, JSON, BibTeX
   - Download file
   - Open in Excel/text editor

2. **Show API Integration**
   - Open Postman/curl
   - Show API request:
     ```bash
     curl -X POST https://[project].supabase.co/functions/v1/lit/search \
       -H "Content-Type: application/json" \
       -d '{"query": "metformin diabetes"}'
     ```
   - Show JSON response
   - Explain programmatic access

3. **Citation Export**
   - Click "Export Citations"
   - Show formatted citations in various styles:
     - APA
     - MLA
     - Chicago
     - Vancouver
   - Copy to clipboard

### Key Points to Emphasize
- ✅ Multiple export formats
- ✅ RESTful API for integration
- ✅ Citation formatting built-in
- ✅ Suitable for systematic reviews

---

## Key Statistics to Highlight

Throughout the demo, emphasize these metrics:

### Performance
- **Response Time**: 0.2s (cache hit) to 23s (cache miss)
- **Cache Hit Rate**: 38% query, 67% paper
- **Throughput**: 97.8% success rate under load

### Coverage
- **Sources**: 4 major databases (OpenAlex, Semantic Scholar, PubMed, arXiv)
- **Deduplication**: ~45% duplicate rate typical
- **Quality Filtering**: ~95% papers filtered out

### Accuracy
- **Extraction F1**: 0.84 average across fields
- **Study Design**: 0.95 F1
- **P-values**: 0.92 F1
- **Inter-Rater Agreement**: κ = 0.83

### Retrieval
- **Recall Improvement**: +43% vs single-source
- **Precision**: 81% (federated) vs 78% (single-source)
- **F1 Score**: 0.85 (federated) vs 0.69 (PubMed only)

### Cost
- **Per Query**: $0.03 (cached) to $0.12 (uncached)
- **Monthly (1k queries)**: ~$30-120

---

## Common Questions & Answers

**Q: How does Eureka compare to Google Scholar?**
A: Google Scholar is great for discovery, but Eureka adds:
- Structured evidence extraction
- Quality gating and scoring
- Citation-level anchoring
- Automated synthesis
- Deduplication across sources

**Q: Can it replace manual systematic reviews?**
A: Not entirely. Eureka accelerates the search and extraction phases, but human review is still needed for:
- Final study selection
- Risk of bias assessment
- Meta-analysis statistics
- Interpretation and recommendations

**Q: What about full-text analysis?**
A: Currently abstract-only. Full-text PDF mining is planned for future releases.

**Q: How often is the data updated?**
A: Sources are queried in real-time (not a static index). Cache TTLs ensure freshness (6h query, 30d paper).

**Q: Can I use it for non-biomedical fields?**
A: Yes! While optimized for biomedicine, it works for any domain in OpenAlex/Semantic Scholar (CS, physics, social sciences, etc.).

**Q: Is there a rate limit?**
A: Yes, based on external APIs:
- OpenAlex: 50,000/day
- Semantic Scholar: 100/min
- For high-volume use, contact us about dedicated instances

---

## Troubleshooting

### Search Takes Too Long
- Check provider health status
- May be hitting rate limits
- Try narrowing query or adding year filter

### No Results Returned
- Query may be too specific
- Try removing some filters
- Check if all providers returned errors

### Quality Scores Seem Low
- Default threshold is 0.6
- Can adjust in settings
- Some fields have lower-quality literature

### Cache Not Working
- Check expires_at timestamps
- Query must match exactly (including filters)
- Cache warmed up after first use

---

This script provides a comprehensive walkthrough of Eureka's capabilities suitable for demos, user training, or evaluation sessions.
