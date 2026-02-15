import unittest

from fastapi.testclient import TestClient

import app.main as main_module


class PdfExtractionContractTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(main_module.app)

    def test_extract_studies_contract(self):
        payload = {
            "timeout_ms": 5000,
            "papers": [
                {
                    "study_id": "s-1",
                    "title": "Randomized melatonin trial",
                    "year": 2024,
                    "source": "pubmed",
                    "doi": "10.1000/test",
                    "pubmed_id": "12345",
                    "openalex_id": None,
                    "abstract": "Methods: n=120 participants were randomized. Melatonin versus placebo improved sleep quality with p = 0.02.",
                    "pdf_url": None,
                }
            ],
        }

        response = self.client.post("/extract/studies", json=payload)
        self.assertEqual(response.status_code, 200)

        body = response.json()
        self.assertIn("results", body)
        self.assertEqual(len(body["results"]), 1)

        item = body["results"][0]
        self.assertEqual(item["study_id"], "s-1")
        self.assertIn("study", item)
        self.assertIn("diagnostics", item)
        self.assertEqual(item["diagnostics"]["engine"], "abstract")
        self.assertTrue(len(item["study"]["outcomes"]) >= 1)

    def test_rejects_private_pdf_host_with_fallback(self):
        payload = {
            "timeout_ms": 5000,
            "papers": [
                {
                    "study_id": "s-2",
                    "title": "Cohort sleep study",
                    "year": 2022,
                    "source": "openalex",
                    "doi": None,
                    "pubmed_id": None,
                    "openalex_id": "W123",
                    "abstract": "A cohort study followed 240 participants and observed improved sleep quality.",
                    "pdf_url": "https://localhost/private.pdf",
                }
            ],
        }

        response = self.client.post("/extract/studies", json=payload)
        self.assertEqual(response.status_code, 200)
        item = response.json()["results"][0]
        self.assertEqual(item["diagnostics"]["engine"], "abstract")
        self.assertEqual(item["diagnostics"]["parse_error"], "private_host_rejected")

    def test_bearer_token_guard_when_enabled(self):
        original_token = main_module.PDF_EXTRACTOR_BEARER_TOKEN
        main_module.PDF_EXTRACTOR_BEARER_TOKEN = "secret-token"
        try:
            response = self.client.post("/extract/studies", json={"papers": []})
            self.assertEqual(response.status_code, 401)

            ok = self.client.post(
                "/extract/studies",
                json={"papers": []},
                headers={"Authorization": "Bearer secret-token"},
            )
            self.assertEqual(ok.status_code, 200)
        finally:
            main_module.PDF_EXTRACTOR_BEARER_TOKEN = original_token


if __name__ == "__main__":
    unittest.main()
