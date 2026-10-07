import { describe, expect, it } from "vitest";
import {
  buildTermUsage,
  formatTermUsageReport,
} from "../glossary/termUsageReport";
import type { Glossary, SubtitleCue } from "../models";

const cue = (id: string, text: string): SubtitleCue => ({
  id,
  index: Number(id),
  startMs: 0,
  endMs: 2000,
  text,
});

const glossary: Glossary = {
  version: 1,
  importedAt: 1,
  terms: [
    {
      id: "term-1",
      source: "HUD",
      allowed: ["抬头显示", "平视系统"],
      preferred: "抬头显示",
    },
    {
      id: "term-2",
      source: "Ark",
      allowed: ["方舟"],
      preferred: "方舟",
    },
    {
      id: "term-3",
      source: "旁白专用词",
      allowed: ["旁白写法"],
      scope: { cueIndexes: [9] },
    },
  ],
};

describe("term usage report", () => {
  it("summarizes consistent, inconsistent and missing usage", () => {
    const rows = buildTermUsage(
      [
        cue("1", "抬头显示正常"),
        cue("2", "平视系统出现"),
        cue("3", "Ark 没有翻译"),
      ],
      glossary,
    );
    expect(rows[0]).toMatchObject({
      source: "HUD",
      status: "inconsistent",
      preferredCount: 1,
      okCount: 1,
      forms: "抬头显示 / 平视系统",
      cues: "1,2",
    });
    expect(rows[1]).toMatchObject({
      source: "Ark",
      status: "missing",
      missingCount: 1,
    });
    // 生效范围不包含任何条目 → unused，而不是误报漏译
    expect(rows[2].status).toBe("unused");
  });

  it("renders a BOM-prefixed CSV with a header row", () => {
    const csv = formatTermUsageReport([cue("1", "抬头显示")], glossary);
    expect(csv.startsWith("﻿")).toBe(true);
    const lines = csv.trim().split("\n");
    expect(lines[0]).toContain("源术语");
    expect(lines[0]).toContain("全半角差异");
    expect(
      lines.some((line) => line.includes("HUD") && line.includes("一致")),
    ).toBe(true);
  });
});
