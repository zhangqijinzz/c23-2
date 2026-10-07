import type { GlossaryHit, SubtitleCue, SubtitleIssue } from "../models";
import type { SubtitleMeterViewModel } from "../viewmodels/subtitleMeterViewModel";
import { HighlightedTextarea } from "./HighlightedTextarea";

const TERM_TYPES = new Set<SubtitleIssue["type"]>([
  "glossary-missing",
  "glossary-inconsistent",
  "glossary-case",
  "glossary-width",
]);
const TERM_LABEL: Partial<Record<SubtitleIssue["type"], string>> = {
  "glossary-missing": "漏译",
  "glossary-inconsistent": "译法不一",
  "glossary-case": "大小写",
  "glossary-width": "全半角",
};

export function InspectionModule({
  cues,
  issues,
  glossaryHits,
  vm,
  selectedId,
}: {
  cues: SubtitleCue[];
  issues: SubtitleIssue[];
  glossaryHits: GlossaryHit[];
  vm: SubtitleMeterViewModel;
  selectedId: string | null;
}) {
  const selected = cues.find((cue) => cue.id === selectedId) ?? cues[0];
  const errors = issues.filter((issue) => issue.severity === "error").length;
  const warnings = issues.filter(
    (issue) => issue.severity === "warning",
  ).length;
  const termCount = issues.filter((issue) => TERM_TYPES.has(issue.type)).length;
  const cps = selected
    ? [...selected.text.replace(/\s/g, "")].length /
      Math.max(0.1, (selected.endMs - selected.startMs) / 1000)
    : 0;
  const selectedHits = selected
    ? glossaryHits.filter((hit) => hit.cueId === selected.id)
    : [];
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
          {termCount > 0 && (
            <span className="term-color">{termCount} 术语</span>
          )}
        </div>
      </div>
      <div className="issue-list">
        {issues.length ? (
          issues.map((issue) => (
            <button
              key={issue.id}
              className={`issue-row ${issue.severity} ${TERM_TYPES.has(issue.type) ? `term-row ${issue.type}` : ""}`}
              onClick={() => vm.selectCue(issue.cueId)}
            >
              <span className="issue-bullet">
                {issue.severity === "error" ? "!" : "·"}
              </span>
              <span className="issue-message">{issue.message}</span>
              {TERM_TYPES.has(issue.type) && (
                <span className="term-tag">
                  术语 · {TERM_LABEL[issue.type]}
                </span>
              )}
              <span className="issue-cue">
                #{cues.find((cue) => cue.id === issue.cueId)?.index}
              </span>
            </button>
          ))
        ) : (
          <div className="clear-state">✓ 当前未发现明显问题</div>
        )}
      </div>
      {selected && (
        <div className="edit-card">
          <div className="edit-title">
            <span>当前条目 · #{selected.index}</span>
            <span className={cps > 18 ? "warning-color" : ""}>
              {cps.toFixed(1)} 字/秒
            </span>
          </div>
          {selectedHits.length > 0 && (
            <div className="term-legend">
              <span>本条目术语命中：</span>
              {[...new Set(selectedHits.map((hit) => hit.kind))].map((kind) => (
                <span key={kind} className={`term-chip term-chip-${kind}`}>
                  {kind === "preferred"
                    ? "首选写法"
                    : kind === "variant"
                      ? "其它允许写法"
                      : kind === "missing"
                        ? "疑似漏译"
                        : kind === "case"
                          ? "大小写差异"
                          : kind === "width"
                            ? "全半角差异"
                            : "允许写法"}
                </span>
              ))}
            </div>
          )}
          <HighlightedTextarea
            ariaLabel="字幕文本"
            value={selected.text}
            hits={selectedHits}
            rows={Math.min(4, Math.max(2, selected.text.split("\n").length))}
            onChange={(text) => void vm.editCue(selected.id, { text })}
          />
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
