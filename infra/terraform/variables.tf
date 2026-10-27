variable "aws_account_id" {
  description = "The 12-digit AWS account that hosts the app. The provider refuses to touch any other account."
  type        = string

  validation {
    condition     = can(regex("^[0-9]{12}$", var.aws_account_id))
    error_message = "aws_account_id must be 12 digits."
  }
}

variable "region" {
  description = "AWS Region. ap-southeast-2 (Sydney) is the account's Free plan region and Neon's nearest (plan M8 R1, R2). The bootstrap policies use the same value."
  type        = string
  default     = "ap-southeast-2"
}

variable "github_repository" {
  description = "owner/name of the repository, used in the OIDC subject (AWS requires a subject check for GitHub)."
  type        = string
  default     = "HamayunKhan800/supportpilot"
}

variable "github_repository_id" {
  description = "Numeric ID of the repository. Unlike the name it never changes, so a look-alike repository can't match."
  type        = string
  default     = "1428261530"
}

variable "github_repository_owner_id" {
  description = "Numeric ID of the repository owner."
  type        = string
  default     = "345785392"
}

variable "image_tag" {
  description = <<-EOT
    Image tag in the ECR repository (sha-<commit>) used when the functions are first created.
    null = no image pushed yet: only the registry, roles and log groups are created (first apply).
    After the first create, deployments change the image and Terraform ignores this value;
    infra.yml passes the image the web function currently runs (infra/scripts/current-image.sh).
  EOT
  type        = string
  default     = null

  validation {
    condition     = var.image_tag == null || can(regex("^sha-[0-9a-f]{7,40}$", var.image_tag))
    error_message = "image_tag must look like sha-<git commit>."
  }
}

variable "ai_provider" {
  description = "gemini (live, free tier with daily caps) or mock (canned answers, for a first smoke test)."
  type        = string

  validation {
    condition     = contains(["mock", "gemini"], var.ai_provider)
    error_message = "ai_provider must be mock or gemini."
  }
}

variable "public_url" {
  description = "Public https origin once a custom domain exists (plan M8 step 6). null = the web function's own Function URL."
  type        = string
  default     = null

  validation {
    condition     = var.public_url == null || can(regex("^https://[a-z0-9.-]+$", var.public_url))
    error_message = "public_url must be an https origin without a path or trailing slash, e.g. https://app.example.com."
  }
}

variable "app_env" {
  description = <<-EOT
    Extra plain (non-secret) settings for both functions, e.g. AI_DAILY_CALL_LIMIT or EMAIL_FROM.
    Secrets never go here: they live in SSM Parameter Store (see the ssm_folders output).
  EOT
  type        = map(string)
  default     = {}

  validation {
    condition = alltrue([
      for k in keys(var.app_env) : !contains([
        "DATABASE_URL", "BETTER_AUTH_SECRET", "BETTER_AUTH_SECRETS", "DEMO_PASSWORD", "GEMINI_API_KEY",
        "RESEND_API_KEY", "EMAIL_OUTBOX_TOKEN", "GOOGLE_CLIENT_SECRET", "GITHUB_CLIENT_SECRET", "SENTRY_DSN",
      ], k)
    ])
    error_message = "app_env must not contain secrets; put them in SSM Parameter Store."
  }

  validation {
    condition = alltrue([
      for k in keys(var.app_env) : !startswith(k, "AWS_") && !contains([
        "NODE_ENV", "AI_PROVIDER", "BETTER_AUTH_URL", "SSM_PARAMETER_PATHS", "WORKER_FUNCTION_NAME", "ALLOW_DEMO_SEED",
      ], k)
    ])
    error_message = "app_env must not override settings Terraform manages (AWS_*, NODE_ENV, AI_PROVIDER, BETTER_AUTH_URL, SSM_PARAMETER_PATHS, WORKER_FUNCTION_NAME, ALLOW_DEMO_SEED)."
  }
}

variable "web_memory_mb" {
  description = "Web function memory. Lambda gives CPU in proportion; 1 GB keeps Next.js server rendering quick and stays well inside the free 400,000 GB-seconds a month for a rarely used demo."
  type        = number
  default     = 1024
}

variable "web_timeout_seconds" {
  description = "Longest web request (an AI draft or a 4 MB upload is far shorter)."
  type        = number
  default     = 60
}

variable "worker_memory_mb" {
  description = "Worker function memory (embedding and triage calls are mostly network waits)."
  type        = number
  default     = 1024
}

variable "worker_reserved_concurrency" {
  description = <<-EOT
    Cap on simultaneous worker runs. null = no cap. New accounts can have a total of only
    10 concurrent executions, and AWS keeps 10 unreserved, so reserving any is refused there
    (checked in step 4). pg-boss hands each job to one worker even when several run.
  EOT
  type        = number
  default     = null
}

variable "demo_reset_enabled" {
  description = "Run the nightly demo reset (00:05 America/Los_Angeles, just after Gemini's free quota resets; plan M8 R5)."
  type        = bool
  default     = true
}

variable "log_retention_days" {
  description = "How long function logs are kept."
  type        = number
  default     = 14
}
