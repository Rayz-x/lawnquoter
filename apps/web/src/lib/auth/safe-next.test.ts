import { describe, expect, it } from "vitest";
import { safeNext } from "./safe-next";

describe("safeNext", () => {
  it("allows a same-origin path", () => {
    expect(safeNext("/dashboard")).toBe("/dashboard");
    expect(safeNext("/settings/team")).toBe("/settings/team");
    expect(safeNext("/invites/accept?token=abc")).toBe("/invites/accept?token=abc");
  });

  it("falls back when next is missing", () => {
    expect(safeNext(null)).toBe("/dashboard");
    expect(safeNext(undefined)).toBe("/dashboard");
    expect(safeNext("")).toBe("/dashboard");
    expect(safeNext("   ")).toBe("/dashboard");
  });

  it("rejects absolute and protocol-relative urls", () => {
    expect(safeNext("https://evil.example")).toBe("/dashboard");
    expect(safeNext("http://evil.example/phish")).toBe("/dashboard");
    expect(safeNext("//evil.example")).toBe("/dashboard");
    expect(safeNext("///evil.example")).toBe("/dashboard");
    expect(safeNext("//evil.example/path")).toBe("/dashboard");
  });

  it("rejects backslashes, including the slash-backslash trick", () => {
    expect(safeNext("/\\evil.example")).toBe("/dashboard");
    expect(safeNext("\\\\evil.example")).toBe("/dashboard");
    expect(safeNext("/foo\\bar")).toBe("/dashboard");
    expect(safeNext("/%5Cevil.example")).toBe("/dashboard");
    expect(safeNext("/%5cevil.example")).toBe("/dashboard");
  });

  it("rejects an encoded protocol-relative path", () => {
    expect(safeNext("/%2F%2Fevil.example")).toBe("/dashboard");
    expect(safeNext("/%2f/evil.example")).toBe("/dashboard");
  });
});
