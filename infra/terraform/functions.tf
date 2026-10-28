# Two Lambda functions from one image (plan M8 R3, R4; ADR-0008):
#   web     Next.js behind the Lambda Web Adapter, public through a streaming Function URL
#   worker  drains the pg-boss queue when woken, and runs `migrate` and `seed-reset` events
# Each has a `live` alias. Traffic, the wake-up call and the schedule all go to `live`, so a
# rollback is one alias update (plan M8 step 5).
#
# Deployments (GitHub Actions) change the image; Terraform ignores it after the first create.
# Terraform changes to settings publish a new version from the image already running and move
# `live` to it. So after a rollback, the next `terraform apply` moves `live` forward again:
# fix forward before changing infrastructure (infra/README.md, "Rollback").

resource "aws_cloudwatch_log_group" "function" {
  for_each = local.function_name

  name              = "/aws/lambda/${each.value}"
  retention_in_days = var.log_retention_days
}

locals {
  common_env = merge({
    AI_PROVIDER        = var.ai_provider
    LOG_LEVEL          = "info"
    SENTRY_ENVIRONMENT = "production"
    # Each warm instance holds its own pool. Small pools keep Neon's pooler comfortable.
    DATABASE_POOL_MAX = "3"
    # Lambda gives 2 s after SIGTERM; the worker's own deadline handling stops it earlier.
    WORKER_SHUTDOWN_TIMEOUT_MS = "8000"
    # Off until step 4 checks that the Function URL overwrites X-Forwarded-For rather than
    # passing on what the visitor sent (src/server/platform/env.ts).
    TRUST_PROXY_HEADERS = "false"
  }, var.app_env)

  web_env = merge(local.common_env, {
    SSM_PARAMETER_PATHS  = join(",", local.ssm_paths.web)
    WORKER_FUNCTION_NAME = "${local.function_name.worker}:${local.alias_name}"
    # Lambda Web Adapter (v1.1.0): forward requests to Next.js on 3000, wait for health first,
    # and stream responses through the Function URL.
    AWS_LWA_PORT                 = "3000"
    AWS_LWA_READINESS_CHECK_PATH = "/api/health"
    AWS_LWA_INVOKE_MODE          = "response_stream"
  })

  worker_env = merge(local.common_env, {
    SSM_PARAMETER_PATHS = join(",", local.ssm_paths.worker)
    # The nightly seed-reset rebuilds the demo workspace (scripts/seed-demo.ts refuses without it).
    ALLOW_DEMO_SEED = "true"
    # Events arrive as POST /events on 8080 (scripts/lib/lambda-jobs.ts). A 5xx answer marks
    # the invocation failed, so Lambda's retry and error metrics see it.
    AWS_LWA_PORT                 = "8080"
    AWS_LWA_PASS_THROUGH_PATH    = "/events"
    AWS_LWA_READINESS_CHECK_PATH = "/healthz"
    AWS_LWA_ERROR_STATUS_CODES   = "500-599"
  })
}

# ---- web ------------------------------------------------------------------------------

resource "aws_lambda_function" "web" {
  count = local.deployed ? 1 : 0

  function_name = local.function_name.web
  description   = "SupportPilot web app (Next.js, Lambda Web Adapter)."
  role          = aws_iam_role.function["web"].arn
  package_type  = "Image"
  image_uri     = local.image_uri
  architectures = ["arm64"]
  memory_size   = var.web_memory_mb
  timeout       = var.web_timeout_seconds
  publish       = true

  image_config {
    command = ["node", ".build/start.mjs", "web"]
  }

  environment {
    variables = local.web_env
  }

  logging_config {
    log_format = "Text"
    log_group  = aws_cloudwatch_log_group.function["web"].name
  }

  lifecycle {
    ignore_changes = [image_uri]
  }

  depends_on = [aws_iam_role_policy.function, aws_ecr_repository_policy.app]
}

resource "aws_lambda_alias" "web" {
  count = local.deployed ? 1 : 0

  name             = local.alias_name
  description      = "The version that serves visitors."
  function_name    = aws_lambda_function.web[0].function_name
  function_version = aws_lambda_function.web[0].version
}

