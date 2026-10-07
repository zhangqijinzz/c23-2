import { describe, expect, it } from "vitest";
import type { Glossary, SubtitleCue } from "../models";
import { checkTerms, foldWidth } from "../terminology/termChecker";
import { parseGlossary, parseRanges } from "../terminology/glossaryParser";

const cue = (index: number, text: string): SubtitleCue => ({
  id: `cue-${index}`,
  index,
  startMs: index * 1000,
  endMs: index * 1000 + 900,
  text,
});

const glossary = (terms: Glossary["terms"]): Glossary => ({
  version: 1,
  importedAt: 1,
  fileName: "terms.csv",
  terms,
});

const term = (
  source: string,
  preferred: string,
  extra: Partial<Glossary["terms"][number]> = {},
): Glossary["terms"][number] => ({
  id: source,
  source,
  preferred,
  allowed: [],
  forbidden: [],
  ranges: [],
  ...extra,
});

const kinds = (result: ReturnType<typeof checkTerms>) =>
  result.issues.map((issue) => issue.type);

describe("foldWidth", () => {
  it("folds full-width ASCII and space", () => {
    expect(foldWidth("ＡＢＣ！")).toBe("ABC!");
    expect(foldWidth("　")).toBe(" ");
  });
});

describe("checkTerms", () => {
  it("returns nothing without a glossary", () => {
    expect(checkTerms([cue(1, "whatever")], null)).toEqual({
      issues: [],
      marks: [],
    });
    expect(checkTerms([cue(1, "whatever")], undefined)).toEqual({
      issues: [],
      marks: [],
    });
  });

  it("flags source text still present as a missing-translation issue", () => {
    const result = checkTerms(
      [cue(1, "这里有 Nebula 还没译")],
      glossary([term("Nebula", "星云")]),
    );
    expect(kinds(result)).toContain("term-missing");
    const mark = result.marks[0];
    expect(mark).toMatchObject({ kind: "term-missing", matched: "Nebula" });
    // 位置基于码点，指向原文
    expect("这里有 Nebula 还没译".slice(mark.start, mark.end)).toBe("Nebula");
  });

  it("treats preferred and allowed spellings as OK", () => {
    const result = checkTerms(
      [cue(1, "星云与星云号都合法")],
      glossary([term("Nebula", "星云", { allowed: ["星云号"] })]),
    );
    expect(result.issues).toHaveLength(0);
    expect(result.marks.map((m) => m.kind)).toEqual(["term-ok", "term-ok"]);
  });

  it("flags forbidden spellings as inconsistent", () => {
    const result = checkTerms(
      [cue(1, "旧译纳布拉已废弃")],
      glossary([term("Nebula", "星云", { forbidden: ["纳布拉"] })]),
    );
    expect(kinds(result)).toEqual(["term-inconsistent"]);
  });

  it("distinguishes case-only differences", () => {
    const result = checkTerms(
      [cue(1, "请写成 nebula 而不是这个")],
      glossary([term("Nebula", "星云")]),
    );
    // source 是「Nebula」，小写命中源文：既未翻译又有大小写差异
    expect(kinds(result)).toContain("term-missing");
  });

  it("flags case mismatch on the preferred English form", () => {
    const result = checkTerms(
      [cue(1, "使用 iphone 是错误的大小写")],
      glossary([term("source-x", "iPhone")]),
    );
    expect(kinds(result)).toEqual(["term-case"]);
    expect(result.issues[0].severity).toBe("info");
  });

  it("flags full-width/half-width differences", () => {
    const result = checkTerms(
      [cue(1, "型号是ＡＢＣ-１")],
      glossary([term("src", "ABC-1")]),
    );
    expect(kinds(result)).toEqual(["term-width"]);
  });

  it("respects cue-index scopes", () => {
    const scoped = glossary([
      term("Nebula", "星云", { ranges: [{ from: 2, to: 3 }] }),
    ]);
    expect(
      checkTerms(
        [cue(1, "Nebula 在范围外"), cue(2, "Nebula 在范围内")],
        scoped,
      ).issues.map((i) => i.cueId),
    ).toEqual(["cue-2"]);
  });

  it("supports open-ended ranges", () => {
    const scoped = glossary([
      term("Nebula", "星云", { ranges: [{ from: 3, to: Infinity }] }),
    ]);
    const result = checkTerms([cue(1, "Nebula"), cue(3, "Nebula")], scoped);
    expect(result.issues.map((i) => i.cueId)).toEqual(["cue-3"]);
  });

  it("does not double-report a term nested inside an allowed hit", () => {
    const result = checkTerms(
      [cue(1, "星云系统很好，纳布拉不好")],
      glossary([term("Nebula", "星云", { forbidden: ["纳布拉"] })]),
    );
    // 「星云」命中 OK；「纳布拉」仍要报
    expect(kinds(result)).toEqual(["term-inconsistent"]);
  });

  it("deduplicates identical findings within one cue but keeps positions", () => {
    const result = checkTerms(
      [cue(1, "Nebula 与 Nebula")],
      glossary([term("Nebula", "星云")]),
    );
    expect(result.issues).toHaveLength(1);
    expect(result.marks).toHaveLength(2);
  });

  it("keeps every occurrence position in marks", () => {
    const result = checkTerms(
      [cue(1, "星云，星云")],
      glossary([term("Nebula", "星云")]),
    );
    expect(result.marks.map((m) => [m.start, m.end])).toEqual([
      [0, 2],
      [3, 5],
    ]);
  });
});

