# The app's own address, read at cold start like the secrets. It can't be a plain
# environment variable: the Function URL is made after the function, so the function can't
# refer to it without a dependency loop. It is not secret, hence a String in the folder that
# Terraform owns; the infra role can't touch the secret folders.
resource "aws_ssm_parameter" "better_auth_url" {
  count = local.public_url != null ? 1 : 0

  name        = "${local.ssm_root}/settings/BETTER_AUTH_URL"
  description = "Public origin of the app (Better Auth, links in emails)."
  type        = "String"
  value       = local.public_url
}
