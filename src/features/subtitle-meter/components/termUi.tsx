import { forwardRef } from "react";
import type { IssueType, TermMark } from "../models";

const TERM_TYPE_LABEL: Partial<Record<IssueType, string>> = {
  "term-missing": "漏译",
  "term-inconsistent": "译法不一致",
  "term-case": "大小写",
  "term-width": "全半角",
};

export function termTypeLabel(type: IssueType): string {
  return TERM_TYPE_LABEL[type] ?? "";
}

export function isTermIssue(type: IssueType): boolean {
  return type.startsWith("term-");
}

/** 把基于码点的 start/end 转成 textarea 使用的 UTF-16 偏移 */
function toUtf16(text: string, codePointOffset: number): number {
  const chars = Array.from(text);
  let units = 0;
  for (let i = 0; i < codePointOffset && i < chars.length; i++)
    units += chars[i].length;
  return units;
}

/** 把术语命中标记渲染为覆盖在 textarea 上的高亮层；ref 指向层本身用于滚动同步 */
export const TermHighlightLayer = forwardRef<
  HTMLDivElement,
  { text: string; marks: TermMark[] }
>(function TermHighlightLayer({ text, marks }, ref) {
  const ranges = marks
    .map((mark) => ({
      start: toUtf16(text, mark.start),
      end: toUtf16(text, mark.end),
      kind: mark.kind,
    }))
    .sort((a, b) => a.start - b.start || b.end - a.end);
  const segments: Array<{ text: string; kind: TermMark["kind"] | null }> = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start < cursor) continue;
    if (range.start > cursor)
      segments.push({ text: text.slice(cursor, range.start), kind: null });
    segments.push({
      text: text.slice(range.start, range.end),
      kind: range.kind,
    });
    cursor = range.end;
  }
  if (cursor < text.length)
    segments.push({ text: text.slice(cursor), kind: null });
  return (
    <div className="term-highlight-layer" aria-hidden="true" ref={ref}>
      {segments.map((segment, index) =>
        segment.kind ? (
          <mark className={`term-mark ${segment.kind}`} key={index}>
            {segment.text}
          </mark>
        ) : (
          <span key={index}>{segment.text || "​"}</span>
        ),
      )}
      {"\n"}
    </div>
  );
});
