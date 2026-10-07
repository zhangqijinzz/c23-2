import type { Glossary, SubtitleCue, TermMark } from "../models";
import { checkTerms } from "./termChecker";

export interface TermUsageRow {
  source: string;
  preferred: string;
  allowed: string[];
  scopeText: string;
  hits: Array<{ index: number; matched: string; kind: TermMark["kind"] }>;
  counts: Record<TermMark["kind"], number>;
  status: "全部符合" | "未出现" | "有待确认";
}

export interface TermUsageReport {
  projectName: string;
  generatedAt: number;
  glossaryName: string;
  rows: TermUsageRow[];
}

const scopeText = (glossary: Glossary, termIndex: number): string => {
  const ranges = glossary.terms[termIndex]?.ranges ?? [];
  if (!ranges.length) return "全部条目";
  return ranges
    .map(({ from, to }) =>
      to === Number.POSITIVE_INFINITY
        ? `${from} 起`
        : to === from
          ? `${from}`
          : `${from}-${to}`,
    )
    .join(", ");
};

const emptyCounts = (): Record<TermMark["kind"], number> => ({
  "term-ok": 0,
  "term-missing": 0,
  "term-inconsistent": 0,
  "term-case": 0,
  "term-width": 0,
});

const KIND_LABEL: Record<TermMark["kind"], string> = {
  "term-ok": "符合",
  "term-missing": "漏译",
  "term-inconsistent": "译法不一致",
  "term-case": "大小写",
  "term-width": "全半角",
};

export function buildTermUsageReport(
  cues: SubtitleCue[],
  glossary: Glossary,
  projectName: string,
): TermUsageReport {
  const indexById = new Map(cues.map((cue) => [cue.id, cue.index]));
  const rows: TermUsageRow[] = glossary.terms.map((term, termIndex) => {
    const counts = emptyCounts();
    const hits: TermUsageRow["hits"] = [];
    for (const mark of checkTerms(cues, glossary).marks) {
      if (mark.termId !== term.id) continue;
      counts[mark.kind] += 1;
      hits.push({
        index: indexById.get(mark.cueId) ?? 0,
        matched: mark.matched,
        kind: mark.kind,
      });
    }
    hits.sort((a, b) => a.index - b.index);
    const problems =
      counts["term-missing"] +
      counts["term-inconsistent"] +
      counts["term-case"] +
      counts["term-width"];
    return {
      source: term.source,
      preferred: term.preferred,
      allowed: term.allowed,
      scopeText: scopeText(glossary, termIndex),
      hits,
      counts,
      status: !hits.length ? "未出现" : problems ? "有待确认" : "全部符合",
    };
  });
  return {
    projectName,
    generatedAt: Date.now(),
    glossaryName: glossary.fileName,
    rows,
  };
}

const cell = (value: string): string =>
  value.replace(/\|/g, "\\|").replace(/\n/g, " ");

export function formatTermUsageReport(report: TermUsageReport): string {
  const lines: string[] = [
    `# 术语使用情况清单`,
    "",
    `- 项目：${report.projectName}`,
    `- 术语表：${report.glossaryName}`,
    `- 生成时间：${new Date(report.generatedAt).toLocaleString()}`,
    `- 术语总数：${report.rows.length}`,
    "",
    "| 术语 | 标准译法 | 其它允许写法 | 生效场景 | 命中条目 | 漏译 | 译法不一致 | 大小写 | 全半角 | 状态 |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const row of rowsLines(report.rows)) lines.push(row);
  lines.push("", "## 命中明细", "");
  for (const row of report.rows) {
    lines.push(`### ${row.source} → ${row.preferred}`);
    if (!row.hits.length) {
      lines.push("- 未在字幕中出现", "");
      continue;
    }
    const grouped = new Map<number, TermUsageRow["hits"]>();
    for (const hit of row.hits) {
      const list = grouped.get(hit.index) ?? [];
      list.push(hit);
      grouped.set(hit.index, list);
    }
    for (const [index, list] of [...grouped].sort((a, b) => a[0] - b[0])) {
      const detail = list
        .map((hit) => `「${hit.matched}」${KIND_LABEL[hit.kind]}`)
        .join("，");
      lines.push(`- 第 ${index} 条：${detail}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function rowsLines(rows: TermUsageRow[]): string[] {
  return rows.map((row) => {
    const locations = row.hits.length
      ? [...new Set(row.hits.map((hit) => hit.index))]
          .sort((a, b) => a - b)
          .map((index) => `#${index}`)
          .join(" ")
      : "—";
    return `| ${cell(row.source)} | ${cell(row.preferred)} | ${cell(row.allowed.join("；") || "—")} | ${row.scopeText} | ${locations} | ${row.counts["term-missing"]} | ${row.counts["term-inconsistent"]} | ${row.counts["term-case"]} | ${row.counts["term-width"]} | ${row.status} |`;
  });
}
