import type {
  Glossary,
  GlossaryHit,
  GlossaryTerm,
  SubtitleCue,
  SubtitleIssue,
} from "../models";
import { scopeNote } from "./scopeFormat";

interface RawHit {
  termId: string;
  cueId: string;
  start: number;
  end: number;
  actual: string;
  expected: string;
  kind: GlossaryHit["kind"];
}

/** 折叠后的文本与逐字符到原文位置的映射（NFKC + 小写） */
interface Folded {
  text: string;
  map: number[];
}

/**
 * NFKC 归一化用于识别全半角差异（ＷｉＦｉ → WiFi、，→ ,），
 * 小写折叠用于识别大小写差异。映射表保证提示区间仍指向原始字符。
 */
function fold(value: string): Folded {
  const normalized = value.normalize("NFKC").toLowerCase();
  const text: string[] = [];
  const map: number[] = [];
  const chars = [...normalized];
  chars.forEach((_, i) => {
    // 归一化可能合并/拆分字符，按码位比例对齐到最近的原文位置；
    // 全/半角 ASCII 与常见标点均为 1:1，区间精确
    const approx = Math.min(
      value.length - 1,
      Math.round((i / Math.max(1, chars.length)) * value.length),
    );
    text.push(chars[i]);
    map.push(approx);
  });
  return { text: text.join(""), map };
}

/** 折叠单个候选写法，并保留其在原候选串中的起止偏移 */
function foldForm(form: string): string {
  return form.normalize("NFKC").toLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 是否为拉丁字母/数字（需要词边界保护，避免 art 命中 start） */
function isLatinWord(value: string): boolean {
  return /[A-Za-z0-9]/.test(value);
}

/** 构造匹配表达式：拉丁词条加词边界，中文等词条保持子串匹配 */
function patternFor(candidate: string): RegExp {
  const escaped = escapeRegExp(candidate);
  return isLatinWord(candidate)
    ? new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, "g")
    : new RegExp(escaped, "g");
}

/** 在一段文本中找出候选写法的全部不重叠区间（按最长、最左优先） */
function findSpans(
  haystack: string,
  candidates: string[],
): Array<{ start: number; end: number; candidate: string }> {
  const spans: Array<{ start: number; end: number; candidate: string }> = [];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const matcher = patternFor(candidate);
    let match: RegExpExecArray | null;
    while ((match = matcher.exec(haystack))) {
      if (match.index < 0) break;
      spans.push({
        start: match.index,
        end: match.index + candidate.length,
        candidate,
      });
      if (candidate.length === 1) matcher.lastIndex++;
    }
  }
  spans.sort((a, b) => a.start - b.start || b.end - a.end);
  const result: typeof spans = [];
  for (const span of spans) {
    const last = result[result.length - 1];
    if (last && span.start < last.end) {
      // 同一起点保留更长的写法
      if (span.start === last.start && span.end > last.end)
        result[result.length - 1] = span;
      continue;
    }
    result.push(span);
  }
  return result;
}

export function termApplies(term: GlossaryTerm, cue: SubtitleCue): boolean {
  const scope = term.scope;
  if (!scope) return true;
  if (scope.cueIndexes && !scope.cueIndexes.includes(cue.index)) return false;
  if (scope.startMs !== undefined && cue.endMs < scope.startMs) return false;
  if (scope.endMs !== undefined && cue.startMs > scope.endMs) return false;
  if (scope.keyword && !cue.text.includes(scope.keyword)) return false;
  return true;
}

interface TermForms {
  preferred: string;
  /** 除首选外的允许写法 */
  variants: string[];
  /** 源术语原样（用于判定漏译），即使它也是允许写法之一 */
  source: string;
  sourceIsAllowed: boolean;
}

function formsOf(term: GlossaryTerm): TermForms {
  const preferred =
    term.preferred && term.allowed.includes(term.preferred)
      ? term.preferred
      : term.allowed[0];
  return {
    preferred,
    variants: term.allowed.filter((form) => form !== preferred),
    source: term.source,
    sourceIsAllowed: term.allowed.includes(term.source),
  };
}

