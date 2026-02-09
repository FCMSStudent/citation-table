import { describe, it, expect, vi } from "vitest";
import { sanitizeUrl } from "../lib/utils";

describe("sanitizeUrl", () => {
  it("should allow safe http and https URLs", () => {
    expect(sanitizeUrl("https://example.com")).toBe("https://example.com");
    expect(sanitizeUrl("http://example.com/path?query=1")).toBe("http://example.com/path?query=1");
  });

  it("should block javascript: URLs", () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(sanitizeUrl("javascript:alert(1)")).toBe("about:blank");
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("should block data: URLs", () => {
    expect(sanitizeUrl("data:text/html,<script>alert(1)</script>")).toBe("about:blank");
  });

  it("should block vbscript: URLs", () => {
    expect(sanitizeUrl("vbscript:msgbox('hello')")).toBe("about:blank");
  });

  it("should handle null and undefined", () => {
    expect(sanitizeUrl(null)).toBe("");
    expect(sanitizeUrl(undefined)).toBe("");
  });

  it("should trim whitespace", () => {
    expect(sanitizeUrl("  https://example.com  ")).toBe("https://example.com");
  });

  it("should be case-insensitive for protocols", () => {
    expect(sanitizeUrl("JAVASCRIPT:alert(1)")).toBe("about:blank");
  });
});
