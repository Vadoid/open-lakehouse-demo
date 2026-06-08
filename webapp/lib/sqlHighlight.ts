// Lightweight SQL syntax highlighter shared by SqlPanel (the editable Spark
// console) and StreamDdl (the read-only Flink DDL panel). Emits .sql-* spans
// styled in globals.css. Order matters: escape HTML first, then comments,
// strings, numbers, keywords.
export const KEYWORDS = /\b(SELECT|FROM|WHERE|GROUP BY|ORDER BY|LIMIT|INSERT INTO|UPDATE|DELETE|CREATE|DROP|TABLE|NAMESPACE|IF NOT EXISTS|IF EXISTS|USING|PARTITIONED BY|TBLPROPERTIES|ALTER|ADD COLUMN|AS|CALL|SET|AND|OR|UNION ALL|UNION|CAST|CASE|WHEN|THEN|ELSE|END|TIMESTAMP|BIGINT|STRING|DOUBLE|INT|BOOLEAN)\b/g;

export function highlight(sql: string) {
  return sql
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/--.*$/gm, (m) => `<span class="sql-comment">${m}</span>`)
    .replace(/'([^']*)'/g, `<span class="sql-string">'$1'</span>`)
    .replace(/\b(\d+(?:\.\d+)?)\b/g, `<span class="sql-number">$1</span>`)
    .replace(KEYWORDS, `<span class="sql-keyword">$1</span>`);
}