function rawHitsForTerm(
  term: GlossaryTerm,
  cue: SubtitleCue,
  folded: Folded,
): RawHit[] {
  if (!termApplies(term, cue)) return [];
  const { preferred, variants, source, sourceIsAllowed } = formsOf(term);
  const exactCandidates = [
    preferred,
    ...variants,
    // 源术语未被列入允许写法时，作为漏译单独识别
    ...(sourceIsAllowed ? [] : [source]),
  ];
  const text = cue.text;

  // 第一轮：精确匹配
  const exact = findSpans(text, exactCandidates);
  const occupied = new Set<number>();
  const hits: RawHit[] = [];
  for (const span of exact) {
    const actual = text.slice(span.start, span.end);
    let kind: RawHit["kind"];
    let expected: string;
    if (span.candidate === preferred) {
      kind = "preferred";
      expected = preferred;
    } else if (span.candidate === source && !sourceIsAllowed) {
      kind = "missing";
      expected = preferred;
    } else {
      kind = "variant";
      expected = span.candidate;
    }
    for (let i = span.start; i < span.end; i++) occupied.add(i);
    hits.push({
      termId: term.id,
      cueId: cue.id,
      start: span.start,
      end: span.end,
      actual,
      expected,
      kind,
    });
  }

  // 第二轮：折叠匹配，排除已被精确命中占用的区间（大小写 / 全半角差异）
  const foldedCandidates = [...new Set(exactCandidates.map(foldForm))];
  const loose = findSpans(folded.text, foldedCandidates);
  for (const span of loose) {
    const start = folded.map[span.start];
    const endIndex = Math.min(folded.map.length - 1, span.end - 1);
    const end = folded.map[endIndex] + 1;
    if (start === undefined || end <= start) continue;
    let overlap = false;
    for (let i = start; i < end; i++) {
      if (occupied.has(i)) {
        overlap = true;
        break;
      }
    }
    if (overlap) continue;
    const actual = text.slice(start, end);
    const matchedExact = exactCandidates.find(
      (form) => foldForm(form) === span.candidate,
    );
    const expectedForm = matchedExact ?? preferred;
    // 折叠匹配保证 NFKC(actual).小写 === NFKC(规范).小写：
    // 源术语原样命中且不在允许写法中 → 漏译；
    // 不做 NFKC、仅小写即与规范写法一致 → 大小写差异；
    // 否则差异来自全/半角字符（如 ＷｉＦｉ、全角逗号）→ 全半角差异。
    let kind: RawHit["kind"];
    if (!sourceIsAllowed && matchedExact === source) kind = "missing";
    else if (actual.toLowerCase() === expectedForm.toLowerCase()) kind = "case";
    else kind = "width";
    for (let i = start; i < end; i++) occupied.add(i);
    hits.push({
      termId: term.id,
      cueId: cue.id,
      start,
      end,
      actual,
      expected: kind === "missing" ? preferred : expectedForm,
      kind,
    });
  }
  return hits;
}

export interface GlossaryCheckResult {
  hits: GlossaryHit[];
  issues: SubtitleIssue[];
}

/** 逐条比对术语在字幕中的位置，区分漏译、大小写、全半角与译法不一致 */
export function checkGlossary(
  cues: SubtitleCue[],
  glossary: Glossary | null | undefined,
): GlossaryCheckResult {
  if (!glossary || glossary.terms.length === 0) return { hits: [], issues: [] };
  const rawHits: RawHit[] = [];
  // 每条字幕的折叠结果只计算一次，避免编辑时重复归一化
  const foldedByCue = new Map(
    cues.map((cue) => [cue.id, fold(cue.text)] as const),
  );
  for (const term of glossary.terms) {
    for (const cue of cues)
      rawHits.push(...rawHitsForTerm(term, cue, foldedByCue.get(cue.id)!));
  }
  rawHits.sort((a, b) => a.start - b.start || b.end - a.end);
  // 不同词条可能命中同一区间，保留最长的一条用于高亮
  const selected: RawHit[] = [];
  for (const hit of rawHits) {
    const clash = selected.find(
      (item) =>
        item.cueId === hit.cueId &&
        hit.start < item.end &&
        item.start < hit.end,
    );
    if (!clash) selected.push(hit);
    else if (hit.end - hit.start > clash.end - clash.start) {
      selected.splice(selected.indexOf(clash), 1, hit);
    }
  }
  const termById = new Map(glossary.terms.map((term) => [term.id, term]));
  const hits: GlossaryHit[] = selected.map((hit, index) => ({
    ...hit,
    id: `gloss-${index + 1}`,
  }));

  // 跨条目统计：首选写法与其它允许写法同时出现，即视为译法不一致
  const exactForms = new Map<string, Set<string>>();
  for (const hit of selected) {
    if (hit.kind === "variant" || hit.kind === "preferred") {
      const set = exactForms.get(hit.termId) ?? new Set<string>();
      set.add(hit.actual);
      exactForms.set(hit.termId, set);
    }
  }

  const issues: SubtitleIssue[] = [];
  for (const hit of selected) {
    const term = termById.get(hit.termId);
    if (!term) continue;
    const { preferred } = formsOf(term);
    const sceneNote = scopeNote(term);
    let type: SubtitleIssue["type"] | null = null;
    let severity: SubtitleIssue["severity"] = "warning";
    let message = "";
    if (hit.kind === "missing") {
      type = "glossary-missing";
      severity = "error";
      message = `术语「${term.source}」疑似漏译${sceneNote}：原文未译，建议译为「${preferred}」`;
    } else if (hit.kind === "width") {
      type = "glossary-width";
      severity = "warning";
      message = `术语「${term.source}」全半角不一致${sceneNote}：「${hit.actual}」→ 规范写法「${hit.expected}」`;
    } else if (hit.kind === "case") {
      type = "glossary-case";
      severity = "warning";
      message = `术语「${term.source}」大小写不一致${sceneNote}：「${hit.actual}」→ 规范写法「${hit.expected}」`;
    } else if (hit.kind === "variant") {
      const forms = exactForms.get(hit.termId);
      if (forms && forms.size > 1) {
        type = "glossary-inconsistent";
        severity = "info";
        message = `术语「${term.source}」存在多种译法${sceneNote}：当前「${hit.actual}」，首选「${preferred}」`;
      }
    }
    if (type)
      issues.push({
        id: `${hit.cueId}-${type}-${hit.start}-${issues.length}`,
        cueId: hit.cueId,
        type,
        severity,
        message,
        termId: hit.termId,
        span: { start: hit.start, end: hit.end },
      });
  }
  return { hits, issues };
}
