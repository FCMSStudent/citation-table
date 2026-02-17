from reportlab.lib.pagesizes import letter
from reportlab.lib.utils import simpleSplit
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas

OUTPUT = "output/pdf/eureka-app-summary.pdf"

PAGE_W, PAGE_H = letter
LEFT = 48
RIGHT = 48
TOP = 48
BOTTOM = 48
CONTENT_W = PAGE_W - LEFT - RIGHT

TITLE_FONT = "Helvetica-Bold"
HEAD_FONT = "Helvetica-Bold"
BODY_FONT = "Helvetica"

TITLE_SIZE = 18
HEAD_SIZE = 12
BODY_SIZE = 10.3
LEADING = 13.4


def draw_wrapped(c, text, x, y, width, font=BODY_FONT, size=BODY_SIZE, leading=LEADING):
    lines = simpleSplit(text, font, size, width)
    c.setFont(font, size)
    for line in lines:
        c.drawString(x, y, line)
        y -= leading
    return y


def draw_heading(c, text, x, y):
    c.setFont(HEAD_FONT, HEAD_SIZE)
    c.drawString(x, y, text)
    return y - (LEADING - 1)


def draw_bullet(c, text, x, y, width):
    prefix = "- "
    prefix_w = stringWidth(prefix, BODY_FONT, BODY_SIZE)
    lines = simpleSplit(text, BODY_FONT, BODY_SIZE, width - prefix_w)
    c.setFont(BODY_FONT, BODY_SIZE)
    for i, line in enumerate(lines):
        if i == 0:
            c.drawString(x, y, prefix + line)
        else:
            c.drawString(x + prefix_w, y, line)
        y -= LEADING
    return y


def draw_numbered(c, n, text, x, y, width):
    prefix = f"{n}. "
    prefix_w = stringWidth(prefix, BODY_FONT, BODY_SIZE)
    lines = simpleSplit(text, BODY_FONT, BODY_SIZE, width - prefix_w)
    c.setFont(BODY_FONT, BODY_SIZE)
    for i, line in enumerate(lines):
        if i == 0:
            c.drawString(x, y, prefix + line)
        else:
            c.drawString(x + prefix_w, y, line)
        y -= LEADING
    return y


def main():
    c = canvas.Canvas(OUTPUT, pagesize=letter)
    y = PAGE_H - TOP

    c.setFont(TITLE_FONT, TITLE_SIZE)
    c.drawString(LEFT, y, "Eureka App Summary")
    y -= 22

    y = draw_heading(c, "What it is", LEFT, y)
    y = draw_wrapped(
        c,
        "Eureka is an evidence-focused literature search app built with React, Vite, and Supabase Edge Functions.",
        LEFT,
        y,
        CONTENT_W,
    )
    y = draw_wrapped(
        c,
        "It turns a research question into citation-grounded study results, synthesis outputs, and reusable report artifacts.",
        LEFT,
        y,
        CONTENT_W,
    )
    y -= 4

    y = draw_heading(c, "Who it is for", LEFT, y)
    y = draw_wrapped(
        c,
        "Primary persona: researchers or evidence analysts who need fast, source-linked answers from literature databases.",
        LEFT,
        y,
        CONTENT_W,
    )
    y -= 4

    y = draw_heading(c, "What it does", LEFT, y)
    feature_bullets = [
        "Provides authenticated routes for search, report history, and report detail views.",
        "Starts asynchronous research jobs via research-async and tracks lifecycle state in research_reports.",
        "Queries OpenAlex, Semantic Scholar, arXiv, and PubMed, then deduplicates and ranks results.",
        "Extracts structured study fields (design, outcomes, sample size, citation metadata) with strict and partial tiers.",
        "Generates narrative synthesis and evidence tables, and supports follow-up paper chat responses.",
        "Exports report data as CSV (paper or outcomes) and RIS; supports manual Add Study by DOI.",
        "Attempts DOI PDF retrieval with scihub-download, stores files in the papers bucket, and tracks study_pdfs status.",
    ]
    for item in feature_bullets:
        y = draw_bullet(c, item, LEFT, y, CONTENT_W)
    y -= 2

    y = draw_heading(c, "How it works (repo evidence)", LEFT, y)
    architecture_bullets = [
        "Frontend: React + Vite + TypeScript with feature-based structure (src/app, src/features, src/entities, src/shared).",
        "Frontend uses Supabase Auth and calls Edge Functions: research-async, synthesize-papers, chat-papers, add-study, coci, scihub-download.",
        "research-async orchestrates query processing, multi-provider retrieval, dedupe/canonicalization, metadata enrichment, and deterministic extraction.",
        "Data persists in Supabase Postgres and storage (research_reports, study_pdfs, lit_query_cache, lit_paper_cache, query_processing_events, metadata_enrichment_*, rate_limits).",
        "Optional PDF extraction path: if PDF_EXTRACTOR_URL is set, extraction calls FastAPI /extract/studies; otherwise it falls back to abstract text.",
        "Primary flow: user query -> research-async pipeline -> external APIs/AI services -> Postgres/storage -> polling UI + synthesis/chat endpoints.",
    ]
    for item in architecture_bullets:
        y = draw_bullet(c, item, LEFT, y, CONTENT_W)
    y -= 2

    y = draw_heading(c, "How to run (minimal)", LEFT, y)
    steps = [
        "Install dependencies: npm install.",
        "Start frontend dev server: npm run dev.",
        "Open the local Vite URL, then sign in (or guest sign-in) to access /app.",
        "Optional project config: set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY from .env.example.",
        "Full local Supabase Edge deployment workflow: Not found in repo.",
    ]
    for idx, item in enumerate(steps, start=1):
        y = draw_numbered(c, idx, item, LEFT, y, CONTENT_W)

    # Guardrail marker for overflow during generation (should remain above bottom margin)
    if y < BOTTOM:
        c.setFont("Helvetica-Bold", 9)
        c.drawString(LEFT, BOTTOM - 12, "[Layout warning: content exceeded one page]")

    c.showPage()
    c.save()


if __name__ == "__main__":
    main()
