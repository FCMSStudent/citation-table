from __future__ import annotations

import io
import ipaddress
import re
import socket
from dataclasses import dataclass
from typing import Dict, List, Literal, Optional, Tuple
from urllib.parse import urlparse

import httpx
import pdfplumber
from pydantic import BaseModel, Field
from pypdf import PdfReader

StudyDesign = Literal["RCT", "cohort", "cross-sectional", "review", "unknown"]
StudySource = Literal["openalex", "semantic_scholar", "arxiv", "pubmed"]


class PaperExtractionRequest(BaseModel):
    study_id: str
    title: str
    year: int
    source: StudySource
    doi: Optional[str] = None
    pubmed_id: Optional[str] = None
    openalex_id: Optional[str] = None
    abstract: str = ""
    pdf_url: Optional[str] = None
    landing_page_url: Optional[str] = None
    citationCount: Optional[int] = None
    preprint_status: Optional[Literal["Preprint", "Peer-reviewed"]] = None


class ExtractStudiesRequest(BaseModel):
    papers: List[PaperExtractionRequest] = Field(default_factory=list)
    timeout_ms: int = 12000


class CitationModel(BaseModel):
    doi: Optional[str] = None
    pubmed_id: Optional[str] = None
    openalex_id: Optional[str] = None
    formatted: str


class OutcomeModel(BaseModel):
    outcome_measured: str
    key_result: Optional[str] = None
    citation_snippet: str
    intervention: Optional[str] = None
    comparator: Optional[str] = None
    effect_size: Optional[str] = None
    p_value: Optional[str] = None


class StudyResultModel(BaseModel):
    study_id: str
    title: str
    year: int
    study_design: StudyDesign
    sample_size: Optional[int] = None
    population: Optional[str] = None
    outcomes: List[OutcomeModel]
    citation: CitationModel
    abstract_excerpt: str
    preprint_status: Literal["Preprint", "Peer-reviewed"]
    review_type: Literal["None", "Systematic review", "Meta-analysis"]
    source: StudySource
    citationCount: Optional[int] = None
    pdf_url: Optional[str] = None
    landing_page_url: Optional[str] = None


class DiagnosticsModel(BaseModel):
    engine: Literal["pdf", "abstract"]
    used_pdf: bool
    fallback_reason: Optional[str] = None
    parse_error: Optional[str] = None
    outcome_confidence: List[float] = Field(default_factory=list)


class ExtractionItemModel(BaseModel):
    study_id: str
    study: Optional[StudyResultModel] = None
    diagnostics: Optional[DiagnosticsModel] = None
    error: Optional[str] = None


class ExtractStudiesResponse(BaseModel):
    results: List[ExtractionItemModel]


MAX_PDF_BYTES = 15 * 1024 * 1024
MAX_PDF_PAGES = 25
DEFAULT_TIMEOUT_SECONDS = 12

EFFECT_PATTERN = re.compile(
    r"\b(?:OR|RR|HR|SMD|MD|IRR|beta|β|Cohen'?s?\s*d|d)\s*(?:=|:)\s*[-+]?\d+(?:\.\d+)?(?:\s*\([^)]*\))?",
    re.IGNORECASE,
)
CI_PATTERN = re.compile(r"\b(?:95%\s*CI|CI\s*95%|confidence\s*interval)\b[^.;]*", re.IGNORECASE)
P_VALUE_PATTERN = re.compile(r"\bp\s*(?:=|<|>|<=|>=)\s*0?\.\d+", re.IGNORECASE)

SAMPLE_PATTERNS = [
    re.compile(r"\bn\s*=\s*(\d{2,7})\b", re.IGNORECASE),
    re.compile(r"\bN\s*=\s*(\d{2,7})\b", re.IGNORECASE),
    re.compile(r"\b(\d{2,7})\s+(?:participants|patients|subjects|adults|children|individuals)\b", re.IGNORECASE),
]

RESULT_MARKERS = [
    "significant",
    "associated",
    "increase",
    "decrease",
    "improv",
    "reduc",
    "odds ratio",
    "hazard ratio",
    "risk ratio",
    "confidence interval",
    "p=",
    "p <",
    "p>",
    "versus",
    "vs",
    "compared",
]


