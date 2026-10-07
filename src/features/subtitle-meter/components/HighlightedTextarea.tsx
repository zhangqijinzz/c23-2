import { useLayoutEffect, useMemo, useRef, type ChangeEvent } from "react";
import type { GlossaryHit } from "../models";

const KIND_CLASS: Record<GlossaryHit["kind"], string> = {
  preferred: "term-ok",
  ok: "term-ok",
  variant: "term-variant",
  case: "term-case",
  width: "term-width",
  missing: "term-missing",
};

const KIND_LABEL: Record<GlossaryHit["kind"], string> = {
  preferred: "首选写法",
  ok: "允许写法",
  variant: "允许的其它写法",
  case: "大小写差异",
  width: "全半角差异",
  missing: "疑似漏译",
};

/**
 * 与 .edit-card textarea 保持一致的排版（字体、内边距由 CSS 类统一控制），
 * 只锁定换行、滚动与盒模型，避免高亮背板与输入文字错位。
 */
const SHARED_TEXT_STYLE: Record<string, string> = {
  fontFamily: "inherit",
  borderWidth: "1px",
  borderStyle: "solid",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  overflowWrap: "anywhere",
  margin: "0",
};

/**
 * 透明 textarea 叠加在带高亮的背板之上：背板不可见、不可交互，
 * 滚动时同步位移，保证编辑体验与普通 textarea 完全一致。
 */
export function HighlightedTextarea({
  value,
  hits,
  ariaLabel,
  rows,
  onChange,
}: {
  value: string;
  hits: GlossaryHit[];
  ariaLabel: string;
  rows: number;
  onChange: (value: string) => void;
}) {
  const backdropRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const segments = useMemo(() => {
    const parts = [...hits]
      .filter((hit) => hit.end <= value.length && hit.start < hit.end)
      .sort((a, b) => a.start - b.start);
    const pieces: Array<{ text: string } | { text: string; hit: GlossaryHit }> =
      [];
    let cursor = 0;
    for (const hit of parts) {
      if (hit.start < cursor) continue;
      if (hit.start > cursor)
        pieces.push({ text: value.slice(cursor, hit.start) });
      pieces.push({ text: value.slice(hit.start, hit.end), hit });
      cursor = hit.end;
    }
    if (cursor < value.length) pieces.push({ text: value.slice(cursor) });
    return pieces;
  }, [hits, value]);

  useLayoutEffect(() => {
    const textarea = textareaRef.current,
      backdrop = backdropRef.current;
    if (textarea && backdrop) backdrop.scrollTop = textarea.scrollTop;
  }, [value]);

  const syncScroll = () => {
    if (backdropRef.current && textareaRef.current)
      backdropRef.current.scrollTop = textareaRef.current.scrollTop;
  };

  return (
    <div className="highlight-edit">
      <div
        ref={backdropRef}
        className="highlight-backdrop"
        aria-hidden="true"
        style={SHARED_TEXT_STYLE}
      >
        {segments.map((segment, index) =>
          "hit" in segment ? (
            <mark
              key={index}
              className={`term-mark ${KIND_CLASS[segment.hit.kind]}`}
              title={`${KIND_LABEL[segment.hit.kind]}：${segment.hit.actual} → ${segment.hit.expected}`}
            >
              {segment.text}
            </mark>
          ) : (
            <span key={index}>{segment.text}</span>
          ),
        )}
        {"\n"}
      </div>
      <textarea
        ref={textareaRef}
        className="highlight-input"
        aria-label={ariaLabel}
        value={value}
        rows={rows}
        style={SHARED_TEXT_STYLE}
        onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
          onChange(event.target.value)
        }
        onScroll={syncScroll}
        spellCheck={false}
      />
    </div>
  );
}
