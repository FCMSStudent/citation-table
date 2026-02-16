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

## 2026-02-15 - [Python Microservice Hardening]
**Vulnerability:** Unbounded in-memory task storage, lack of concurrency control, and race conditions in file downloads within the Python microservice.
**Learning:** Microservices using background threads for file operations without isolation or concurrency limits are vulnerable to both DoS (resource exhaustion) and race conditions (file collision). In-memory stores must implement explicit eviction policies (e.g., FIFO) to prevent OOM.
**Prevention:** Enforce strict Pydantic input validation (max_length, Literal types), implement a global semaphore for background thread concurrency, and use task-specific unique subdirectories for all concurrent file operations.

## 2026-02-16 - [Python Microservice Authentication Unification]
**Vulnerability:** Inconsistent authentication across microservice endpoints and information leakage via task listing and health check.
**Learning:** Partially implemented security (protecting only the most sensitive-looking endpoint) often leaves other vectors open, such as metadata leakage via monitoring endpoints (`/api/tasks`) or resource abuse via unprotected functional endpoints. Disclosing internal paths in health checks aids attackers in mapping the server environment.
**Prevention:** Use FastAPI dependencies to apply authentication globally or to all functional endpoints consistently. Always sanitize health check responses to remove internal environment details like directory structures.
