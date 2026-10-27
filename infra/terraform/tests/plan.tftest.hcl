# Offline checks of the configuration's logic: `terraform test` with a mocked AWS provider,
# so no credentials or cloud calls are needed (runs in CI, job `infra`). With a mocked
# provider, "apply" creates nothing real; it only fills in computed values.

mock_provider "aws" {
  # Realistic ARNs where the provider checks their shape.
  mock_resource "aws_iam_role" {
    defaults = {
      arn = "arn:aws:iam::111122223333:role/supportpilot/mock"
    }
  }
  mock_resource "aws_cloudwatch_log_group" {
    defaults = {
      arn = "arn:aws:logs:ap-southeast-2:111122223333:log-group:/aws/lambda/mock"
    }
  }
  mock_resource "aws_lambda_alias" {
    defaults = {
      arn = "arn:aws:lambda:ap-southeast-2:111122223333:function:supportpilot-mock:live"
    }
  }
}

override_resource {
  target = aws_ecr_repository.app
  values = {
    arn            = "arn:aws:ecr:ap-southeast-2:111122223333:repository/supportpilot"
    repository_url = "111122223333.dkr.ecr.ap-southeast-2.amazonaws.com/supportpilot"
  }
}

override_resource {
  target = aws_lambda_function_url.web
  values = {
    function_url = "https://abc123example.lambda-url.ap-southeast-2.on.aws/"
  }
}

override_resource {
  target = aws_lambda_alias.worker
  values = {
    arn = "arn:aws:lambda:ap-southeast-2:111122223333:function:supportpilot-worker:live"
  }
}

variables {
  aws_account_id = "111122223333"
  ai_provider    = "mock"
}

# ---- first apply: nothing pushed yet ------------------------------------------------

run "first_apply_creates_registry_and_roles_only" {
  command = apply

  assert {
    condition     = output.functions_created == false && length(aws_lambda_function.web) == 0 && length(aws_lambda_function.worker) == 0
    error_message = "Without an image, no function may be created (Lambda needs the image to exist)."
  }

  assert {
    condition     = length(aws_scheduler_schedule.demo_reset) == 0 && length(aws_ssm_parameter.better_auth_url) == 0
    error_message = "The schedule and the address setting need the functions."
  }

  assert {
    condition     = aws_ecr_repository.app.image_tag_mutability == "IMMUTABLE" && aws_ecr_repository.app.image_scanning_configuration[0].scan_on_push
    error_message = "Image tags must be immutable and scanned on push."
  }

  assert {
    condition     = alltrue([for r in concat(values(aws_iam_role.function), [aws_iam_role.scheduler, aws_iam_role.deploy]) : r.permissions_boundary == "arn:aws:iam::111122223333:policy/supportpilot-boundary" && r.path == "/supportpilot/"])
    error_message = "Every role must carry the bootstrap boundary and live under /supportpilot/ (the infra role can't create others)."
  }

  assert {
    condition     = alltrue([for g in values(aws_cloudwatch_log_group.function) : g.retention_in_days == 14])
    error_message = "Logs are kept 14 days."
  }

  # The lifecycle rules keep the live image plus two to roll back to.
  assert {
    condition     = jsondecode(aws_ecr_lifecycle_policy.app.policy).rules[1].selection.countNumber == 3
    error_message = "The registry keeps the 3 newest images."
  }
}

run "deploy_role_trusts_only_the_production_environment_of_this_repository" {
  command = plan

  assert {
    condition = jsondecode(aws_iam_role.deploy.assume_role_policy).Statement[0].Condition.StringEquals == {
      "token.actions.githubusercontent.com:aud"                 = "sts.amazonaws.com"
      "token.actions.githubusercontent.com:sub"                 = "repo:HamayunKhan800/supportpilot:environment:production"
      "token.actions.githubusercontent.com:environment"         = "production"
      "token.actions.githubusercontent.com:repository_id"       = "1428261530"
      "token.actions.githubusercontent.com:repository_owner_id" = "345785392"
    }
    error_message = "The deploy role must check audience, subject, environment and both numeric IDs."
  }

  assert {
    condition     = jsondecode(aws_iam_role.deploy.assume_role_policy).Statement[0].Principal.Federated == "arn:aws:iam::111122223333:oidc-provider/token.actions.githubusercontent.com"
    error_message = "Only GitHub's OIDC provider may assume the deploy role."
  }

  # Only sign-in uses "*"; everything else names this app's repository and functions.
  assert {
    condition = alltrue([
      for s in jsondecode(aws_iam_role_policy.deploy.policy).Statement :
      s.Sid == "RegistrySignIn" ? s.Action == "ecr:GetAuthorizationToken" : alltrue([
        for r in flatten([s.Resource]) : startswith(r, "arn:aws:lambda:ap-southeast-2:111122223333:function:supportpilot-") || r == "arn:aws:ecr:ap-southeast-2:111122223333:repository/supportpilot"
      ])
    ])
    error_message = "The deploy role may only touch the supportpilot repository and functions."
  }

  assert {
    condition     = !strcontains(aws_iam_role_policy.deploy.policy, "ssm:") && !strcontains(aws_iam_role_policy.deploy.policy, "iam:")
    error_message = "The deploy role must not read secrets or change IAM."
  }

  assert {
    condition     = jsondecode(aws_iam_role.scheduler.assume_role_policy).Statement[0].Condition.StringEquals["aws:SourceAccount"] == "111122223333"
    error_message = "The scheduler role must only be usable from this account."
  }
}

