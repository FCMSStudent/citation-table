## 2025-05-15 - [Edge Function & Environment Hardening]
**Vulnerability:** Edge Function exposed via `verify_jwt = false` and `.env` file committed to repository.
**Learning:** Even if API keys are "public" (VITE_ prefixed), committing `.env` is a security risk as it encourages bad patterns and may lead to accidental leaks of sensitive keys (like service_role). Permissive Edge Function settings (`verify_jwt = false`) expose paid resources (LLM credits) to unauthorized consumption.
**Prevention:** Always add `.env` to `.gitignore` and remove from index if accidentally committed. Ensure Edge Functions verify JWTs by default, and implement input length limits and secure error handling to prevent DoS and information leakage.

## 2025-05-22 - [XSS Protection via URL Sanitization]
**Vulnerability:** Potential XSS via malicious URI schemes (`javascript:`, `data:`) in research identifiers (DOIs, OpenAlex IDs) fetched from external sources.
**Learning:** While some links are prefixed with trusted domains, raw identifiers used directly in `href` attributes (like `openalex_id`) pose a direct XSS risk. Protocol-based sanitization is necessary to ensure that external data cannot execute arbitrary JavaScript.
**Prevention:** Use a dedicated `sanitizeUrl` utility for all `href` and `src` attributes containing external data. Complement this with frontend input character limits to prevent resource abuse and provide a consistent security posture with the backend.

## 2025-05-30 - [Edge Function Hardening & Input Validation]
**Vulnerability:** Potential resource abuse and URL manipulation in Edge Functions due to lack of input validation and direct string concatenation in API calls.
**Learning:** Even simple proxy-like Edge Functions (e.g., COCI) require strict input validation. Lack of `encodeURIComponent` on user-supplied path segments allows for path traversal or URL manipulation attacks against external APIs.
**Prevention:** Implement input length limits (e.g., 500 chars), validate expected patterns (e.g., DOI prefix), and always use `encodeURIComponent` for dynamic URL segments. Ensure catch blocks return generic error messages to avoid information leakage.
