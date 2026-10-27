variable "project_id" {
  description = "Google Cloud project that hosts the app (billing enabled). Not the Gemini key's project, which stays without billing (plan M8 D10)."
  type        = string
}

variable "region" {
  description = "Cloud Run region. europe-west1 supports domain mapping and Tier 1 pricing (plan M8 D1)."
  type        = string
  default     = "europe-west1"
}

variable "billing_account_id" {
  description = "Cloud Billing account ID (XXXXXX-XXXXXX-XXXXXX), for the budget alert."
  type        = string
}

variable "budget_amount" {
  description = "Monthly alert budget for the whole project, in the billing account's currency (plan M8 D11)."
  type        = number
  default     = 5
}

variable "budget_currency" {
  description = "Currency of the billing account, e.g. USD or PKR. Must match the account."
  type        = string
  default     = "USD"
}

variable "github_repository_id" {
  description = "Numeric ID of the GitHub repository allowed to deploy (immutable, unlike its name)."
  type        = string
  default     = "1428261530"
}

variable "github_repository_owner_id" {
  description = "Numeric ID of the repository owner."
  type        = string
  default     = "345785392"
}

variable "github_repository" {
  description = "owner/name of the repository, used in the OIDC subject of production deploys."
  type        = string
  default     = "HamayunKhan800/supportpilot"
}

variable "image" {
  description = "Container image for the first create only. Afterwards GitHub Actions deploys new images and Terraform ignores the field."
  type        = string
}

variable "environments" {
  description = "One Cloud Run service per environment (plan M8 D2, step 4)."
  type = map(object({
    service_name = string
    # null = the service's own run.app address.
    custom_domain       = optional(string)
    ai_provider         = string
    min_instances       = optional(number, 0)
    max_instances       = optional(number, 2)
    deletion_protection = optional(bool, true)
    # Plain settings (never secrets). Merged over the defaults in run.tf.
    env = optional(map(string), {})
    # Secret Manager entries this environment reads, beyond the required ones.
    # Allowed: GEMINI_API_KEY, RESEND_API_KEY, EMAIL_OUTBOX_TOKEN, GOOGLE_CLIENT_SECRET, GITHUB_CLIENT_SECRET, SENTRY_DSN.
    optional_secrets = optional(list(string), [])
  }))

  validation {
    condition = alltrue([
      for e in values(var.environments) : alltrue([
        for s in e.optional_secrets : contains(["GEMINI_API_KEY", "RESEND_API_KEY", "EMAIL_OUTBOX_TOKEN", "GOOGLE_CLIENT_SECRET", "GITHUB_CLIENT_SECRET", "SENTRY_DSN"], s)
      ])
    ])
    error_message = "optional_secrets may only list GEMINI_API_KEY, RESEND_API_KEY, EMAIL_OUTBOX_TOKEN, GOOGLE_CLIENT_SECRET, GITHUB_CLIENT_SECRET or SENTRY_DSN."
  }

  validation {
    condition     = alltrue([for e in values(var.environments) : contains(["mock", "gemini"], e.ai_provider)])
    error_message = "ai_provider must be mock or gemini."
  }

  validation {
    condition     = alltrue([for e in values(var.environments) : e.ai_provider != "gemini" || contains(e.optional_secrets, "GEMINI_API_KEY")])
    error_message = "An environment with ai_provider = gemini must list GEMINI_API_KEY in optional_secrets."
  }
}