@dataclass
class ParseOutcome:
    outcome: OutcomeModel
    confidence: float


def normalize_whitespace(raw: str) -> str:
    text = raw.replace("\r\n", "\n").replace("\t", " ")
    text = re.sub(r"-\s*\n\s*", "", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def split_sentences(text: str) -> List[str]:
    normalized = normalize_whitespace(text)
    if not normalized:
        return []
    return [s.strip() for s in re.split(r"(?<=[.!?])\s+", normalized) if s.strip()]


def is_private_host(host: str) -> bool:
    lowered = host.lower()
    if lowered in {"localhost", "metadata", "metadata.google.internal"}:
        return True
    if lowered.endswith(".local") or lowered.endswith(".internal"):
        return True

    try:
        ip = ipaddress.ip_address(lowered)
        return bool(ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast)
    except ValueError:
        pass

    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        return True

    for info in infos:
        addr = info[4][0]
        try:
            ip = ipaddress.ip_address(addr)
        except ValueError:
            return True
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
            return True

    return False


def validate_pdf_url(pdf_url: str) -> Optional[str]:
    parsed = urlparse(pdf_url)
    if parsed.scheme.lower() != "https":
        return "only_https_allowed"
    if not parsed.hostname:
        return "invalid_url"
    if is_private_host(parsed.hostname):
        return "private_host_rejected"
    return None


def download_pdf_bytes(pdf_url: str, timeout_seconds: int) -> bytes:
    with httpx.Client(timeout=timeout_seconds, follow_redirects=True) as client:
        with client.stream("GET", pdf_url) as response:
            response.raise_for_status()
            chunks: List[bytes] = []
            total = 0
            for chunk in response.iter_bytes(8192):
                total += len(chunk)
                if total > MAX_PDF_BYTES:
                    raise ValueError("pdf_too_large")
                chunks.append(chunk)
            return b"".join(chunks)


def extract_pdf_text(pdf_bytes: bytes) -> str:
    text_parts: List[str] = []

    try:
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            for page in pdf.pages[:MAX_PDF_PAGES]:
                text = page.extract_text() or ""
                if text:
                    text_parts.append(text)
    except Exception:
        text_parts = []

    if not text_parts:
        reader = PdfReader(io.BytesIO(pdf_bytes))
        for page in reader.pages[:MAX_PDF_PAGES]:
            text = page.extract_text() or ""
            if text:
                text_parts.append(text)

    return normalize_whitespace("\n".join(text_parts))


def classify_review_type(text: str) -> Literal["None", "Systematic review", "Meta-analysis"]:
    lowered = text.lower()
    if "meta-analysis" in lowered or "meta analysis" in lowered:
        return "Meta-analysis"
    if "systematic review" in lowered:
        return "Systematic review"
    return "None"


def classify_study_design(text: str) -> StudyDesign:
    lowered = text.lower()
    if re.search(r"\b(meta-analysis|meta analysis|systematic review|scoping review|literature review|review)\b", lowered):
        return "review"
    if re.search(r"\b(randomized|randomised|randomly assigned|rct|controlled trial|clinical trial)\b", lowered):
        return "RCT"
    if re.search(r"\b(cohort|prospective|retrospective|follow-up|longitudinal)\b", lowered):
        return "cohort"
    if re.search(r"\b(cross-sectional|cross sectional|prevalence survey|survey)\b", lowered):
        return "cross-sectional"
    return "unknown"


def extract_sample_size(text: str) -> Optional[int]:
    for pattern in SAMPLE_PATTERNS:
        match = pattern.search(text)
        if not match:
            continue
        value = int(match.group(1))
        if 2 <= value <= 10_000_000:
            return value
    return None


def extract_population(text: str) -> Optional[str]:
    for sentence in split_sentences(text):
        if re.search(r"\b(participants|patients|subjects|adults|children|pregnant|volunteers|individuals)\b", sentence, re.IGNORECASE):
            return sentence[:220]
    return None


def extract_intervention_comparator(sentence: str) -> Tuple[Optional[str], Optional[str]]:
    patterns = [
        re.compile(r"\b([^.;,]{2,80}?)\s+(?:vs\.?|versus|compared\s+with|compared\s+to|against)\s+([^.;,]{2,80})", re.IGNORECASE),
        re.compile(r"\brandomi[sz]ed\s+to\s+([^.;,]{2,80}?)\s+(?:or|versus|vs\.?|compared\s+with)\s+([^.;,]{2,80})", re.IGNORECASE),
    ]

    for pattern in patterns:
        match = pattern.search(sentence)
        if not match:
            continue
        intervention = normalize_whitespace(match.group(1)).removeprefix("the ")
        comparator = normalize_whitespace(match.group(2)).removeprefix("the ")
        if intervention and comparator:
            return intervention, comparator

    return None, None


def infer_outcome(sentence: str) -> str:
    patterns = [
        re.compile(r"(?:improv(?:ed|ement)?\s+in|increase(?:d)?\s+in|decrease(?:d)?\s+in|reduction\s+in|associated\s+with|effect\s+on)\s+([a-z0-9\s\-]{3,80})", re.IGNORECASE),
        re.compile(r"([a-z0-9\s\-]{3,80})\s+(?:improved|increased|decreased|reduced|was\s+associated)", re.IGNORECASE),
    ]

    for pattern in patterns:
        match = pattern.search(sentence)
        if match and match.group(1):
            outcome = normalize_whitespace(match.group(1))
            outcome = re.sub(r"\b(the|a|an)\b", "", outcome, flags=re.IGNORECASE).strip()
            if len(outcome) >= 3:
                return outcome[:120]

    tokens = re.sub(r"[^a-z0-9\s]", " ", sentence.lower()).split()
    tokens = [token for token in tokens if len(token) > 2]
    return " ".join(tokens[:8]) or "reported outcome"


def score_outcome(outcome: OutcomeModel) -> float:
    score = 0.2
    if outcome.key_result:
        score += 0.2
    if outcome.effect_size:
        score += 0.25
    if outcome.p_value:
        score += 0.2
    if outcome.intervention:
        score += 0.15
    if outcome.comparator:
        score += 0.15
    if outcome.citation_snippet and len(outcome.citation_snippet) >= 20:
        score += 0.1
    return max(0.0, min(1.0, score))


def dedupe_outcomes(items: List[ParseOutcome]) -> List[ParseOutcome]:
    seen = set()
    output: List[ParseOutcome] = []

    for item in items:
        key = "|".join([
            item.outcome.outcome_measured.lower().strip(),
            (item.outcome.effect_size or "").lower().strip(),
            (item.outcome.p_value or "").lower().strip(),
            re.sub(r"\s+", " ", item.outcome.citation_snippet.lower()).strip(),
        ])
        if key in seen:
            continue
        seen.add(key)
        output.append(item)

    return output


def extract_outcomes(text: str) -> Tuple[List[OutcomeModel], List[float]]:
    sentences = split_sentences(text)
    candidates: List[ParseOutcome] = []

    for sentence in sentences:
        lowered = sentence.lower()
        if not any(marker in lowered for marker in RESULT_MARKERS):
            continue

        intervention, comparator = extract_intervention_comparator(sentence)
        effect_match = EFFECT_PATTERN.search(sentence)
        p_match = P_VALUE_PATTERN.search(sentence)
        ci_match = CI_PATTERN.search(sentence)

        outcome = OutcomeModel(
            outcome_measured=infer_outcome(sentence),
            key_result=sentence,
            citation_snippet=sentence,
            intervention=intervention,
            comparator=comparator,
            effect_size=normalize_whitespace(effect_match.group(0)) if effect_match else None,
            p_value=normalize_whitespace(p_match.group(0)) if p_match else (normalize_whitespace(ci_match.group(0)) if ci_match else None),
        )
        candidates.append(ParseOutcome(outcome=outcome, confidence=score_outcome(outcome)))

    deduped = dedupe_outcomes(candidates)
    filtered = [item for item in deduped if item.confidence >= 0.35]

    if not filtered and deduped:
        best = sorted(deduped, key=lambda x: x.confidence, reverse=True)[0]
        return [best.outcome], [best.confidence]

    if not filtered and sentences:
        fallback_sentence = sentences[0][:280]
        fallback = OutcomeModel(
            outcome_measured=infer_outcome(fallback_sentence),
            key_result=fallback_sentence,
            citation_snippet=fallback_sentence,
            intervention=None,
            comparator=None,
            effect_size=None,
            p_value=None,
        )
        return [fallback], [score_outcome(fallback)]

    return [item.outcome for item in filtered], [item.confidence for item in filtered]


def excerpt(text: str) -> str:
    normalized = normalize_whitespace(text)
    if len(normalized) <= 420:
        return normalized
    return normalized[:419] + "..."


def format_citation(paper: PaperExtractionRequest) -> str:
    return f"Unknown ({paper.year}). {paper.title}.".strip()


def build_study(
    paper: PaperExtractionRequest,
    raw_text: str,
    engine: Literal["pdf", "abstract"],
    fallback_reason: Optional[str] = None,
    parse_error: Optional[str] = None,
) -> ExtractionItemModel:
    text = normalize_whitespace(raw_text or paper.abstract or paper.title)
    design = classify_study_design(f"{paper.title}. {text}")
    review_type = classify_review_type(f"{paper.title}. {text}")
    if design == "unknown" and review_type != "None":
        design = "review"

    outcomes, confidence = extract_outcomes(text)

    study = StudyResultModel(
        study_id=paper.study_id,
        title=paper.title,
        year=paper.year,
        study_design=design,
        sample_size=extract_sample_size(text),
        population=extract_population(text),
        outcomes=outcomes,
        citation=CitationModel(
            doi=paper.doi,
            pubmed_id=paper.pubmed_id,
            openalex_id=paper.openalex_id,
            formatted=format_citation(paper),
        ),
        abstract_excerpt=excerpt(paper.abstract or text or paper.title),
        preprint_status=paper.preprint_status or ("Preprint" if paper.source == "arxiv" else "Peer-reviewed"),
        review_type=review_type,
        source=paper.source,
        citationCount=paper.citationCount,
        pdf_url=paper.pdf_url,
        landing_page_url=paper.landing_page_url,
    )

    diagnostics = DiagnosticsModel(
        engine=engine,
        used_pdf=engine == "pdf",
        fallback_reason=fallback_reason,
        parse_error=parse_error,
        outcome_confidence=confidence,
    )

    return ExtractionItemModel(study_id=paper.study_id, study=study, diagnostics=diagnostics)


def extract_one(paper: PaperExtractionRequest, timeout_ms: int) -> ExtractionItemModel:
    timeout_seconds = max(1, min(60, timeout_ms // 1000 or DEFAULT_TIMEOUT_SECONDS))
    parse_error: Optional[str] = None

    if paper.pdf_url:
        reason = validate_pdf_url(paper.pdf_url)
        if reason:
            parse_error = reason
        else:
            try:
                pdf_bytes = download_pdf_bytes(paper.pdf_url, timeout_seconds)
                if not pdf_bytes.startswith(b"%PDF"):
                    raise ValueError("invalid_pdf_header")
                text = extract_pdf_text(pdf_bytes)
                if text:
                    return build_study(paper, text, engine="pdf")
                parse_error = "empty_pdf_text"
            except Exception as exc:  # pragma: no cover - defensive
                parse_error = str(exc)[:200]

    return build_study(
        paper,
        paper.abstract or paper.title,
        engine="abstract",
        fallback_reason=parse_error or ("missing_pdf_url" if not paper.pdf_url else "pdf_fallback"),
        parse_error=parse_error,
    )


def extract_studies_batch(request: ExtractStudiesRequest) -> ExtractStudiesResponse:
    results: List[ExtractionItemModel] = []
    timeout_ms = max(1000, min(60000, int(request.timeout_ms or 12000)))

    for paper in request.papers:
        try:
            results.append(extract_one(paper, timeout_ms))
        except Exception as exc:  # pragma: no cover - defensive
            results.append(ExtractionItemModel(study_id=paper.study_id, error=str(exc)[:200]))

    return ExtractStudiesResponse(results=results)
