# Production settings, passed by infra.yml with -var-file. Nothing secret: secrets live in
# SSM Parameter Store, and the account ID comes from the GitHub variable AWS_ACCOUNT_ID.

# Mock answers for the first smoke test (plan M8 step 4), then "gemini".
ai_provider = "mock"

app_env = {
  # Gemini free tier guard (M6, step 2d): calls and embeddings per Pacific day.
  AI_DAILY_CALL_LIMIT      = "200"
  AI_DAILY_EMBEDDING_LIMIT = "800"
}

# Set when the domain exists (plan M8 step 6), e.g. "https://app.example.com".
public_url = null
