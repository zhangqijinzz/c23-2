import { describe, expect, it } from "vitest";
import type { Glossary, SubtitleCue } from "../models";
import {
  buildTermUsageReport,
  formatTermUsageReport,
} from "../terminology/termUsageReport";

const cues: SubtitleCue[] = [
  { id: "cue-1", index: 1, startMs: 0, endMs: 1000, text: "Nebula 已抵达" },
  { id: "cue-2", index: 2, startMs: 1000, endMs: 2000, text: "星云 很好用" },
  { id: "cue-3", index: 3, startMs: 2000, endMs: 3000, text: "纳布拉 是旧译" },
];
const glossary: Glossary = {
  version: 1,
  importedAt: 1,
  fileName: "terms.csv",
  terms: [
    {
      id: "term-1",
      source: "Nebula",
      preferred: "星云",
      allowed: ["星云号"],
      forbidden: ["纳布拉"],
      ranges: [],
    },
    {
      id: "term-2",
      source: "Orbit",
      preferred: "轨道",
      allowed: [],
      forbidden: [],
      ranges: [{ from: 1, to: 2 }],
    },
  ],
};

describe("buildTermUsageReport", () => {
  it("collects per-term hit locations and statuses", () => {
    const report = buildTermUsageReport(cues, glossary, "clip.srt");
    const nebula = report.rows[0];
    expect(nebula.hits.map((h) => [h.index, h.kind])).toEqual([
      [1, "term-missing"],
      [2, "term-ok"],
      [3, "term-inconsistent"],
    ]);
    expect(nebula.status).toBe("有待确认");
    expect(nebula.counts["term-missing"]).toBe(1);
    expect(nebula.counts["term-inconsistent"]).toBe(1);
    expect(nebula.scopeText).toBe("全部条目");

    expect(report.rows[1].status).toBe("未出现");
    expect(report.rows[1].scopeText).toBe("1-2");
  });

  it("formats a markdown report with summary table and details", () => {
    const md = formatTermUsageReport(
      buildTermUsageReport(cues, glossary, "clip.srt"),
    );
    expect(md).toContain("# 术语使用情况清单");
    expect(md).toContain("项目：clip.srt");
    expect(md).toContain("Nebula");
    expect(md).toContain("第 1 条：「Nebula」漏译");
    expect(md).toContain("第 3 条：「纳布拉」译法不一致");
    expect(md).toContain("Orbit → 轨道");
    expect(md).toContain("未在字幕中出现");
  });

  it("marks a term fully conforming when every hit is an allowed form", () => {
    const ok: Glossary = {
      version: 1,
      importedAt: 1,
      fileName: "t.csv",
      terms: [
        {
          id: "term-1",
          source: "Nebula",
          preferred: "星云",
          allowed: [],
          forbidden: [],
          ranges: [],
        },
      ],
    };
    const report = buildTermUsageReport([{ ...cues[1] }], ok, "c.srt");
    expect(report.rows[0].status).toBe("全部符合");
  });
});
