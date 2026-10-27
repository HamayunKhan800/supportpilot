# One private image repository; both functions run the same image (ADR-0008).
resource "aws_ecr_repository" "app" {
  name = local.repository_name

  # Tags are commit SHAs and never move, so a tag always means the same code.
  image_tag_mutability = "IMMUTABLE"

  # Basic scanning (free) on every push, alongside the Trivy scan in CI.
  image_scanning_configuration {
    scan_on_push = true
  }

  # AWS-owned keys. A customer-managed KMS key would cost $1 a month and adds nothing here:
  # the image holds no secrets.
  encryption_configuration {
    encryption_type = "AES256"
  }
}

# Keep the 3 newest images (the live one plus two to roll back to); drop untagged layers
# left by failed pushes after a day.
resource "aws_ecr_lifecycle_policy" "app" {
  repository = aws_ecr_repository.app.name
  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Untagged images after 1 day"
        selection = {
          tagStatus   = "untagged"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = 1
        }
        action = { type = "expire" }
      },
      {
        rulePriority = 2
        description  = "Keep the 3 newest images"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 3
        }
        action = { type = "expire" }
      },
    ]
  })
}

# Lambda pulls the image with this grant. Writing it here (Lambda's documented form) stops
# Lambda from adding its own copy, which Terraform would then fight over.
resource "aws_ecr_repository_policy" "app" {
  repository = aws_ecr_repository.app.name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "LambdaPull"
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer"]
      Condition = {
        StringLike = { "aws:sourceArn" = "arn:aws:lambda:${local.region}:${local.account}:function:supportpilot-*" }
      }
    }]
  })
}
