output "ecr_repository_url" {
  description = "Where deployments push the image (tag sha-<commit>)."
  value       = aws_ecr_repository.app.repository_url
}

output "deploy_role_arn" {
  description = "Role for the GitHub \"production\" environment (deploy.yml)."
  value       = aws_iam_role.deploy.arn
}

output "functions_created" {
  description = "false until an image exists and image_tag is set (first apply)."
  value       = local.deployed
}

output "web_url" {
  description = "The web function's own address (Function URL)."
  value       = local.function_url
}

output "public_url" {
  description = "The app's public origin (BETTER_AUTH_URL)."
  value       = local.public_url
}

output "function_names" {
  description = "Lambda function names; traffic and jobs go to their `live` alias."
  value       = local.function_name
}

output "ssm_folders" {
  description = "Parameter Store folders the owner fills with SecureString values (see infra/README.md)."
  value = {
    shared = "${local.ssm_root}/shared/ (GEMINI_API_KEY, SENTRY_DSN, DEMO_PASSWORD)"
    web    = "${local.ssm_root}/web/ (DATABASE_URL pooled, BETTER_AUTH_SECRET, OAuth and email secrets)"
    worker = "${local.ssm_root}/worker/ (DATABASE_URL direct)"
  }
}
