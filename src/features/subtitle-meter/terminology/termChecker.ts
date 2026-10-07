import type {
  Glossary,
  GlossaryTerm,
  SubtitleCue,
  SubtitleIssue,
  TermMark,
} from "../models";

interface Hit {
  start: number;
  end: number;
  kind: TermMark["kind"];
  matched: string;
  canonical: string;
  termId: string;
  source: string;
  preferred: string;
  priority: number;
}

type Role = "forbidden" | "source" | "preferred" | "allowed";

const toChars = (value: string): string[] => Array.from(value);

/** 全角 ASCII（！～）与全角空格按 1:1 折叠为半角，保证命中位置不错位 */
export function foldWidthChar(ch: string): string {
  const cp = ch.codePointAt(0);
  if (cp === 0x3000) return " ";
  if (cp !== undefined && cp >= 0xff01 && cp <= 0xff5e)
    return String.fromCodePoint(cp - 0xff01 + 0x21);
  return ch;
}

export function foldWidth(value: string): string {
  return Array.from(value, foldWidthChar).join("");
}

/** 比较键：忽略大小写与全半角差异 */
const matchKey = (value: string): string[] =>
  Array.from(value, (ch) => foldWidthChar(ch).toLowerCase());

function findAll(
  haystack: string[],
  needle: string[],
): Array<{ start: number; end: number }> {
  const result: Array<{ start: number; end: number }> = [];
  if (!needle.length || needle.length > haystack.length) return result;
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++)
      if (haystack[i + j] !== needle[j]) continue outer;
    result.push({ start: i, end: i + needle.length });
  }
  return result;
}

const inScope = (term: GlossaryTerm, cue: SubtitleCue): boolean =>
  term.ranges.length === 0 ||
  term.ranges.some(({ from, to }) => cue.index >= from && cue.index <= to);

function classifyHit(
  text: string,
  form: { text: string; role: Role },
): { kind: TermMark["kind"]; priority: number; canonical: string } {
  const canonical = form.text;
  if (form.role === "forbidden")
    return { kind: "term-inconsistent", priority: 4, canonical };
  if (form.role === "source")
    return { kind: "term-missing", priority: 3, canonical };
  if (text === canonical) return { kind: "term-ok", priority: 1, canonical };
  // 标准/允许写法仅全半角不同
  if (foldWidth(text) === canonical)
    return { kind: "term-width", priority: 2, canonical };
  return { kind: "term-case", priority: 2, canonical };
}

function messageFor(hit: Hit): string {
  switch (hit.kind) {
    case "term-missing":
      return `术语「${hit.source}」疑似漏译：条目里仍出现原文「${hit.matched}」，标准译法「${hit.preferred}」`;
    case "term-inconsistent":
      return `术语「${hit.source}」出现译法「${hit.matched}」，不在允许列表中，建议「${hit.preferred}」`;
    case "term-case":
      return `「${hit.matched}」与「${hit.canonical}」仅大小写不一致`;
    case "term-width":
      return `「${hit.matched}」与「${hit.canonical}」仅全半角不一致`;
    default:
      return "";
  }
}

/**
 * 逐条比对术语在字幕中出现的位置。
 * 命中分五类（允许写法 / 漏译 / 译法不一致 / 大小写 / 全半角），
 * 同一位置重叠时按严重程度取最高优先级；允许写法整体覆盖其内部子串，避免误报。
 */
export function checkTerms(
  cues: SubtitleCue[],
  glossary: Glossary | null | undefined,
): { issues: SubtitleIssue[]; marks: TermMark[] } {
  if (!glossary || glossary.terms.length === 0)
    return { issues: [], marks: [] };
  const issues: SubtitleIssue[] = [];
  const marks: TermMark[] = [];
  let issueSeq = 0;
  for (const cue of cues) {
    const active = glossary.terms.filter((term) => inScope(term, cue));
    if (!active.length) continue;
    const chars = toChars(cue.text);
    const keyedChars = matchKey(cue.text);
    const candidates: Hit[] = [];
    for (const term of active) {
      const forms: Array<{ text: string; role: Role }> = [
        ...term.forbidden.map((text) => ({ text, role: "forbidden" as const })),
        { text: term.source, role: "source" as const },
        { text: term.preferred, role: "preferred" as const },
        ...term.allowed.map((text) => ({ text, role: "allowed" as const })),
      ];
      const seenKeys = new Set<string>();
      for (const form of forms) {
        if (!form.text) continue;
        const key = matchKey(form.text).join("");
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        for (const { start, end } of findAll(keyedChars, matchKey(form.text))) {
          const matched = chars.slice(start, end).join("");
          const { kind, priority, canonical } = classifyHit(matched, form);
          candidates.push({
            start,
            end,
            kind,
            matched,
            canonical,
            termId: term.id,
            source: term.source,
            preferred: term.preferred,
            priority,
          });
        }
      }
    }
    // 允许写法整体命中时，其内部子串不再单独报错
    const okSpans = candidates.filter((hit) => hit.kind === "term-ok");
    const protectedHits = candidates.filter(
      (hit) =>
        hit.kind === "term-ok" ||
        !okSpans.some(
          (ok) => ok.start <= hit.start && hit.end <= ok.end && ok !== hit,
        ),
    );
    protectedHits.sort(
      (a, b) => a.start - b.start || b.priority - a.priority || b.end - a.end,
    );
    const accepted: Hit[] = [];
    for (const hit of protectedHits) {
      if (accepted.some((ok) => hit.start < ok.end && ok.start < hit.end))
        continue;
      accepted.push(hit);
    }
    const deduped = new Set<string>();
    for (const hit of accepted) {
      marks.push({
        cueId: cue.id,
        termId: hit.termId,
        source: hit.source,
        start: hit.start,
        end: hit.end,
        matched: hit.matched,
        kind: hit.kind,
      });
      if (hit.kind === "term-ok") continue;
      const dedupeKey = `${hit.termId}|${hit.kind}|${hit.matched}`;
      if (deduped.has(dedupeKey)) continue;
      deduped.add(dedupeKey);
      issues.push({
        id: `${cue.id}-${hit.kind}-${issueSeq++}`,
        cueId: cue.id,
        type: hit.kind,
        severity:
          hit.kind === "term-case" || hit.kind === "term-width"
            ? "info"
            : "warning",
        message: messageFor(hit),
      });
    }
  }
  return { issues, marks };
}