run "function_roles_read_only_their_own_settings" {
  command = plan

  # The worker never gets the web folder (auth secrets) and can't invoke anything.
  assert {
    condition = (
      !strcontains(aws_iam_role_policy.function["worker"].policy, "/production/web")
      && !strcontains(aws_iam_role_policy.function["worker"].policy, "lambda:")
      && strcontains(aws_iam_role_policy.function["worker"].policy, "parameter/supportpilot/production/worker/*")
    )
    error_message = "The worker reads shared, worker and settings only, and invokes nothing."
  }

  assert {
    condition = (
      !strcontains(aws_iam_role_policy.function["web"].policy, "/production/worker")
      && [for s in jsondecode(aws_iam_role_policy.function["web"].policy).Statement : s.Resource if s.Sid == "WakeWorker"] == ["arn:aws:lambda:ap-southeast-2:111122223333:function:supportpilot-worker:live"]
    )
    error_message = "The web function reads its own folders and may only invoke the worker's live alias."
  }
}

# ---- second apply: an image exists ---------------------------------------------------

run "functions_are_created_once_an_image_exists" {
  command = apply

  variables {
    image_tag = "sha-0123456789abcdef0123456789abcdef01234567"
  }

  assert {
    condition     = aws_lambda_function.web[0].image_uri == "111122223333.dkr.ecr.ap-southeast-2.amazonaws.com/supportpilot:sha-0123456789abcdef0123456789abcdef01234567" && aws_lambda_function.worker[0].image_uri == aws_lambda_function.web[0].image_uri
    error_message = "Both functions run the same image from the app's registry (ADR-0008)."
  }

  assert {
    condition     = aws_lambda_function.web[0].architectures == tolist(["arm64"]) && aws_lambda_function.worker[0].architectures == tolist(["arm64"])
    error_message = "The functions run on Arm (Graviton), the cheaper Lambda architecture."
  }

  assert {
    condition     = aws_lambda_function.web[0].image_config[0].command == tolist(["node", ".build/start.mjs", "web"]) && aws_lambda_function.worker[0].image_config[0].command == tolist(["node", ".build/start.mjs", "jobs"])
    error_message = "The launcher modes must be web and jobs (scripts/start-container.ts)."
  }

  assert {
    condition     = aws_lambda_function.worker[0].timeout == 900 && aws_lambda_function.web[0].publish && aws_lambda_function.worker[0].publish
    error_message = "The worker gets Lambda's 15-minute maximum; both publish versions for the live alias."
  }

  assert {
    condition = (
      aws_lambda_function_url.web[0].qualifier == "live"
      && aws_lambda_function_url.web[0].invoke_mode == "RESPONSE_STREAM"
      && aws_lambda_function_url.web[0].authorization_type == "NONE"
    )
    error_message = "The public URL must serve the live alias with streaming."
  }

  assert {
    condition = (
      aws_lambda_permission.web_url[0].action == "lambda:InvokeFunctionUrl"
      && aws_lambda_permission.web_url[0].function_url_auth_type == "NONE"
      && aws_lambda_permission.web_url_invoke[0].action == "lambda:InvokeFunction"
      && aws_lambda_permission.web_url_invoke[0].invoked_via_function_url
      && aws_lambda_permission.web_url[0].qualifier == "live"
      && aws_lambda_permission.web_url_invoke[0].qualifier == "live"
    )
    error_message = "A public Function URL needs both grants (since October 2025), the second only through the URL."
  }

  assert {
    condition = (
      aws_lambda_function.web[0].environment[0].variables.WORKER_FUNCTION_NAME == "supportpilot-worker:live"
      && aws_lambda_function.web[0].environment[0].variables.SSM_PARAMETER_PATHS == "/supportpilot/production/shared/,/supportpilot/production/web/,/supportpilot/production/settings/"
      && aws_lambda_function.web[0].environment[0].variables.AWS_LWA_INVOKE_MODE == "response_stream"
      && aws_lambda_function.web[0].environment[0].variables.AWS_LWA_READINESS_CHECK_PATH == "/api/health"
    )
    error_message = "Web settings: worker alias, its SSM folders, streaming and the health check."
  }

  assert {
    condition = (
      aws_lambda_function.worker[0].environment[0].variables.SSM_PARAMETER_PATHS == "/supportpilot/production/shared/,/supportpilot/production/worker/,/supportpilot/production/settings/"
      && aws_lambda_function.worker[0].environment[0].variables.AWS_LWA_ERROR_STATUS_CODES == "500-599"
      && aws_lambda_function.worker[0].environment[0].variables.ALLOW_DEMO_SEED == "true"
      && !contains(keys(aws_lambda_function.web[0].environment[0].variables), "ALLOW_DEMO_SEED")
    )
    error_message = "Worker settings: its own folders, failed tasks reported as errors, and demo seeding (worker only)."
  }

  assert {
    condition = alltrue([
      for k in concat(keys(aws_lambda_function.web[0].environment[0].variables), keys(aws_lambda_function.worker[0].environment[0].variables)) :
      !contains(["DATABASE_URL", "BETTER_AUTH_SECRET", "DEMO_PASSWORD", "GEMINI_API_KEY", "SENTRY_DSN"], k)
    ])
    error_message = "No secret may be a function environment variable (they come from SSM)."
  }

  assert {
    condition     = aws_lambda_function.web[0].environment[0].variables.TRUST_PROXY_HEADERS == "false"
    error_message = "X-Forwarded-For stays untrusted until step 4 checks the Function URL overwrites it."
  }

  assert {
    condition     = aws_ssm_parameter.better_auth_url[0].value == "https://abc123example.lambda-url.ap-southeast-2.on.aws" && aws_ssm_parameter.better_auth_url[0].type == "String"
    error_message = "BETTER_AUTH_URL is the Function URL without its trailing slash, as a plain String."
  }

  assert {
    condition = (
      aws_scheduler_schedule.demo_reset[0].schedule_expression == "cron(5 0 * * ? *)"
      && aws_scheduler_schedule.demo_reset[0].schedule_expression_timezone == "America/Los_Angeles"
      && jsondecode(aws_scheduler_schedule.demo_reset[0].target[0].input) == { task = "seed-reset" }
      && aws_scheduler_schedule.demo_reset[0].target[0].arn == "arn:aws:lambda:ap-southeast-2:111122223333:function:supportpilot-worker:live"
    )
    error_message = "The nightly reset runs seed-reset on the worker's live alias at 00:05 Los Angeles time."
  }

  assert {
    condition     = aws_lambda_function_event_invoke_config.worker[0].qualifier == "live" && aws_lambda_function_event_invoke_config.worker[0].maximum_retry_attempts == 1
    error_message = "Asynchronous worker runs retry once."
  }
}