# Public address. Lambda Function URLs can't take a custom domain; step 6 puts CloudFront in
# front (plan M8 R10).
resource "aws_lambda_function_url" "web" {
  count = local.deployed ? 1 : 0

  function_name      = aws_lambda_function.web[0].function_name
  qualifier          = aws_lambda_alias.web[0].name
  authorization_type = "NONE"
  invoke_mode        = "RESPONSE_STREAM"
}

# A public URL needs both grants since October 2025. The second is limited to calls that come
# through the URL, so it does not open the function to direct Invoke calls.
resource "aws_lambda_permission" "web_url" {
  count = local.deployed ? 1 : 0

  statement_id           = "PublicFunctionUrl"
  action                 = "lambda:InvokeFunctionUrl"
  function_name          = aws_lambda_function.web[0].function_name
  qualifier              = aws_lambda_alias.web[0].name
  principal              = "*"
  function_url_auth_type = "NONE"
}

resource "aws_lambda_permission" "web_url_invoke" {
  count = local.deployed ? 1 : 0

  statement_id             = "PublicFunctionUrlInvoke"
  action                   = "lambda:InvokeFunction"
  function_name            = aws_lambda_function.web[0].function_name
  qualifier                = aws_lambda_alias.web[0].name
  principal                = "*"
  invoked_via_function_url = true
}

# ---- worker ---------------------------------------------------------------------------

resource "aws_lambda_function" "worker" {
  count = local.deployed ? 1 : 0

  function_name = local.function_name.worker
  description   = "SupportPilot jobs: drain the queue, migrate, nightly demo reset."
  role          = aws_iam_role.function["worker"].arn
  package_type  = "Image"
  image_uri     = local.image_uri
  architectures = ["arm64"]
  memory_size   = var.worker_memory_mb
  # Lambda's maximum. A drain stops 45 s before its deadline (scripts/lib/lambda-tasks.ts).
  timeout                        = 900
  publish                        = true
  reserved_concurrent_executions = var.worker_reserved_concurrency

  image_config {
    command = ["node", ".build/start.mjs", "jobs"]
  }

  environment {
    variables = local.worker_env
  }

  logging_config {
    log_format = "Text"
    log_group  = aws_cloudwatch_log_group.function["worker"].name
  }

  lifecycle {
    ignore_changes = [image_uri]
  }

  depends_on = [aws_iam_role_policy.function, aws_ecr_repository_policy.app]
}

resource "aws_lambda_alias" "worker" {
  count = local.deployed ? 1 : 0

  name             = local.alias_name
  description      = "The version that runs jobs."
  function_name    = aws_lambda_function.worker[0].function_name
  function_version = aws_lambda_function.worker[0].version
}

# ---- rollback target ---------------------------------------------------------------------

# `previous` marks the version that was live before the last release (plan M8 step 5).
# release.sh moves it to the outgoing `live` version; rollback.sh swaps the two aliases, so a
# second rollback rolls forward again. Terraform only creates it: after that the scripts own
# its version, so Terraform ignores changes to it.
resource "aws_lambda_alias" "previous" {
  for_each = local.deployed ? local.function_name : {}

  name          = local.previous_alias_name
  description   = "The version live before the last release (rollback target)."
  function_name = each.value
  function_version = (each.key == "web"
    ? aws_lambda_function.web[0].version
    : aws_lambda_function.worker[0].version
  )

  lifecycle {
    ignore_changes = [function_version]
  }
}

# Wake-ups and the schedule invoke asynchronously. One retry covers a passing failure; jobs
# left in the queue are picked up by the next wake-up anyway.
resource "aws_lambda_function_event_invoke_config" "worker" {
  count = local.deployed ? 1 : 0

  function_name                = aws_lambda_function.worker[0].function_name
  qualifier                    = aws_lambda_alias.worker[0].name
  maximum_retry_attempts       = 1
  maximum_event_age_in_seconds = 3600
}
