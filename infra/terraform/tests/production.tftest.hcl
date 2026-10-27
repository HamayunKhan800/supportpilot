# Checks the committed production.tfvars against the variable rules. Run as
#   terraform test -var-file=production.tfvars
# (CI does). No variable here except the account, so the file's values are the ones used.

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

variables {
  aws_account_id = "111122223333"
}

run "production_settings_are_valid" {
  command = plan

  variables {
    image_tag = "sha-0123456"
  }

  assert {
    condition     = contains(["mock", "gemini"], aws_lambda_function.web[0].environment[0].variables.AI_PROVIDER)
    error_message = "production.tfvars must choose an AI provider."
  }

  assert {
    condition     = tonumber(aws_lambda_function.worker[0].environment[0].variables.AI_DAILY_EMBEDDING_LIMIT) <= 800
    error_message = "The daily embedding cap stays within the Gemini free tier plan (M8 step 2d)."
  }
}
