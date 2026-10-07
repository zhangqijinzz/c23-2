import { describe, expect, it } from "vitest";
import {
  parseGlossary,
  parseScope,
  splitDelimited,
} from "../glossary/glossaryParser";

describe("glossary parser", () => {
  it("parses CSV with Chinese headers and multiple allowed forms", () => {
    const result = parseGlossary(
      "源术语,允许写法,首选写法\nWiFi,无线网络；WiFi,无线网络\n字幕,字幕",
    );
    expect(result.warnings).toEqual([]);
    expect(result.glossary.terms).toHaveLength(2);
    expect(result.glossary.terms[0]).toMatchObject({
      source: "WiFi",
      allowed: ["无线网络", "WiFi"],
      preferred: "无线网络",
    });
  });

  it("parses TSV and quoted cells containing commas", () => {
    const result = parseGlossary('source\tallowed\n"AI, artificial"\t人工智能');
    expect(result.glossary.terms[0].source).toBe("AI, artificial");
  });

  it("collects per-row warnings and skips invalid rows", () => {
    const result = parseGlossary(
      "源术语,允许写法,首选写法\n,只有源术语缺失\nHUD,抬头显示；平视系统,错误首选\nHUD,抬头显示,抬头显示",
    );
    expect(result.glossary.terms.map((term) => term.source)).toEqual(["HUD"]);
    expect(result.glossary.terms[0].allowed).toEqual(["抬头显示"]);
    expect(result.warnings.join(" ")).toContain("缺少源术语");
    expect(result.warnings.join(" ")).toContain("首选写法");
    expect(result.warnings.join(" ")).toContain("重复");
  });

  it("parses JSON arrays with structured scopes", () => {
    const result = parseGlossary(
      JSON.stringify({
        terms: [
          {
            source: "Captain",
            allowed: ["舰长", "队长"],
            preferred: "舰长",
            scope: { cueIndexes: [1, 2, 3], keyword: "舰桥" },
          },
        ],
      }),
    );
    expect(result.glossary.terms[0].scope).toEqual({
      cueIndexes: [1, 2, 3],
      keyword: "舰桥",
    });
  });

  it("rejects files without required columns", () => {
    expect(() => parseGlossary("术语,说明\nWiFi,网络")).toThrow("允许写法");
    expect(() => parseGlossary("   ")).toThrow("为空");
  });

  it("parses textual scopes with index ranges and time windows", () => {
    expect(parseScope("1-3")).toEqual({ cueIndexes: [1, 2, 3] });
    expect(parseScope("1, 5, 9")).toEqual({ cueIndexes: [1, 5, 9] });
    expect(parseScope("00:10-01:30")).toEqual({
      startMs: 10000,
      endMs: 90000,
    });
    expect(parseScope("旁白")).toEqual({ keyword: "旁白" });
    expect(parseScope("2-4；旁白")).toEqual({
      cueIndexes: [2, 3, 4],
      keyword: "旁白",
    });
  });

  it("splits delimited lines respecting quotes", () => {
    expect(splitDelimited('a, "b, c", d')).toEqual(["a", "b, c", "d"]);
    expect(splitDelimited("a\tb\tc")).toEqual(["a", "b", "c"]);
  });

  it("formats open-ended time windows without NaN", () => {
    expect(parseScope("00:10-")).toEqual({ startMs: 10000 });
    expect(parseScope("-01:30")).toEqual({ endMs: 90000 });
    expect(parseScope("1:02:03-1:03:00")).toEqual({
      startMs: 3723000,
      endMs: 3780000,
    });
  });
});
