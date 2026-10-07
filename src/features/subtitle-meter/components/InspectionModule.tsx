import { useRef, type UIEvent } from "react";
import type { Glossary, SubtitleCue, SubtitleIssue, TermMark } from "../models";
import type { SubtitleMeterViewModel } from "../viewmodels/subtitleMeterViewModel";
import { isTermIssue, TermHighlightLayer, termTypeLabel } from "./termUi";

const MARK_LEGEND: Array<TermMark["kind"]> = [
  "term-missing",
  "term-inconsistent",
  "term-case",
  "term-width",
  "term-ok",
];
const MARK_TEXT: Record<TermMark["kind"], string> = {
  "term-missing": "漏译",
  "term-inconsistent": "译法不一致",
  "term-case": "大小写差异",
  "term-width": "全半角差异",
  "term-ok": "术语命中（符合）",
};

export function InspectionModule({
  cues,
  issues,
  termMarks,
  glossary,
  vm,
  selectedId,
}: {
  cues: SubtitleCue[];
  issues: SubtitleIssue[];
  termMarks: TermMark[];
  glossary?: Glossary;
  vm: SubtitleMeterViewModel;
  selectedId: string | null;
}) {
  const selected = cues.find((cue) => cue.id === selectedId) ?? cues[0];
  const errors = issues.filter((issue) => issue.severity === "error").length;
  const warnings = issues.filter(
    (issue) => issue.severity === "warning",
  ).length;
  const infos = issues.filter((issue) => issue.severity === "info").length;
  const cps = selected
    ? [...selected.text.replace(/\s/g, "")].length /
      Math.max(0.1, (selected.endMs - selected.startMs) / 1000)
    : 0;
  const selectedMarks = selected
    ? termMarks.filter((mark) => mark.cueId === selected.id)
    : [];
  const highlightRef = useRef<HTMLDivElement>(null);
  const syncHighlightScroll = (event: UIEvent<HTMLTextAreaElement>) => {
    const layer = highlightRef.current;
    if (layer) {
      layer.scrollTop = event.currentTarget.scrollTop;
      layer.scrollLeft = event.currentTarget.scrollLeft;
    }
  };
  return (
    <section className="module inspection-module">
      <div className="module-head">
        <div>
          <span className="module-kicker">03 / INSPECTION</span>
          <h2>
            问题检查 <span className="issue-count">{issues.length}</span>
          </h2>
        </div>
        <div className="issue-summary">
          <span className="error-color">{errors} 错误</span>
          <span className="warning-color">{warnings} 提醒</span>
          {infos > 0 && <span className="info-color">{infos} 提示</span>}
        </div>
      </div>
      <div className="issue-list">
        {issues.length ? (
          issues.map((issue) => (
            <button
              key={issue.id}
              className={`issue-row ${issue.severity} ${
                isTermIssue(issue.type) ? "term-issue" : ""
              }`}
              onClick={() => vm.selectCue(issue.cueId)}
            >
              <span className="issue-bullet">
                {issue.severity === "error" ? "!" : "·"}
              </span>
              {isTermIssue(issue.type) && (
                <span className={`issue-type-tag ${issue.type}`}>
                  {termTypeLabel(issue.type)}
                </span>
              )}
              <span>{issue.message}</span>
              <span className="issue-cue">
                #{cues.find((cue) => cue.id === issue.cueId)?.index}
              </span>
            </button>
          ))
        ) : (
          <div className="clear-state">✓ 当前未发现明显问题</div>
        )}
      </div>
      {glossary && (
        <div className="term-legend">
          {MARK_LEGEND.map((kind) => (
            <span key={kind} className="term-legend-item">
              <i className={kind} />
              {MARK_TEXT[kind]}
            </span>
          ))}
        </div>
      )}
      {selected && (
        <div className="edit-card">
          <div className="edit-title">
            <span>当前条目 · #{selected.index}</span>
            <span className={cps > 18 ? "warning-color" : ""}>
              {cps.toFixed(1)} 字/秒
            </span>
          </div>
          <div
            className={`term-edit-wrap ${selectedMarks.length ? "has-marks" : ""}`}
            key={selected.id}
          >
            {selectedMarks.length > 0 && (
              <TermHighlightLayer
                ref={highlightRef}
                text={selected.text}
                marks={selectedMarks}
              />
            )}
            <textarea
              aria-label="字幕文本"
              value={selected.text}
              spellCheck={false}
              onScroll={syncHighlightScroll}
              onChange={(e) =>
                void vm.editCue(selected.id, { text: e.target.value })
              }
              rows={Math.min(4, Math.max(2, selected.text.split("\n").length))}
            />
          </div>
          {selectedMarks.length > 0 && (
            <ul className="term-hit-list">
              {selectedMarks.map((mark, index) => (
                <li key={`${mark.termId}-${mark.start}-${index}`}>
                  <span className={`issue-type-tag ${mark.kind}`}>
                    {MARK_TEXT[mark.kind]}
                  </span>
                  「{mark.source}」→ 命中「{mark.matched}」
                </li>
              ))}
            </ul>
          )}
          <div className="time-edit">
            <label>
              开始
              <input
                aria-label="开始时间毫秒"
                type="number"
                min="0"
                step="100"
                value={selected.startMs}
                onChange={(e) =>
                  void vm.editCue(selected.id, {
                    startMs: Number(e.target.value),
                  })
                }
              />
            </label>
            <span>→</span>
            <label>
              结束
              <input
                aria-label="结束时间毫秒"
                type="number"
                min="0"
                step="100"
                value={selected.endMs}
                onChange={(e) =>
                  void vm.editCue(selected.id, {
                    endMs: Number(e.target.value),
                  })
                }
              />
            </label>
          </div>
        </div>
      )}
    </section>
  );
}
