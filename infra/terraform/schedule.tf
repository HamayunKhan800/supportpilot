# Nightly demo reset (plan M8 R5): 00:05 in Los Angeles, just after Gemini's free daily quota
# resets at midnight Pacific. Daylight saving is handled by the time zone (12:05 or 13:05 PKT).
# It runs inside AWS, so the database password never needs to be in GitHub.
resource "aws_scheduler_schedule" "demo_reset" {
  count = local.deployed && var.demo_reset_enabled ? 1 : 0

  name                         = "supportpilot-demo-reset"
  description                  = "Rebuild the demo workspace and index its help centre."
  schedule_expression          = "cron(5 0 * * ? *)"
  schedule_expression_timezone = "America/Los_Angeles"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_lambda_alias.worker[0].arn
    role_arn = aws_iam_role.scheduler.arn
    input    = jsonencode({ task = "seed-reset" })

    # Delivery retries only; Lambda's own async retry (event invoke config) covers failures.
    retry_policy {
      maximum_retry_attempts       = 2
      maximum_event_age_in_seconds = 3600
    }
  }
}
