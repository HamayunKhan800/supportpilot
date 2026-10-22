# Single sign-on (SSO) for Business

Business administrators can let employees sign in to Nimbus with their company account instead of a separate password.

## Supported identity providers

Nimbus supports any identity provider that uses **SAML 2.0**, including Okta, Microsoft Entra ID (formerly Azure AD), Google Workspace, OneLogin and JumpCloud.

## Set up SSO

1. In the admin console, go to **Security > Single sign-on**.
2. Copy the Nimbus Entity ID and Assertion Consumer Service URL into your identity provider.
3. Upload your provider's metadata XML file, or paste its sign-in URL and certificate.
4. Click **Test connection**, sign in with a test user, and then **Turn on**.

## Optional or required

At first, SSO is **optional**: people can use either SSO or their Nimbus password. When everyone has signed in with SSO at least once, switch it to **required**. Then passwords stop working and two-step verification is handled by your identity provider. Administrators keep a password as a break-glass login in case your provider has an outage.

## Automatic provisioning (SCIM)

With SCIM, accounts are created, updated and removed automatically when you change them in your identity provider. Generate a SCIM token under **Security > Provisioning**. When you remove a person in your identity provider, their Nimbus account is suspended and their files stay available for an administrator to transfer.
