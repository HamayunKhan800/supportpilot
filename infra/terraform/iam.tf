# Every role here carries the permissions boundary made by the bootstrap script, and the
# infra role may only create roles that do. The boundary is the most these roles can ever
# do, whatever policy is attached (AWS's pattern for delegating role creation).
#
# Policies are written with jsonencode so the offline tests can read them
# (tests/plan.tftest.hcl).

locals {
  # ---- function roles -------------------------------------------------------------
  lambda_trust = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })

  function_policy = {
    for k in keys(local.function_name) : k => jsonencode({
      Version = "2012-10-17"
      Statement = concat(
        [
          {
            Sid      = "WriteOwnLogs"
            Effect   = "Allow"
            Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
            Resource = "${aws_cloudwatch_log_group.function[k].arn}:*"
          },
          # GetParametersByPath is authorised against the folder asked for, so listing a
          # folder (with or without its trailing slash) is what is granted, and only these.
          {
            Sid    = "ReadOwnSettings"
            Effect = "Allow"
            Action = "ssm:GetParametersByPath"
            Resource = flatten([
              for f in local.ssm_folders[k] : [
                "arn:aws:ssm:${local.region}:${local.account}:parameter${local.ssm_root}/${f}",
                "arn:aws:ssm:${local.region}:${local.account}:parameter${local.ssm_root}/${f}/*",
              ]
            ])
          },
        ],
        # The web app wakes the worker after queueing a job (plan M8 R4).
        k == "web" ? [{
          Sid      = "WakeWorker"
          Effect   = "Allow"
          Action   = "lambda:InvokeFunction"
          Resource = local.worker_alias_arn
        }] : [],
      )
    })
  }

  # ---- scheduler role -------------------------------------------------------------
  scheduler_trust = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "scheduler.amazonaws.com" }
      Action    = "sts:AssumeRole"
      # Only schedules in this account can use the role (confused-deputy guard).
      Condition = { StringEquals = { "aws:SourceAccount" = local.account } }
    }]
  })

  # ---- deploy role ----------------------------------------------------------------
  deploy_trust = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      # Only the deploy user (bootstrap.sh). Its access key lives in the "production"
      # environment's secrets, which GitHub releases only to approved jobs on main.
      Principal = { AWS = local.deploy_user_arn }
      Action    = "sts:AssumeRole"
    }]
  })

  deploy_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      # ECR sign-in has no resource-level control; AWS documents "*" for this one action.
      {
        Sid      = "RegistrySignIn"
        Effect   = "Allow"
        Action   = "ecr:GetAuthorizationToken"
        Resource = "*"
      },
      {
        Sid    = "PushImages"
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability",
          "ecr:InitiateLayerUpload",
          "ecr:UploadLayerPart",
          "ecr:CompleteLayerUpload",
          "ecr:PutImage",
          "ecr:BatchGetImage",
          "ecr:GetDownloadUrlForLayer",
          "ecr:DescribeImages",
        ]
        Resource = aws_ecr_repository.app.arn
      },
      # A release: update the image, publish a version, run `migrate` on that version, then
      # point `live` at it (or back, to roll back). Versions are addressed as name:qualifier.
      {
        Sid    = "ReleaseFunctions"
        Effect = "Allow"
        Action = [
          "lambda:GetFunction",
          "lambda:GetFunctionConfiguration",
          "lambda:GetFunctionUrlConfig",
          "lambda:GetAlias",
          "lambda:ListVersionsByFunction",
          "lambda:UpdateFunctionCode",
          "lambda:PublishVersion",
          "lambda:UpdateAlias",
        ]
        Resource = flatten([for arn in values(local.function_arn) : [arn, "${arn}:*"]])
      },
      {
        Sid      = "RunWorkerTasks"
        Effect   = "Allow"
        Action   = "lambda:InvokeFunction"
        Resource = [local.function_arn.worker, "${local.function_arn.worker}:*"]
      },
    ]
  })
}

resource "aws_iam_role" "function" {
  for_each = local.function_name

  name                 = each.value
  path                 = local.role_path
  description          = "Runs the ${each.key} function."
  assume_role_policy   = local.lambda_trust
  permissions_boundary = local.boundary_arn
}

resource "aws_iam_role_policy" "function" {
  for_each = local.function_name

  name   = "runtime"
  role   = aws_iam_role.function[each.key].id
  policy = local.function_policy[each.key]
}

resource "aws_iam_role" "scheduler" {
  name                 = "supportpilot-scheduler"
  path                 = local.role_path
  description          = "Lets EventBridge Scheduler start the nightly demo reset."
  assume_role_policy   = local.scheduler_trust
  permissions_boundary = local.boundary_arn
}

resource "aws_iam_role_policy" "scheduler" {
  name = "invoke-worker"
  role = aws_iam_role.scheduler.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid      = "InvokeWorker"
      Effect   = "Allow"
      Action   = "lambda:InvokeFunction"
      Resource = local.worker_alias_arn
    }]
  })
}

# GitHub Actions jobs in the protected "production" environment (owner approval required).
resource "aws_iam_role" "deploy" {
  name                 = "supportpilot-deploy"
  path                 = local.role_path
  description          = "GitHub Actions deploys: push the image, migrate, move the live alias."
  assume_role_policy   = local.deploy_trust
  permissions_boundary = local.boundary_arn
  max_session_duration = 3600
}

resource "aws_iam_role_policy" "deploy" {
  name   = "deploy"
  role   = aws_iam_role.deploy.id
  policy = local.deploy_policy
}
