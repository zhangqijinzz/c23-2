import type { ChangeEvent } from "react";
import type { Glossary } from "../models";
import type { SubtitleMeterViewModel } from "../viewmodels/subtitleMeterViewModel";

const scopeLabel = (ranges: Glossary["terms"][number]["ranges"]): string => {
  if (!ranges.length) return "全部条目";
  return ranges
    .map(({ from, to }) =>
      to === Number.POSITIVE_INFINITY
        ? `${from} 起`
        : to === from
          ? `#${from}`
          : `#${from}-${to}`,
    )
    .join(" ");
};

export function GlossaryModule({
  vm,
  glossary,
  disabled,
}: {
  vm: SubtitleMeterViewModel;
  glossary?: Glossary;
  disabled: boolean;
}) {
  const onFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) void vm.importGlossaryFile(file);
    event.target.value = "";
  };
  return (
    <section className="module glossary-module">
      <div className="module-head">
        <div>
          <span className="module-kicker">GLOSSARY · 随项目本地保存</span>
          <h2>
            术语表{" "}
            {glossary && (
              <span className="issue-count">{glossary.terms.length}</span>
            )}
          </h2>
        </div>
        {glossary && (
          <button
            className="secondary-button"
            onClick={() => void vm.clearGlossary()}
          >
            移除术语表
          </button>
        )}
      </div>
      <label
        className={`dropzone glossary-dropzone ${disabled ? "disabled" : ""}`}
      >
        <input
          aria-label="导入术语表 CSV 或 JSON 文件"
          type="file"
          accept=".csv,.tsv,.json,.txt"
          disabled={disabled}
          onChange={onFile}
        />
        <span className="upload-icon">≡</span>
        <strong>{glossary ? "替换术语表" : "导入术语表"}</strong>
        <span>CSV / JSON · 列：术语、标准译法、允许写法、弃用译法、场景</span>
      </label>
      {glossary ? (
        <>
          <div className="file-status">
            <span className="status-dot" />
            {glossary.fileName}
            <span className="file-size">
              {glossary.terms.length} 条 · 快照会一并保存
            </span>
          </div>
          <ul className="glossary-list">
            {glossary.terms.map((term) => (
              <li key={term.id} className="glossary-item">
                <div className="glossary-term">
                  <strong>{term.source}</strong>
                  <span className="glossary-arrow">→</span>
                  <strong className="glossary-preferred">
                    {term.preferred}
                  </strong>
                </div>
                <div className="glossary-tags">
                  {term.allowed.map((form) => (
                    <span className="term-tag allowed" key={form}>
                      允许 {form}
                    </span>
                  ))}
                  {term.forbidden.map((form) => (
                    <span className="term-tag forbidden" key={form}>
                      弃用 {form}
                    </span>
                  ))}
                  {term.ranges.length > 0 && (
                    <span className="term-tag scope">
                      仅 {scopeLabel(term.ranges)}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="glossary-hint">
          没有术语表时只做时间与节奏检查，和此前完全一致。允许多个写法用「|」分隔；场景列支持
          1-3、8、12- 这类条目序号。
        </p>
      )}
    </section>
  );
}
