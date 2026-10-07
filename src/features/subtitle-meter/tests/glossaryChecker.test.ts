import { describe, expect, it } from "vitest";
import { checkGlossary, termApplies } from "../glossary/glossaryChecker";
import type { Glossary, SubtitleCue } from "../models";

const cue = (
  id: string,
  text: string,
  startMs = 0,
  endMs = 2000,
): SubtitleCue => ({
  id,
  index: Number(id),
  startMs,
  endMs,
  text,
});

const glossary = (terms: Glossary["terms"]): Glossary => ({
  version: 1,
  terms,
  importedAt: 1,
});
const term = (
  source: string,
  allowed: string[],
  preferred?: string,
  scope?: Glossary["terms"][number]["scope"],
): Glossary["terms"][number] => ({
  id: `term-${source}`,
  source,
  allowed,
  preferred: preferred ?? allowed[0],
  scope,
});

const types = (glossaryData: Glossary, cues: SubtitleCue[]) =>
  checkGlossary(cues, glossaryData).issues.map((issue) => issue.type);

describe("glossary checker", () => {
  it("returns nothing without a glossary", () => {
    expect(checkGlossary([cue("1", "WiFi")], null)).toEqual({
      hits: [],
      issues: [],
    });
    expect(checkGlossary([cue("1", "WiFi")], undefined)).toEqual({
      hits: [],
      issues: [],
    });
  });

  it("flags untranslated source text as a missing error", () => {
    const data = glossary([term("Ark", ["方舟"])]);
    const result = checkGlossary([cue("1", "Ark 已经启动")], data);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({
      type: "glossary-missing",
      severity: "error",
    });
    expect(result.hits[0]).toMatchObject({ kind: "missing", actual: "Ark" });
  });

  it("treats source listed among allowed forms as a valid hit", () => {
    const data = glossary([term("WiFi", ["无线网络", "WiFi"], "无线网络")]);
    expect(types(data, [cue("1", "连接 WiFi")])).toEqual([]);
    const result = checkGlossary([cue("1", "连接 WiFi")], data);
    expect(result.hits[0]).toMatchObject({ kind: "variant", actual: "WiFi" });
  });

  it("flags case differences separately", () => {
    const data = glossary([
      term("Subspace", ["子空间"]),
      term("LaForge", ["拉福吉", "LaForge"], "LaForge"),
    ]);
    const result = checkGlossary(
      [cue("1", "laforge 报告"), cue("2", "子空间稳定")],
      data,
    );
    const caseIssue = result.issues.find(
      (issue) => issue.type === "glossary-case",
    );
    expect(caseIssue).toBeDefined();
    expect(caseIssue?.span).toEqual({ start: 0, end: 7 });
  });

  it("flags full-width / half-width differences separately", () => {
    const data = glossary([term("WiFi", ["无线网络", "WiFi"], "WiFi")]);
    const result = checkGlossary([cue("1", "连接 ＷｉＦｉ")], data);
    const widthIssue = result.issues.find(
      (issue) => issue.type === "glossary-width",
    );
    expect(widthIssue).toBeDefined();
    expect(widthIssue?.message).toContain("全半角");
    expect(result.hits[0].actual).toBe("ＷｉＦｉ");
  });

  it("flags inconsistency only when preferred and another allowed form co-occur", () => {
    const data = glossary([term("HUD", ["抬头显示", "平视系统"], "抬头显示")]);
    // 全文统一使用同一个非首选允许写法 → 不提醒
    expect(
      checkGlossary([cue("1", "平视系统开启"), cue("2", "平视系统关闭")], data)
        .issues,
    ).toEqual([]);
    // 首选与其它允许写法同时出现 → 译法不一致
    const result = checkGlossary(
      [cue("1", "抬头显示开启"), cue("2", "平视系统关闭")],
      data,
    );
    expect(result.issues.map((issue) => issue.type)).toEqual([
      "glossary-inconsistent",
    ]);
  });

  it("respects scoped terms and treats out-of-scope cues as unaffected", () => {
    const scoped = term("Captain", ["舰长"], "舰长", {
      cueIndexes: [1, 2],
      keyword: "舰桥",
    });
    const inScope = cue("1", "舰桥：Captain 到了", 0, 5000);
    const wrongKeyword = cue("2", "食堂：Captain 到了", 0, 5000);
    const outOfRange = cue("3", "Captain 到了", 60000, 62000);
    expect(termApplies(scoped, inScope)).toBe(true);
    expect(termApplies(scoped, wrongKeyword)).toBe(false);
    expect(termApplies(scoped, outOfRange)).toBe(false);
    const data = glossary([
      term("Captain", ["舰长"], "舰长", { cueIndexes: [1] }),
    ]);
    expect(types(data, [inScope, cue("2", "Captain")])).toEqual([
      "glossary-missing",
    ]);
  });

  it("supports time-window scopes", () => {
    const data = glossary([
      term("Echo", ["回声"], "回声", { startMs: 10000, endMs: 20000 }),
    ]);
    expect(
      checkGlossary([cue("1", "Echo", 0, 5000)], data).issues,
    ).toHaveLength(0);
    expect(
      checkGlossary([cue("1", "Echo", 12000, 14000)], data).issues,
    ).toHaveLength(1);
  });

  it("prefers the longest match when terms overlap", () => {
    const data = glossary([
      term("AI", ["人工智能", "AI"], "人工智能"),
      term("AID", ["援助"], "援助"),
    ]);
    const result = checkGlossary([cue("1", "使用 AID 系统")], data);
    // “援助”未出现；“AI”是 AID 的子串，源术语 AID 应作为漏译命中整条
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]).toMatchObject({ actual: "AID", kind: "missing" });
  });

  it("attaches spans that point at the original characters", () => {
    const data = glossary([term("Core", ["核心"])]);
    const result = checkGlossary([cue("1", "启动 Core")], data);
    const span = result.issues[0].span!;
    expect(result.hits[0].cueId).toBe("1");
    expect("启动 Core".slice(span.start, span.end)).toBe("Core");
  });

  it("does not match Latin source terms inside larger words", () => {
    const data = glossary([term("art", ["艺术"])]);
    // “start” 包含 “art” 子串，但不是独立词，不应报漏译
    expect(checkGlossary([cue("1", "press start")], data).issues).toEqual([]);
    // 标点/空格边界仍应命中
    expect(checkGlossary([cue("1", "modern art！")], data).issues).toHaveLength(
      1,
    );
  });

  it("matches Chinese source terms as substrings without word boundaries", () => {
    const data = glossary([term("方舟", ["方舟号"])]);
    expect(checkGlossary([cue("1", "方舟已经启航")], data).issues[0].type).toBe(
      "glossary-missing",
    );
  });
});
