import type { Glossary, GlossaryScope, GlossaryTerm } from "../models";

export interface GlossaryParseResult {
  glossary: Glossary;
  warnings: string[];
}

const HEADER_ALIASES: Record<string, keyof TermRow> = {
  源术语: "source",
  术语: "source",
  原文: "source",
  source: "source",
  term: "source",
  允许写法: "allowed",
  允许: "allowed",
  译法: "allowed",
  译文: "allowed",
  推荐写法: "allowed",
  allowed: "allowed",
  translations: "allowed",
  translation: "allowed",
  首选: "preferred",
  首选写法: "preferred",
  preferred: "preferred",
  场景: "scope",
  生效范围: "scope",
  scope: "scope",
  context: "scope",
  备注: "note",
  说明: "note",
  note: "note",
};

interface TermRow {
  source: string;
  allowed: string;
  preferred?: string;
  scope?: string;
  /** 结构化范围（JSON 导入），优先于 scope 文本 */
  scopeObject?: GlossaryScope;
  note?: string;
}

/** 支持引号的单行切分，分隔符为逗号或制表符（含连续空白的制表符） */
export function splitDelimited(line: string): string[] {
  const delimiter = line.includes("\t") ? "\t" : ",";
  const cells: string[] = [];
  let current = "",
    quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quoted) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else quoted = false;
      } else current += char;
    } else if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      cells.push(current);
      current = "";
    } else current += char;
  }
  cells.push(current);
  return cells.map((cell) => cell.trim());
}

function splitForms(value: string): string[] {
  return value
    .split(/\s*[;；、|｜]\s*/)
    .map((form) => form.trim())
    .filter(Boolean);
}

/**
 * 解析场景限定。支持以分号组合的多个条件：
 * 条目 1-3,12 · 00:10-01:30（任一侧可省略表示开放区间）· 关键词
 */
export function parseScope(raw: string): GlossaryScope | undefined {
  const scope: GlossaryScope = {};
  const stampToMs = (stamp: string) => {
    const parts = stamp.split(":").map(Number);
    const [h, m, s] = parts.length === 3 ? parts : [0, parts[0], parts[1]];
    return (h * 3600 + m * 60 + s) * 1000;
  };
  for (const part of raw.split(/[;；\n]/)) {
    const text = part.trim();
    if (!text) continue;
    const range = text.match(/^(\d+)\s*[-–—~]\s*(\d+)$/);
    const indexList = text.match(/^\d+(\s*[,，]\s*\d+)+$/);
    // 00:10-01:30 或 00:10-（只限定起点）/ -01:30（只限定终点）
    const dashParts = text.split(/\s*[-–—~]\s*/);
    const isStamp = (value: string) => /^\d{1,2}(?::\d{2}){1,2}$/.test(value);
    if (range) {
      const from = Number(range[1]),
        to = Number(range[2]);
      scope.cueIndexes = Array.from(
        { length: Math.max(0, to - from + 1) },
        (_, offset) => from + offset,
      );
    } else if (indexList) {
      scope.cueIndexes = text
        .split(/[,，]/)
        .map((value) => Number(value.trim()));
    } else if (dashParts.length === 2 && dashParts.some(isStamp)) {
      if (isStamp(dashParts[0])) scope.startMs = stampToMs(dashParts[0]);
      if (isStamp(dashParts[1])) scope.endMs = stampToMs(dashParts[1]);
    } else {
      scope.keyword = text;
    }
  }
  return Object.keys(scope).length ? scope : undefined;
}

function rowsToTerms(rows: TermRow[]): GlossaryParseResult {
  const terms: GlossaryTerm[] = [];
  const warnings: string[] = [];
  const seen = new Map<string, number>();
  rows.forEach((row, index) => {
    const line = index + 1;
    const source = row.source.trim();
    if (!source) {
      warnings.push(`第 ${line} 行缺少源术语，已跳过`);
      return;
    }
    const allowed = splitForms(row.allowed);
    if (!allowed.length) {
      warnings.push(`第 ${line} 行「${source}」缺少允许写法，已跳过`);
      return;
    }
    const preferred = row.preferred?.trim();
    if (preferred && !allowed.includes(preferred)) {
      warnings.push(
        `第 ${line} 行首选写法「${preferred}」不在允许写法中，改用第一个允许写法`,
      );
    }
    const duplicate = seen.get(source);
    if (duplicate !== undefined) {
      warnings.push(
        `第 ${line} 行与第 ${duplicate} 行源术语重复，已覆盖旧条目`,
      );
      const existing = terms.findIndex((term) => term.source === source);
      if (existing >= 0) terms.splice(existing, 1);
    }
    seen.set(source, line);
    terms.push({
      id: `term-${terms.length + 1}`,
      source,
      allowed: [...new Set(allowed)],
      preferred:
        preferred && allowed.includes(preferred) ? preferred : allowed[0],
      scope: row.scopeObject ?? (row.scope ? parseScope(row.scope) : undefined),
      note: row.note?.trim() || undefined,
    });
  });
  return { glossary: { version: 1, terms, importedAt: Date.now() }, warnings };
}

