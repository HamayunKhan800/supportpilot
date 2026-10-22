# Label spot-check (20% of questions)

The retrieval eval is only as good as its labels. These 22 questions (every 5th of 110) were picked mechanically, not chosen. For each one, please check:

1. Would a real customer plausibly ask this?
2. Does the quoted passage actually answer it?

Mark each ✅ or ❌, and add a note if something is off. Any ❌ gets fixed and the eval re-run.

### q005: How long does a new password have to be?

- **Article:** Reset your password
- **Answer passage:** "It must be at least 12 characters long."
- **Your check:** ☐ ✅ ☐ ❌ · note:

### q010: It's urgent, can support speed up my account recovery?

- **Article:** Recover a locked account
- **Answer passage:** "Our support team cannot skip or shorten the waiting period, even if you contact us."
- **Your check:** ☐ ✅ ☐ ❌ · note:

### q015: I deleted my Nimbus account but the App Store keeps charging me

- **Article:** Delete your Nimbus account
- **Answer passage:** "If you pay through the App Store or Google Play, cancel the subscription there as well, because deleting your account does not stop the store from charging you."
- **Your check:** ☐ ✅ ☐ ❌ · note:

### q020: How do we automatically remove Nimbus accounts when people leave the company?

- **Article:** Single sign-on (SSO) for Business
- **Answer passage:** "With SCIM, accounts are created, updated and removed automatically when you change them in your identity provider."
- **Your check:** ☐ ✅ ☐ ❌ · note:

### q025: Do you offer end-to-end encryption?

- **Article:** How Nimbus protects your files
- **Answer passage:** "Files in the Vault are encrypted on your device with a key that only you hold, so not even Nimbus can read them."
- **Your check:** ☐ ✅ ☐ ❌ · note:

### q030: How much storage does each Business user get?

- **Article:** Plans and pricing
- **Answer passage:** "5 TB of storage per user, pooled across the team"
- **Your check:** ☐ ✅ ☐ ❌ · note:

### q035: Will you remind me before my yearly plan renews?

- **Article:** Your billing cycle and invoices
- **Answer passage:** "We email a reminder 7 days before every yearly renewal, so you have time to change or cancel your plan."
- **Your check:** ☐ ✅ ☐ ❌ · note:

### q040: I use 500 GB. What happens to my files if I cancel my paid plan?

- **Article:** Cancel your subscription
- **Answer passage:** "But your account becomes over quota: syncing and new uploads stop until you either delete files to get under 15 GB or choose a paid plan again."
- **Your check:** ☐ ✅ ☐ ❌ · note:

### q045: Can our company pay by bank transfer instead of by card?

- **Article:** Payment methods and failed payments
- **Answer passage:** "Business teams with 10 or more users on a yearly plan can pay by invoice with a bank transfer."
- **Your check:** ☐ ✅ ☐ ❌ · note:

### q050: My dad removed me from our family plan. What happens to my photos?

- **Article:** The Family plan
- **Answer passage:** "When a member leaves or is removed, their files stay with them."
- **Your check:** ☐ ✅ ☐ ❌ · note:

### q055: I deleted lots of files but my storage is still full

- **Article:** What counts toward your storage
- **Answer passage:** "Deleted files keep using space until they're permanently removed."
- **Your check:** ☐ ✅ ☐ ❌ · note:

### q060: If I uninstall Nimbus, will my files be deleted?

- **Article:** Install the desktop app
- **Answer passage:** "Uninstalling the app doesn't delete your files from Nimbus."
- **Your check:** ☐ ✅ ☐ ❌ · note:

### q065: How do I rebuild the sync cache?

- **Article:** Fix sync problems
- **Answer passage:** "Go to Preferences > Advanced > Rebuild sync cache."
- **Your check:** ☐ ✅ ☐ ❌ · note:

### q070: What is the biggest file I can upload through the website?

- **Article:** File size and file name limits
- **Answer passage:** "Web app: up to 5 GB per file."
- **Your check:** ☐ ✅ ☐ ❌ · note:

### q075: Ransomware encrypted my files and they synced to Nimbus

- **Article:** Restore an earlier version of a file
- **Answer passage:** "Use Rewind under Settings > Files > Rewind to restore a whole folder, or your entire Nimbus space, to how it was at a chosen moment."
- **Your check:** ☐ ✅ ☐ ❌ · note:

### q080: Can I lock the Nimbus app with Face ID?

- **Article:** Nimbus on your phone and tablet
- **Answer passage:** "Turn on Settings > Passcode to require Face ID, Touch ID, your fingerprint or a 4-digit passcode when you open Nimbus."
- **Your check:** ☐ ✅ ☐ ❌ · note:

### q085: Which browsers do you support?

- **Article:** Using Nimbus in your browser
- **Answer passage:** "We support the latest two versions of Google Chrome, Mozilla Firefox, Apple Safari and Microsoft Edge."
- **Your check:** ☐ ✅ ☐ ❌ · note:

### q090: How do I stop a link I sent from working?

- **Article:** Share files with a link
- **Answer passage:** "To turn off a link, open Share, click the link and choose Delete link."
- **Your check:** ☐ ✅ ☐ ❌ · note:

### q095: I removed someone from a shared folder. Do they keep the files they downloaded?

- **Article:** Shared folders
- **Answer passage:** "Removed people lose access right away; files they already downloaded to their computer stay there as normal files that no longer sync."
- **Your check:** ☐ ✅ ☐ ❌ · note:

### q100: Can an admin reset two-factor authentication for a team member?

- **Article:** The Business admin console
- **Answer passage:** "reset two-step verification for a member who lost their phone, so they can set it up again,"
- **Your check:** ☐ ✅ ☐ ❌ · note:

### q105: How quickly does support reply on the Family plan?

- **Article:** Contact Nimbus support
- **Answer passage:** "Personal and Family: email support, with a reply within 24 hours, 7 days a week."
- **Your check:** ☐ ✅ ☐ ❌ · note:

### q110: I can't sign in after typing the wrong password several times

- **Article:** Suspicious sign-ins and security alerts
- **Answer passage:** "After 10 wrong password attempts in a row, we lock sign-in for that account for 15 minutes to stop people guessing."
- **Your check:** ☐ ✅ ☐ ❌ · note:

## Result

- Checked by: (name), (date)
- ✅ __ of 22 · ❌ __ (fixed in commit …)
