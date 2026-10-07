import { useState, type ChangeEvent } from "react";
import type { Glossary } from "../models";
import type { SubtitleMeterViewModel } from "../viewmodels/subtitleMeterViewModel";

const FORMAT_HINT =
  "CSV / TSV，首行表头：源术语, 允许写法（多个用 ；分隔）, 首选写法（可空）, 场景（可空）";

export function GlossaryModule({
  vm,
  glossary,
}: {
  vm: SubtitleMeterViewModel;
  glossary?: Glossary | null;
}) {
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const onFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy(true);
    setError("");
    setWarnings([]);
    void vm
      .importGlossary(file)
      .then((rows) => setWarnings(rows))
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : "术语表导入失败"),
      )
      .finally(() => setBusy(false));
  };

  return (
    <section className="module glossary-module">
      <div className="module-head">
        <div>
          <span className="module-kicker">GLOSSARY · 术语表</span>
          <h2>
            术语表{" "}
            {glossary && glossary.terms.length > 0 && (
              <span className="issue-count">{glossary.terms.length}</span>
            )}
          </h2>
        </div>
        {glossary && glossary.terms.length > 0 && (
          <button
            className="secondary-button subtle"
            onClick={() => {
              setWarnings([]);
              setError("");
              void vm.removeGlossary();
            }}
          >
            移除术语表
          </button>
        )}
      </div>

      {!glossary || glossary.terms.length === 0 ? (
        <>
          <label className="dropzone glossary-dropzone">
            <input
              aria-label="导入术语表 CSV 或 JSON 文件"
              type="file"
              accept=".csv,.tsv,.txt,.json"
              disabled={busy}
              onChange={onFile}
            />
            <span className="upload-icon">词</span>
            <strong>{busy ? "正在解析…" : "导入术语表"}</strong>
            <span>{FORMAT_HINT}</span>
          </label>
          <p className="glossary-format-hint">
            也支持 JSON（数组或 {"{ terms: [] }"}）；「场景」可写条目范围
            （1-12）、时间窗（00:10-01:30）或关键词，多个条件用分号组合。
          </p>
        </>
      ) : (
        <div className="glossary-status">
          <div className="glossary-status-head">
            <span className="status-dot" />
            <strong>{glossary.terms.length} 条术语随项目保存在本机</strong>
            <label className="glossary-replace">
              替换
              <input
                aria-label="替换术语表"
                type="file"
                accept=".csv,.tsv,.txt,.json"
                onChange={onFile}
              />
            </label>
          </div>
          <ul className="glossary-term-list">
            {glossary.terms.slice(0, 6).map((term) => (
              <li key={term.id}>
                <span className="glossary-term-source">{term.source}</span>
                <span className="glossary-term-arrow">→</span>
                <span className="glossary-term-allowed">
                  {term.allowed.join("；")}
                </span>
                {term.scope && (
                  <span className="glossary-term-scope">限定场景</span>
                )}
              </li>
            ))}
            {glossary.terms.length > 6 && (
              <li className="glossary-term-more">
                另有 {glossary.terms.length - 6} 条，将在「问题检查」中逐条比对
              </li>
            )}
          </ul>
        </div>
      )}

      {error && (
        <div className="notice error" role="status">
          {error}
        </div>
      )}
      {warnings.length > 0 && (
        <ul className="glossary-warnings" role="status">
          {warnings.map((warning, index) => (
            <li key={index}>{warning}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