describe("parseRanges", () => {
  it("parses single indices, ranges and open ends", () => {
    expect(parseRanges("1-3, 8,12-")).toEqual([
      { from: 1, to: 3 },
      { from: 8, to: 8 },
      { from: 12, to: Infinity },
    ]);
  });
  it("rejects malformed ranges", () => {
    expect(() => parseRanges("abc")).toThrow(/无法识别/);
    expect(() => parseRanges("5-2")).toThrow(/起始大于结束/);
  });
});

describe("parseGlossary", () => {
  it("parses a Chinese-headered CSV with multiple allowed forms", () => {
    const csv = [
      "术语,标准译法,允许写法,弃用译法,场景",
      "Nebula,星云,星云号｜星云系统,纳布拉,1-2",
      'iPhone,苹果手机,,"爱疯",',
    ].join("\n");
    const parsed = parseGlossary(csv, "g.csv");
    expect(parsed.terms).toHaveLength(2);
    expect(parsed.terms[0]).toMatchObject({
      source: "Nebula",
      preferred: "星云",
      allowed: ["星云号", "星云系统"],
      forbidden: ["纳布拉"],
      ranges: [{ from: 1, to: 2 }],
    });
    expect(parsed.terms[1].forbidden).toEqual(["爱疯"]);
    expect(parsed.terms[1].ranges).toEqual([]);
  });

  it("parses JSON with terms array", () => {
    const parsed = parseGlossary(
      JSON.stringify({
        terms: [
          {
            source: "Nebula",
            preferred: "星云",
            allowed: ["星云号"],
            ranges: [1, { from: 3, to: 5 }],
          },
        ],
      }),
      "g.json",
    );
    expect(parsed.terms[0].ranges).toEqual([
      { from: 1, to: 1 },
      { from: 3, to: 5 },
    ]);
  });

  it("rejects files missing required columns", () => {
    expect(() => parseGlossary("a,b\n1,2", "g.csv")).toThrow(/source/);
    expect(() => parseGlossary("术语,b\n星云,x", "g.csv")).toThrow(/标准译法/);
  });

  it("rejects rows with an empty preferred translation", () => {
    expect(() => parseGlossary("术语,标准译法\nNebula,", "g.csv")).toThrow(
      /缺少标准译法/,
    );
  });
});
