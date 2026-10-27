# Alert-only budget for the whole project: emails the billing account admins at
# 50%, 90% and 100% of actual spend, and when the month is forecast to exceed it.
#
# The hard $5 spend cap on Cloud Run is a separate budget created by
# infra/scripts/spend-cap.sh: the Google provider can't set spend caps yet (checked
# against hashicorp/google 8.8.1), and an alert budget can't be converted into one.
resource "google_billing_budget" "project" {
  billing_account = var.billing_account_id
  display_name    = "supportpilot-project-alerts"

  budget_filter {
    projects               = ["projects/${data.google_project.this.number}"]
    calendar_period        = "MONTH"
    credit_types_treatment = "INCLUDE_ALL_CREDITS"
  }

  amount {
    specified_amount {
      currency_code = var.budget_currency
      units         = tostring(var.budget_amount)
    }
  }

  threshold_rules {
    threshold_percent = 0.5
  }
  threshold_rules {
    threshold_percent = 0.9
  }
  threshold_rules {
    threshold_percent = 1.0
  }
  threshold_rules {
    threshold_percent = 1.0
    spend_basis       = "FORECASTED_SPEND"
  }

  depends_on = [google_project_service.this]
}
