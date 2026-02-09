## 2025-05-15 - [Edge Function & Environment Hardening]
**Vulnerability:** Edge Function exposed via `verify_jwt = false` and `.env` file committed to repository.
**Learning:** Even if API keys are "public" (VITE_ prefixed), committing `.env` is a security risk as it encourages bad patterns and may lead to accidental leaks of sensitive keys (like service_role). Permissive Edge Function settings (`verify_jwt = false`) expose paid resources (LLM credits) to unauthorized consumption.
**Prevention:** Always add `.env` to `.gitignore` and remove from index if accidentally committed. Ensure Edge Functions verify JWTs by default, and implement input length limits and secure error handling to prevent DoS and information leakage.

## 2025-05-20 - [Client-Side URL Sanitization]
**Vulnerability:** External IDs (DOI, OpenAlex ID) from APIs/LLMs used directly in `href` attributes.
**Learning:** Even trusted data sources or LLM-processed data can potentially contain malicious URI schemes like `javascript:`. React's default escaping only handles content, not the `href` protocol itself.
**Prevention:** Use a `sanitizeUrl` utility to block insecure protocols (`javascript:`, `data:`, `vbscript:`) before passing strings to `href` or `src` attributes.
