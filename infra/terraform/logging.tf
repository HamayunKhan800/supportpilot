# Customer tracking links carry a secret token in the path: /t/{token} and
# /api/v1/portal/t/{token} (ADR-0012). Cloud Run's request log would record the full
# URL, so those request entries are not stored at all. The app's own logs never include
# the token. Trade-off: no per-request log lines for these two paths.
resource "google_logging_project_exclusion" "tracking_tokens" {
  name        = "exclude-tracking-token-urls"
  description = "Drop Cloud Run request logs whose URL contains a tracking-link token (ADR-0012, M8)."
  filter      = "log_id(\"run.googleapis.com/requests\") AND resource.type=\"cloud_run_revision\" AND httpRequest.requestUrl=~\"/t/[^/?#]+\""

  depends_on = [google_project_service.this]
}
