import { checkGlossary, termApplies } from "./glossaryChecker";
import { scopeLabel } from "./scopeFormat";
import type { Glossary, SubtitleCue } from "../models";

export interface TermUsageRow {
  source: string;
  preferred: string;
  allowed: string;
  scope: string;
  /** 规范写法（首选/其它允许写法）命中次数 */
  okCount: number;
  preferredCount: number;
  missingCount: number;
  inconsistentCount: number;
  caseCount: number;
  widthCount: number;
  /** 实际出现过的写法 */
  forms: string;
  /** 命中所在条目序号 */
  cues: string;
  status: "ok" | "unused" | "missing" | "inconsistent" | "case" | "width";
  note: string;
}

/** 汇总每个术语在字幕中的使用情况，供交付时附带的术语使用清单 */
export function buildTermUsage(
  cues: SubtitleCue[],
  glossary: Glossary,
): TermUsageRow[] {
  const { hits, issues } = checkGlossary(cues, glossary);
  return glossary.terms.map((term) => {
    const preferred = term.preferred ?? term.allowed[0];
    const termHits = hits.filter((hit) => hit.termId === term.id);
    const termIssues = issues.filter((issue) => issue.termId === term.id);
    const counts = {
      preferred: termHits.filter((hit) => hit.kind === "preferred").length,
      ok: termHits.filter((hit) => hit.kind === "variant").length,
      missing: termIssues.filter((issue) => issue.type === "glossary-missing")
        .length,
      inconsistent: termIssues.filter(
        (issue) => issue.type === "glossary-inconsistent",
      ).length,
      case: termIssues.filter((issue) => issue.type === "glossary-case").length,
      width: termIssues.filter((issue) => issue.type === "glossary-width")
        .length,
    };
    const forms = [...new Set(termHits.map((hit) => hit.actual))].join(" / ");
    const cueIds = new Set(termHits.map((hit) => hit.cueId));
    const cueIndexes = cues
      .filter((cue) => cueIds.has(cue.id))
      .map((cue) => cue.index);
    const applies = cues.filter((cue) => termApplies(term, cue));
    let status: TermUsageRow["status"];
    if (counts.missing > 0) status = "missing";
    else if (counts.inconsistent > 0) status = "inconsistent";
    else if (counts.width > 0) status = "width";
    else if (counts.case > 0) status = "case";
    else if (termHits.length === 0)
      status = applies.length === 0 ? "unused" : "missing";
    else status = "ok";
    return {
      source: term.source,
      preferred,
      allowed: term.allowed.join(" / "),
      scope: scopeLabel(term),
      okCount: counts.ok,
      preferredCount: counts.preferred,
      missingCount: counts.missing,
      inconsistentCount: counts.inconsistent,
      caseCount: counts.case,
      widthCount: counts.width,
      forms: forms || "—",
      cues: cueIndexes.length ? cueIndexes.join(",") : "—",
      status,
      note: term.note ?? "",
    };
  });
}

const STATUS_LABELS: Record<TermUsageRow["status"], string> = {
  ok: "一致",
  unused: "不在生效范围",
  missing: "漏译/未出现",
  inconsistent: "译法不一致",
  case: "大小写差异",
  width: "全半角差异",
};

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\n;；]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** 生成带 BOM 的 UTF-8 CSV，可直接用 Excel 打开 */
export function formatTermUsageReport(
  cues: SubtitleCue[],
  glossary: Glossary,
): string {
  const rows = buildTermUsage(cues, glossary);
  const header = [
    "源术语",
    "首选写法",
    "允许写法",
    "生效范围",
    "状态",
    "首选命中",
    "其他允许写法命中",
    "漏译",
    "译法不一致",
    "大小写差异",
    "全半角差异",
    "实际写法",
    "所在条目",
    "备注",
  ];
  const lines = rows.map((row) =>
    [
      row.source,
      row.preferred,
      row.allowed,
      row.scope,
      STATUS_LABELS[row.status],
      row.preferredCount,
      row.okCount,
      row.missingCount,
      row.inconsistentCount,
      row.caseCount,
      row.widthCount,
      row.forms,
      row.cues,
      row.note,
    ]
      .map(csvCell)
      .join(","),
  );
  return `${"\uFEFF"}${[header.join(","), ...lines].join("\n")}\n`;
}
