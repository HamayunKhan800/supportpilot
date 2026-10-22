# Integrations and the Nimbus API

## Built-in integrations

- **Microsoft 365 and Google Workspace:** open Word, Excel and PowerPoint files, or Google Docs, Sheets and Slides, straight from Nimbus and save changes back.
- **Slack and Microsoft Teams:** when you paste a Nimbus link, people see a preview of the file in the conversation.
- **Zapier:** connect Nimbus to thousands of apps, for example to save email attachments to a folder automatically.

Connect integrations under **Settings > Connected apps**. You can see and disconnect every app that has access to your account there.

## The Nimbus API

Developers can build their own apps with the Nimbus REST API. Documentation is at developers.nimbus.example.

- Apps use **OAuth 2.0** to ask people for permission. Never ask users for their Nimbus password.
- Each app can make up to **600 requests per minute per user**. If you go over the limit, the API returns HTTP 429 with a Retry-After header telling you how many seconds to wait.
- Uploads over 150 MB must use resumable upload sessions.
- Webhooks notify your app when files change, so you don't need to keep polling.

## Personal access tokens

For scripts that only access your own account, create a personal access token under **Settings > Developer**. Tokens can be limited to read-only access and to one folder. Treat a token like a password and revoke it if it leaks.