run "custom_domain_becomes_the_public_url" {
  command = plan

  variables {
    image_tag  = "sha-0123456"
    public_url = "https://app.example.com"
    app_env    = { DEMO_EMAIL_DOMAIN = "demo.example.com" }
  }

  assert {
    condition     = aws_ssm_parameter.better_auth_url[0].value == "https://app.example.com"
    error_message = "With a domain, BETTER_AUTH_URL is the domain."
  }

  assert {
    condition     = aws_lambda_function.web[0].environment[0].variables.DEMO_EMAIL_DOMAIN == "demo.example.com" && aws_lambda_function.worker[0].environment[0].variables.DEMO_EMAIL_DOMAIN == "demo.example.com"
    error_message = "app_env reaches both functions."
  }
}

run "reset_can_be_switched_off" {
  command = plan

  variables {
    image_tag          = "sha-0123456"
    demo_reset_enabled = false
  }

  assert {
    condition     = length(aws_scheduler_schedule.demo_reset) == 0
    error_message = "demo_reset_enabled = false removes the schedule."
  }
}

# ---- input checks --------------------------------------------------------------------

run "secrets_are_refused_as_plain_settings" {
  command = plan
  variables {
    app_env = { DATABASE_URL = "postgres://x" }
  }
  expect_failures = [var.app_env]
}

run "terraform_managed_settings_cant_be_overridden" {
  command = plan
  variables {
    app_env = { AWS_LWA_PORT = "1" }
  }
  expect_failures = [var.app_env]
}

run "image_tag_must_be_a_commit" {
  command = plan
  variables {
    image_tag = "latest"
  }
  expect_failures = [var.image_tag]
}

run "account_id_must_be_twelve_digits" {
  command = plan
  variables {
    aws_account_id = "1234"
  }
  expect_failures = [var.aws_account_id]
}
