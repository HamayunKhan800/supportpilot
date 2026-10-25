import { getEnv } from "../env";

export type SocialProvider = "google" | "github";

export interface AuthFeatures {
  /** Email is configured: password reset and email verification are on. */
  email: boolean;
  /** Sign-in buttons to show, in display order. Only providers whose keys are set. */
  socialProviders: SocialProvider[];
}

/** What the sign-in pages may offer, from the settings (no secrets leave this function). */
export function getAuthFeatures(
  env: Pick<
    ReturnType<typeof getEnv>,
    | "EMAIL_PROVIDER"
    | "GOOGLE_CLIENT_ID"
    | "GOOGLE_CLIENT_SECRET"
    | "GITHUB_CLIENT_ID"
    | "GITHUB_CLIENT_SECRET"
  > = getEnv(),
): AuthFeatures {
  const socialProviders: SocialProvider[] = [];
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) socialProviders.push("google");
  if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) socialProviders.push("github");
  return { email: Boolean(env.EMAIL_PROVIDER), socialProviders };
}
