export function jobLogFailureDetail(row) {
  const parts = [];
  const detail = String(row?.error_detail || "").trim();
  const err = String(row?.error || "").trim();
  const last = String(row?.last_error || "").trim();
  if (detail) parts.push(detail);
  if (err && err !== detail) parts.push(err);
  if (last && last !== detail && last !== err) parts.push(last);
  return parts.join("\n\n") || "No failure reason was stored.";
}