function parseDelimited(raw: string): GlossaryParseResult {
  const lines = raw
    .replace(/^\uFEFF/, "")
    .split(/\r\n?|\n/)
    .map((line) => line.trim())
    .filter((line) => line.length);
  if (!lines.length)
    return {
      glossary: { version: 1, terms: [], importedAt: Date.now() },
      warnings: ["文件内容为空"],
    };
  const headers = splitDelimited(lines[0]).map(
    (header) => HEADER_ALIASES[header] ?? HEADER_ALIASES[header.toLowerCase()],
  );
  if (!headers.includes("source") || !headers.includes("allowed"))
    throw new Error("术语表需要包含「源术语」和「允许写法」两列");
  const rows: TermRow[] = [];
  lines.slice(1).forEach((line) => {
    const cells = splitDelimited(line);
    const row: Partial<TermRow> = {};
    headers.forEach((header, column) => {
      if (header) row[header] = cells[column] ?? "";
    });
    if (!row.source && !row.allowed) return;
    rows.push({
      source: row.source ?? "",
      allowed: row.allowed ?? "",
      preferred: row.preferred,
      scope: row.scope,
      note: row.note,
    });
  });
  return rowsToTerms(rows);
}

interface JsonTermShape {
  source?: unknown;
  term?: unknown;
  allowed?: unknown;
  translations?: unknown;
  preferred?: unknown;
  scope?: unknown;
  note?: unknown;
}

function asStringList(value: unknown): string[] {
  if (Array.isArray(value))
    return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === "string") return splitForms(value);
  return [];
}

function normalizeScope(scope: unknown): GlossaryScope | undefined {
  if (!scope || typeof scope !== "object") return undefined;
  const candidate = scope as Partial<GlossaryScope>;
  const normalized: GlossaryScope = {};
  if (Array.isArray(candidate.cueIndexes))
    normalized.cueIndexes = candidate.cueIndexes
      .map(Number)
      .filter(Number.isFinite);
  if (typeof candidate.startMs === "number")
    normalized.startMs = candidate.startMs;
  if (typeof candidate.endMs === "number") normalized.endMs = candidate.endMs;
  if (typeof candidate.keyword === "string" && candidate.keyword.trim())
    normalized.keyword = candidate.keyword;
  return Object.keys(normalized).length ? normalized : undefined;
}

function parseJson(raw: string): GlossaryParseResult {
  const data = JSON.parse(raw) as unknown;
  const list: unknown[] = Array.isArray(data)
    ? data
    : Array.isArray((data as { terms?: unknown[] })?.terms)
      ? (data as { terms: unknown[] }).terms
      : [];
  if (!list.length)
    throw new Error("JSON 术语表需要是非空数组或包含 terms 数组");
  const rows: TermRow[] = list.map((item) => {
    const term = (item ?? {}) as JsonTermShape;
    const scopeObject = normalizeScope(term.scope);
    return {
      source: String(term.source ?? term.term ?? "").trim(),
      allowed: asStringList(term.allowed ?? term.translations).join(" | "),
      preferred:
        term.preferred === undefined
          ? undefined
          : String(term.preferred).trim(),
      scope: typeof term.scope === "string" ? term.scope : undefined,
      scopeObject,
      note: term.note === undefined ? undefined : String(term.note),
    };
  });
  return rowsToTerms(rows);
}

/** 导入一份术语表：按内容自动识别 CSV/TSV（首行表头）或 JSON */
export function parseGlossary(raw: string): GlossaryParseResult {
  const text = raw.replace(/^\uFEFF/, "").trim();
  if (!text) throw new Error("术语表文件为空");
  if (text.startsWith("{") || text.startsWith("[")) return parseJson(text);
  return parseDelimited(text);
}
