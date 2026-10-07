import type { Glossary, GlossaryTerm } from "../models";

/** 解析「1-3, 8,12-」这类条目序号范围；from 从 1 开始 */
export function parseRanges(raw: string): GlossaryTerm["ranges"] {
  const ranges: GlossaryTerm["ranges"] = [];
  for (const part of raw.split(/[,，;；]/)) {
    const segment = part.trim();
    if (!segment) continue;
    const single = segment.match(/^(\d+)$/);
    if (single) {
      ranges.push({ from: Number(single[1]), to: Number(single[1]) });
      continue;
    }
    const match = segment.match(/^(\d+)\s*[-–—~～]\s*(\d+)?\s*$/);
    if (!match) throw new Error(`场景范围格式无法识别「${segment}」`);
    const from = Number(match[1]);
    const to = match[2] ? Number(match[2]) : Number.POSITIVE_INFINITY;
    if (match[2] && to < from)
      throw new Error(`场景范围 ${from}-${to} 起始大于结束`);
    ranges.push({ from, to });
  }
  return ranges;
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === "," || ch === "\t" || ch === ";" || ch === "，") {
      cells.push(cell.trim());
      cell = "";
    } else cell += ch;
  }
  cells.push(cell.trim());
  return cells;
}

function splitMulti(raw: string): string[] {
  return raw
    .split(/[|｜;；\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

const HEADERS: Record<string, keyof RowFields> = {
  术语: "source",
  原文: "source",
  source: "source",
  term: "source",
  标准译法: "preferred",
  推荐译法: "preferred",
  译名: "preferred",
  preferred: "preferred",
  translation: "preferred",
  允许写法: "allowed",
  允许: "allowed",
  其它译法: "allowed",
  allowed: "allowed",
  alternatives: "allowed",
  弃用译法: "forbidden",
  禁用译法: "forbidden",
  forbidden: "forbidden",
  deprecated: "forbidden",
  场景: "ranges",
  范围: "ranges",
  适用范围: "ranges",
  scope: "ranges",
  range: "ranges",
  备注: "note",
  note: "note",
};

interface RowFields {
  source: string;
  preferred: string;
  allowed: string;
  forbidden: string;
  ranges: string;
  note: string;
}

function normalizeHeader(cell: string): keyof RowFields | undefined {
  const key = cell.trim().toLowerCase().replace(/\s+/g, "");
  for (const [header, field] of Object.entries(HEADERS))
    if (header.toLowerCase() === key) return field;
  return undefined;
}

function rowsToTerms(rows: string[][]): GlossaryTerm[] {
  if (rows.length < 2) throw new Error("术语表为空，至少需要表头和一条术语");
  const columns = rows[0].map(normalizeHeader);
  if (!columns.includes("source"))
    throw new Error("表头缺少「术语 / source」列");
  if (!columns.includes("preferred"))
    throw new Error("表头缺少「标准译法 / preferred」列");
  const terms: GlossaryTerm[] = [];
  const knownSources = new Set<string>();
  rows.slice(1).forEach((cells, rowIndex) => {
    if (cells.every((cell) => !cell)) return;
    const get = (field: keyof RowFields) => cells[columns.indexOf(field)] ?? "";
    const source = get("source").trim();
    if (!source) return;
    if (knownSources.has(source)) return; // 同一术语重复行以首行为准
    const preferred = get("preferred").trim();
    if (!preferred)
      throw new Error(`第 ${rowIndex + 2} 行「${source}」缺少标准译法`);
    knownSources.add(source);
    terms.push({
      id: `term-${terms.length + 1}`,
      source,
      preferred,
      allowed: splitMulti(get("allowed")).filter((item) => item !== preferred),
      forbidden: splitMulti(get("forbidden")),
      ranges: parseRanges(get("ranges")),
      note: get("note") || undefined,
    });
  });
  if (!terms.length) throw new Error("术语表为空，至少需要一条术语");
  return terms;
}

function parseCsv(raw: string): GlossaryTerm[] {
  const source = raw.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const rows = source
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map(splitCsvLine);
  return rowsToTerms(rows);
}

interface JsonTermShape {
  source?: unknown;
  term?: unknown;
  preferred?: unknown;
  translation?: unknown;
  allowed?: unknown;
  alternatives?: unknown;
  forbidden?: unknown;
  deprecated?: unknown;
  ranges?: unknown;
  scope?: unknown;
  note?: unknown;
}

const asString = (value: unknown, label: string): string => {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`${label}必须是非空字符串`);
  return value.trim();
};
const asStringList = (value: unknown, label: string): string[] => {
  if (value === undefined || value === null || value === "") return [];
  if (typeof value === "string") return splitMulti(value);
  if (Array.isArray(value) && value.every((item) => typeof item === "string"))
    return (value as string[]).map((item) => item.trim()).filter(Boolean);
  throw new Error(`${label}必须是字符串或字符串数组`);
};
const asRanges = (value: unknown): GlossaryTerm["ranges"] => {
  if (value === undefined || value === null || value === "") return [];
  if (typeof value === "string") return parseRanges(value);
  if (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === "number" ||
        (typeof item === "object" &&
          item !== null &&
          ("from" in item || "start" in item)),
    )
  ) {
    const ranges: GlossaryTerm["ranges"] = [];
    for (const item of value as Array<number | object>) {
      if (typeof item === "number") {
        if (!Number.isFinite(item) || item < 1)
          throw new Error("场景序号必须从 1 开始");
        ranges.push({ from: item, to: item });
      } else {
        const record = item as {
          from?: unknown;
          start?: unknown;
          to?: unknown;
          end?: unknown;
        };
        const from = Number(record.from ?? record.start);
        const toRaw = record.to ?? record.end ?? from;
        const to =
          toRaw === null || toRaw === undefined || toRaw === ""
            ? Number.POSITIVE_INFINITY
            : Number(toRaw);
        if (!Number.isFinite(from) || from < 1)
          throw new Error("场景范围起始必须从 1 开始");
        if (!Number.isFinite(to)) {
          ranges.push({ from, to: Number.POSITIVE_INFINITY });
        } else {
          if (to < from) throw new Error(`场景范围 ${from}-${to} 起始大于结束`);
          ranges.push({ from, to });
        }
      }
    }
    return ranges;
  }
  throw new Error("场景范围必须是序号、数组或 {from,to} 对象");
};

function parseJson(raw: string): GlossaryTerm[] {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("术语表 JSON 格式无法解析");
  }
  const list: unknown[] = Array.isArray(data)
    ? data
    : data &&
        typeof data === "object" &&
        Array.isArray((data as { terms?: unknown[] }).terms)
      ? (data as { terms: unknown[] }).terms
      : [];
  if (!list.length) throw new Error("术语表 JSON 需要非空 terms 数组");
  const terms: GlossaryTerm[] = [];
  const knownSources = new Set<string>();
  list.forEach((item, index) => {
    if (!item || typeof item !== "object")
      throw new Error(`第 ${index + 1} 条术语格式不正确`);
    const shape = item as JsonTermShape;
    const source = asString(
      shape.source ?? shape.term,
      `第 ${index + 1} 条术语原文`,
    );
    if (knownSources.has(source)) return;
    const preferred = asString(
      shape.preferred ?? shape.translation,
      `术语「${source}」标准译法`,
    );
    knownSources.add(source);
    terms.push({
      id: `term-${terms.length + 1}`,
      source,
      preferred,
      allowed: asStringList(
        shape.allowed ?? shape.alternatives,
        "允许写法",
      ).filter((entry) => entry !== preferred),
      forbidden: asStringList(shape.forbidden ?? shape.deprecated, "弃用译法"),
      ranges: asRanges(shape.ranges ?? shape.scope),
      note: typeof shape.note === "string" ? shape.note : undefined,
    });
  });
  if (!terms.length) throw new Error("术语表为空，至少需要一条术语");
  return terms;
}

export function parseGlossary(raw: string, fileName: string): Glossary {
  const looksJson =
    /\.json$/i.test(fileName) ||
    raw.trimStart().startsWith("{") ||
    raw.trimStart().startsWith("[");
  const terms = looksJson ? parseJson(raw) : parseCsv(raw);
  return { version: 1, importedAt: Date.now(), fileName, terms };
}
