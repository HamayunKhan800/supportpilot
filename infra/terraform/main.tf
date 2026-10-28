# Names are fixed rather than variables: the bootstrap policies (infra/bootstrap/*.json)
# limit the infra and app roles to resources called supportpilot-*, so a rename here would
# lock Terraform out.

locals {
  account = var.aws_account_id
  region  = var.region

  repository_name = "supportpilot"
  function_name = {
    web    = "supportpilot-web"
    worker = "supportpilot-worker"
  }
  alias_name          = "live"
  previous_alias_name = "previous"

  function_arn = {
    for k, n in local.function_name : k => "arn:aws:lambda:${local.region}:${local.account}:function:${n}"
  }
  worker_alias_arn = "${local.function_arn.worker}:${local.alias_name}"

  # Made by the bootstrap script, outside Terraform (see infra/README.md).
  # The IAM user GitHub's protected "production" environment signs in as: it may only assume
  # the deploy role. (New-experience AWS accounts deny OIDC providers; plan M8 change log.)
  deploy_user_arn = "arn:aws:iam::${local.account}:user/supportpilot/supportpilot-github-deploy"
  boundary_arn    = "arn:aws:iam::${local.account}:policy/supportpilot-boundary"
  role_path       = "/supportpilot/"

  # SSM Parameter Store folders (plan M8 R6). Each parameter directly inside a folder becomes
  # one environment variable named after it (scripts/lib/ssm-env.ts).
  #   shared   secrets both functions need (GEMINI_API_KEY, SENTRY_DSN, DEMO_PASSWORD)
  #   web      web-only secrets and the pooled database address
  #   worker   the direct database address (migrations and pg-boss sessions)
  #   settings plain values Terraform writes (BETTER_AUTH_URL)
  # The owner adds secret values in CloudShell, so they never enter Terraform state.
  ssm_root = "/supportpilot/production"
  ssm_folders = {
    web    = ["shared", "web", "settings"]
    worker = ["shared", "worker", "settings"]
  }
  ssm_paths = {
    for k, folders in local.ssm_folders : k => [for f in folders : "${local.ssm_root}/${f}/"]
  }

  # Functions exist only once an image does (the first apply runs before the first push).
  deployed  = var.image_tag != null
  image_uri = local.deployed ? "${aws_ecr_repository.app.repository_url}:${var.image_tag}" : null

  function_url = local.deployed ? trimsuffix(aws_lambda_function_url.web[0].function_url, "/") : null
  public_url   = var.public_url != null ? var.public_url : local.function_url
}
