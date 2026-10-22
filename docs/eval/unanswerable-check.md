# Unanswerable questions: human check

Generated 2026-10-22 by `pnpm eval:retrieval` (gemini-embedding-2@768, chunks 500 tokens / 0.15 overlap). Do not edit by hand.

These questions are meant to have **no answer** in the 35 Nimbus help articles, so the AI should say it doesn't know (refusal tests, M5/M6). A question wrongly marked unanswerable would punish a correct answer, so each one is checked three ways:

1. **Word check (automatic):** the terms an answer would need appear in no article (unit test).
2. **Search check (automatic):** below are the top 3 passages from meaning (vector) search and from keyword search (repeats shown once, text shortened).
3. **Human check (you):** read each question and its passages. **If any passage answers the question, note the question id** (e.g. u007). Partly answering counts too.

**Best vector match score** (1 = identical meaning): answerable questions 0.638–0.89 (median 0.791); unanswerable 0.57–0.8 (median 0.762). Where the ranges overlap, a score cut-off alone can't tell them apart.

## u001: Can I buy extra storage on top of the 2 TB in my Personal plan without changing plans?

**Why it should be unanswerable:** Plans list fixed storage amounts and upgrading between plans; no add-on storage is mentioned.

1. **storage-quota.md › What counts toward your storage** (vector, score 0.776): Your storage quota is the amount of space your plan includes: 15 GB on Free, 2 TB on Personal, 2 TB shared on Family, and 5 TB per user on Business.
2. **change-plan.md › Upgrade or downgrade your plan › Upgrading** (vector, score 0.774): Upgrades take effect immediately. You pay only the difference for the rest of your current billing period (we prorate the price), and from then on the new price applies. Extra storage is available as soon as the payment goes through. To upg…
3. **change-plan.md › Upgrade or downgrade your plan › Moving from Personal to Family** (vector, score 0.738): Upgrading from Personal to Family keeps all your files. You become the Family organizer and can invite up to 5 more people.
4. **plans-and-pricing.md › Page 1** (keyword): Plans and pricing Nimbus has four plans. Prices are in US dollars and exclude sales tax or VAT, which is added at checkout based on your country. Free - 15 GB of storage - Desktop, mobile and web apps - File version history for 30 days - Sh…
5. **family-plan.md › The Family plan › Shared storage** (keyword): The 2 TB is one pool for the whole family. The organizer can see how much each person uses and can set a storage limit per member under Settings > Family.

## u002: Do teachers or school staff get a discount?

**Why it should be unanswerable:** Discounts exist for students (Personal) and registered non-profits (Business); nothing about teachers or staff.

1. **student-discount.md › Student discount › Who can get it** (vector, score 0.703): You need to be enrolled at a university, college or other higher-education school. High-school students aren't eligible, but can use the Family plan of a parent.
2. **plans-and-pricing.md › Page 2** (vector, score 0.689): discount on Personal; see the student discount article.
3. **student-discount.md › Student discount** (vector, score 0.68): Students get 50% off the Personal plan on yearly billing, which is $49.50 per year instead of $99.
4. **student-discount.md › Student discount › Renewal** (keyword): The discount lasts as long as you're a student. We ask you to verify again every 12 months, before your renewal. If you're no longer a student, your plan renews at the normal Personal price; you can cancel or switch plans before then. The s…
5. **student-discount.md › Student discount › How to apply** (keyword): 1. Go to nimbus.example/students and click Verify student status. 2. Our partner SheerID checks your enrolment. Most students are verified instantly with their school email address; others upload a student ID or enrolment letter. 3. Once yo…

## u003: Can I transfer my whole Nimbus account to someone else, like a family member?

**Why it should be unanswerable:** Shared-folder ownership, a departing employee's files and a Family plan can be transferred; transferring a personal account is not covered.

1. **delete-account.md › Delete your Nimbus account › How to delete** (vector, score 0.786): Go to Settings > Account > Delete account, enter your password and type DELETE to confirm.
2. **change-email.md › Change the email address on your account** (vector, score 0.785): You can change the email address you use to sign in to Nimbus at any time. 1. Go to Settings > Account > Email address and click Change. 2. Enter your new address and your current password. 3. We send a confirmation link to the new address,…
3. **data-export.md › Export a copy of your data** (vector, score 0.785): You can download a copy of everything Nimbus stores about you: your files, their folder structure, your account details and your activity history. This is your right under data-protection laws such as the GDPR.
4. **security-and-encryption.md › Page 1** (keyword): How Nimbus protects your files This overview explains how your files are protected while they travel to Nimbus and while they are stored. Encryption in transit Every connection between your devices and Nimbus uses TLS 1.2 or newer, and TLS…
5. **delete-account.md › Delete your Nimbus account › Before you delete** (keyword): - Cancel any paid plan first. If you pay through the App Store or Google Play, cancel the subscription there as well, because deleting your account does not stop the store from charging you. - Family organizers: delete or transfer the Famil…
6. **business-admin-console.md › Page 1** (keyword): The Business admin console The admin console is where Business administrators manage the team. Open it from your profile menu and choose Admin console. Only team owners and administrators can see it. Add and remove users - Invite users: go…

## u004: What's the maximum number of people I can invite to a single shared folder?

**Why it should be unanswerable:** Roles and invitations are described, but no limit on members per shared folder.

1. **shared-folders.md › Shared folders › Invite people** (vector, score 0.777): 1. Right-click a folder and choose Share. 2. Enter the email addresses of the people you want to invite. 3. Choose a role for each person: - Viewer: can open and download files. - Editor: can add, change and delete files, and invite others…
2. **shared-folders.md › Shared folders** (vector, score 0.759): A shared folder lets you work on the same files with other people. Everyone you invite sees the folder in their own Nimbus space, and changes sync to everyone.
3. **shared-folders.md › Shared folders › Storage** (vector, score 0.756): A shared folder counts only toward the owner's storage. If you join a 100 GB shared folder, it doesn't use any of your own space.
4. **shared-folders.md › Shared folders › Nested sharing** (keyword): You can't share a folder that's inside another shared folder with different people. Share the parent folder instead, or move the folder out.
5. **shared-folders.md › Shared folders › Leave or remove** (keyword): - To leave a folder someone shared with you, right-click it and choose Leave folder. Your copy disappears, but the folder stays for everyone else. - The owner can remove people under Share > Manage access. Removed people lose access right a…

## u005: Can I protect a file request with a password?

**Why it should be unanswerable:** File requests have deadlines; passwords exist for sharing links only. Password protection for file requests is not mentioned.

1. **sharing-links.md › Share files with a link › Link settings** (vector, score 0.787): Paid plans can add extra protection under Link settings: - Expiry date: the link stops working after the date you choose. Available on Personal, Family and Business. - Password: people must enter a password before the file opens. Available…
2. **file-requests.md › Collect files with a file request › Create a file request** (vector, score 0.767): 1. In the web app, click File requests in the sidebar and then New request. 2. Give it a title and choose the folder where uploads should go. 3. Optionally set a deadline. After the deadline the request closes automatically, or you can allo…
3. **file-requests.md › Collect files with a file request** (vector, score 0.745): A file request lets anyone upload files to a folder of your choice, even if they don't have a Nimbus account. It's perfect for collecting homework, photos from an event, or documents from a client. File requests are available on Personal, F…
4. **file-size-limits.md › File size and file name limits › Maximum file size** (keyword): How big a single file can be depends on how you upload it: - Desktop app: up to 50 GB per file. - Web app: up to 5 GB per file. Use the desktop app for bigger files. - Mobile apps: up to 2 GB per file. - API: up to 50 GB per file with resum…
5. **file-requests.md › Collect files with a file request › Close a request** (keyword): Open File requests, select the request and click Close request. Files that were already uploaded stay in your folder.

## u006: How do I change the language the Nimbus app is displayed in?

**Why it should be unanswerable:** Only the languages of the support team are listed, not app display languages.

1. **mobile-app.md › Nimbus on your phone and tablet › Requirements** (vector, score 0.76): The Nimbus mobile app works on iPhone and iPad with iOS 16 or later, and on Android 10 or later. Download it from the App Store or Google Play and sign in with your Nimbus account.
2. **change-email.md › Change the email address on your account** (vector, score 0.717): You can change the email address you use to sign in to Nimbus at any time. 1. Go to Settings > Account > Email address and click Change. 2. Enter your new address and your current password. 3. We send a confirmation link to the new address,…
3. **contact-support.md › Contact Nimbus support › Support by plan** (vector, score 0.711): - Free: the help centre and the community forum. Our team answers account and billing questions by email. - Personal and Family: email support, with a reply within 24 hours, 7 days a week. - Business: 24/7 live chat and phone support. Urgen…
4. **security-and-encryption.md › Page 1** (keyword): How Nimbus protects your files This overview explains how your files are protected while they travel to Nimbus and while they are stored. Encryption in transit Every connection between your devices and Nimbus uses TLS 1.2 or newer, and TLS…
5. **integrations-and-api.md › Integrations and the Nimbus API › The Nimbus API** (keyword): Developers can build their own apps with the Nimbus REST API. Documentation is at developers.nimbus.example. - Apps use OAuth 2.0 to ask people for permission. Never ask users for their Nimbus password. - Each app can make up to 600 request…
6. **getting-started.md › Getting started with Nimbus › Install the apps** (keyword): - Desktop: download the Nimbus app for Windows, macOS or Linux from nimbus.example/download. After you sign in, it creates a folder called "Nimbus" in your home folder. Anything you put in that folder is uploaded automatically. - Mobile: ge…

## u007: Does the web app have a dark mode?

**Why it should be unanswerable:** Not mentioned anywhere.

1. **web-app.md › Using Nimbus in your browser › Keyboard shortcuts** (vector, score 0.686): Press ? in the web app to see all keyboard shortcuts. For example, / jumps to search and Shift+U opens the upload dialog.
2. **web-app.md › Using Nimbus in your browser › Preview and edit** (vector, score 0.663): The web app previews more than 150 file types, including Office documents, PDFs, images, videos and code. To edit Word, Excel and PowerPoint files, click Open in and choose Microsoft 365 or Google Docs.
3. **payment-methods.md › Payment methods and failed payments › Accepted payment methods** (vector, score 0.662): We accept Visa, Mastercard, American Express and PayPal. In some countries we also accept iDEAL, SEPA Direct Debit and Apple Pay in the web app. Business teams with 10 or more users on a yearly plan can pay by invoice with a bank transfer.…
4. **file-size-limits.md › File size and file name limits › Maximum file size** (keyword): How big a single file can be depends on how you upload it: - Desktop app: up to 50 GB per file. - Web app: up to 5 GB per file. Use the desktop app for bigger files. - Mobile apps: up to 2 GB per file. - API: up to 50 GB per file with resum…
5. **getting-started.md › Getting started with Nimbus › Install the apps** (keyword): - Desktop: download the Nimbus app for Windows, macOS or Linux from nimbus.example/download. After you sign in, it creates a folder called "Nimbus" in your home folder. Anything you put in that folder is uploaded automatically. - Mobile: ge…
6. **integrations-and-api.md › Integrations and the Nimbus API › The Nimbus API** (keyword): Developers can build their own apps with the Nimbus REST API. Documentation is at developers.nimbus.example. - Apps use OAuth 2.0 to ask people for permission. Never ask users for their Nimbus password. - Each app can make up to 600 request…

## u008: Can I pause my subscription for a few months instead of cancelling it?

**Why it should be unanswerable:** Cancelling, undoing a cancellation and changing plans are covered; pausing a subscription is not. ("Pause" only appears for syncing.)

1. **cancel-subscription.md › Cancel your subscription › Changed your mind?** (vector, score 0.73): Before the end of your paid period, click Keep my plan under Settings > Billing to undo the cancellation.
2. **refunds.md › Refund policy › Monthly plans** (vector, score 0.7): Monthly plans are not refunded for partial months. When you cancel, you keep your paid features until the end of the month you've paid for.
3. **cancel-subscription.md › Cancel your subscription** (vector, score 0.699): You can cancel a paid plan at any time. There are no cancellation fees.
4. **cancel-subscription.md › Cancel your subscription › How to cancel** (keyword): 1. Go to Settings > Billing. 2. Click Cancel plan and tell us why (optional). 3. Confirm. We email you a confirmation. If you subscribed through the App Store or Google Play, cancel in your phone's subscription settings instead; you can't c…
5. **plans-and-pricing.md › Page 1** (keyword): Plans and pricing Nimbus has four plans. Prices are in US dollars and exclude sales tax or VAT, which is added at checkout based on your country. Free - 15 GB of storage - Desktop, mobile and web apps - File version history for 30 days - Sh…

## u009: Is there a free trial of the Business plan?

**Why it should be unanswerable:** Not mentioned.

1. **contact-support.md › Contact Nimbus support › Support by plan** (vector, score 0.692): - Free: the help centre and the community forum. Our team answers account and billing questions by email. - Personal and Family: email support, with a reply within 24 hours, 7 days a week. - Business: 24/7 live chat and phone support. Urgen…
2. **refunds.md › Refund policy › How to ask for a refund** (vector, score 0.69): Go to Settings > Billing, find the payment and click Request refund, or contact support. Refunds for Business plans are handled by the account owner.
3. **cancel-subscription.md › Cancel your subscription** (vector, score 0.688): You can cancel a paid plan at any time. There are no cancellation fees.
4. **plans-and-pricing.md › Page 1** (keyword): Plans and pricing Nimbus has four plans. Prices are in US dollars and exclude sales tax or VAT, which is added at checkout based on your country. Free - 15 GB of storage - Desktop, mobile and web apps - File version history for 30 days - Sh…
5. **sharing-links.md › Share files with a link › Link settings** (keyword): Paid plans can add extra protection under Link settings: - Expiry date: the link stops working after the date you choose. Available on Personal, Family and Business. - Password: people must enter a password before the file opens. Available…
6. **refunds.md › Refund policy › Annual plans** (keyword): Annual plans can be refunded in full within 30 days of purchase or renewal. After 30 days, annual plans are not refundable, but you can cancel so that the plan doesn't renew.

## u010: Will my free account be deleted if I don't sign in for a year?

**Why it should be unanswerable:** Only deliberate account deletion is described; no inactivity policy.

1. **cancel-subscription.md › Cancel your subscription › If you use more than 15 GB** (vector, score 0.761): Nothing is deleted. Your files stay in your account and you can still view, share and download them. But your account becomes over quota: syncing and new uploads stop until you either delete files to get under 15 GB or choose a paid plan ag…
2. **deleted-files.md › Recover deleted files › How long deleted files are kept** (vector, score 0.728): - Free plan: 30 days in the trash - Paid plans: 90 days in the trash After that, files are permanently deleted. Files in the trash still count toward your storage.
3. **cancel-subscription.md › Cancel your subscription › What happens next** (vector, score 0.722): Your plan stays active until the end of the period you've paid for. On that date your account moves to the Free plan with 15 GB of storage. Cancelling doesn't refund the current period; see our refund policy for when refunds apply.
4. **delete-account.md › Delete your Nimbus account › Before you delete** (keyword): - Cancel any paid plan first. If you pay through the App Store or Google Play, cancel the subscription there as well, because deleting your account does not stop the store from charging you. - Family organizers: delete or transfer the Famil…
5. **delete-account.md › Delete your Nimbus account › How to delete** (keyword): Go to Settings > Account > Delete account, enter your password and type DELETE to confirm.
6. **delete-account.md › Delete your Nimbus account › The 30-day grace period** (keyword): Your account is deactivated immediately: you're signed out everywhere, links stop working and shared folders are no longer available to others. For 30 days you can still change your mind: sign in and click Restore my account, and everything…

## u011: Is there a Nimbus widget for my phone's home screen?

**Why it should be unanswerable:** Not mentioned.

1. **mobile-app.md › Nimbus on your phone and tablet › Requirements** (vector, score 0.777): The Nimbus mobile app works on iPhone and iPad with iOS 16 or later, and on Android 10 or later. Download it from the App Store or Google Play and sign in with your Nimbus account.
2. **getting-started.md › Getting started with Nimbus › Install the apps** (vector, score 0.726): - Desktop: download the Nimbus app for Windows, macOS or Linux from nimbus.example/download. After you sign in, it creates a folder called "Nimbus" in your home folder. Anything you put in that folder is uploaded automatically. - Mobile: ge…
3. **desktop-app.md › Install the desktop app** (vector, score 0.724): The Nimbus desktop app keeps a folder on your computer in sync with your Nimbus account.
4. **security-and-encryption.md › Page 1** (keyword): How Nimbus protects your files This overview explains how your files are protected while they travel to Nimbus and while they are stored. Encryption in transit Every connection between your devices and Nimbus uses TLS 1.2 or newer, and TLS…
5. **mobile-app.md › Nimbus on your phone and tablet › Lost phone** (keyword): Sign out the lost device remotely from the web app under Settings > Security > Devices. Offline files on the device are removed the next time it connects.
6. **mobile-app.md › Nimbus on your phone and tablet › Upload from your phone** (keyword): Tap + to upload photos, take a picture, scan a document to PDF, or create a folder. Mobile uploads are limited to 2 GB per file.

## u012: Does Nimbus scan my files for viruses or malware?

**Why it should be unanswerable:** Antivirus appears only as third-party software slowing sync, and executable previews are disabled; scanning by Nimbus is not stated.

1. **security-and-encryption.md › Page 1** (vector, score 0.788): How Nimbus protects your files This overview explains how your files are protected while they travel to Nimbus and while they are stored. Encryption in transit Every connection between your devices and Nimbus uses TLS 1.2 or newer, and TLS…
2. **getting-started.md › Getting started with Nimbus** (vector, score 0.765): Nimbus Cloud Storage keeps your files safe in the cloud and in sync across your computer, phone and the web. This guide walks you through your first ten minutes.
3. **version-history.md › Restore an earlier version of a file › Recover from ransomware** (vector, score 0.759): If ransomware or a virus encrypted many files on your computer, those damaged files were synced too. Use Rewind under Settings > Files > Rewind to restore a whole folder, or your entire Nimbus space, to how it was at a chosen moment. Rewind…
4. **file-size-limits.md › File size and file name limits › Maximum file size** (keyword): How big a single file can be depends on how you upload it: - Desktop app: up to 50 GB per file. - Web app: up to 5 GB per file. Use the desktop app for bigger files. - Mobile apps: up to 2 GB per file. - API: up to 50 GB per file with resum…
5. **sync-troubleshooting.md › Fix sync problems › Error codes** (keyword): The desktop app shows an error code next to files that can't sync: - NC-101: invalid file name. The name contains characters that aren't allowed on one of your devices, such as < > : " / \ | ? on Windows, or it ends with a space or a dot. R…

## u013: Can I access my Nimbus files over WebDAV or FTP?

**Why it should be unanswerable:** Only the REST API, apps and integrations are described.

1. **web-app.md › Using Nimbus in your browser** (vector, score 0.751): The Nimbus web app at app.nimbus.example lets you use your files on any computer without installing anything.
2. **getting-started.md › Getting started with Nimbus › Install the apps** (vector, score 0.751): - Desktop: download the Nimbus app for Windows, macOS or Linux from nimbus.example/download. After you sign in, it creates a folder called "Nimbus" in your home folder. Anything you put in that folder is uploaded automatically. - Mobile: ge…
3. **file-requests.md › Collect files with a file request** (vector, score 0.75): A file request lets anyone upload files to a folder of your choice, even if they don't have a Nimbus account. It's perfect for collecting homework, photos from an event, or documents from a client. File requests are available on Personal, F…
4. **security-and-encryption.md › Page 1** (keyword): How Nimbus protects your files This overview explains how your files are protected while they travel to Nimbus and while they are stored. Encryption in transit Every connection between your devices and Nimbus uses TLS 1.2 or newer, and TLS…
5. **file-size-limits.md › File size and file name limits › Maximum file size** (keyword): How big a single file can be depends on how you upload it: - Desktop app: up to 50 GB per file. - Web app: up to 5 GB per file. Use the desktop app for bigger files. - Mobile apps: up to 2 GB per file. - API: up to 50 GB per file with resum…
6. **sync-troubleshooting.md › Fix sync problems › Error codes** (keyword): The desktop app shows an error code next to files that can't sync: - NC-101: invalid file name. The name contains characters that aren't allowed on one of your devices, such as < > : " / \ | ? on Windows, or it ends with a space or a dot. R…

## u014: Can I edit a PDF in Nimbus, for example to fill in a form or sign it?

**Why it should be unanswerable:** PDFs can be previewed and documents scanned to PDF; editing Office files is via Microsoft 365 or Google Docs. Editing PDFs is not mentioned.

1. **web-app.md › Using Nimbus in your browser › Preview and edit** (vector, score 0.791): The web app previews more than 150 file types, including Office documents, PDFs, images, videos and code. To edit Word, Excel and PowerPoint files, click Open in and choose Microsoft 365 or Google Docs.
2. **integrations-and-api.md › Integrations and the Nimbus API › Built-in integrations** (vector, score 0.736): - Microsoft 365 and Google Workspace: open Word, Excel and PowerPoint files, or Google Docs, Sheets and Slides, straight from Nimbus and save changes back. - Slack and Microsoft Teams: when you paste a Nimbus link, people see a preview of t…
3. **sharing-links.md › Share files with a link › Create a link** (vector, score 0.733): 1. Right-click a file or folder and choose Share, or select it in the web app and click Share. 2. Click Create link. 3. Choose what people can do: Can view lets them see and download; Can edit lets people with a Nimbus account change the fi…
4. **security-and-encryption.md › Page 1** (keyword): How Nimbus protects your files This overview explains how your files are protected while they travel to Nimbus and while they are stored. Encryption in transit Every connection between your devices and Nimbus uses TLS 1.2 or newer, and TLS…
5. **web-app.md › Using Nimbus in your browser › Using a public or shared computer** (keyword): If you use Nimbus on a computer that isn't yours, untick Keep me signed in when you sign in, and sign out when you're done. You can sign out of all browsers at once under Settings > Security > Devices.
6. **integrations-and-api.md › Integrations and the Nimbus API › The Nimbus API** (keyword): Developers can build their own apps with the Nimbus REST API. Documentation is at developers.nimbus.example. - Apps use OAuth 2.0 to ask people for permission. Never ask users for their Nimbus password. - Each app can make up to 600 request…

## u015: Is Nimbus HIPAA compliant for storing medical records?

**Why it should be unanswerable:** Only ISO 27001, SOC 2 Type II and a DPA are mentioned.

1. **security-and-encryption.md › Page 1** (vector, score 0.8): How Nimbus protects your files This overview explains how your files are protected while they travel to Nimbus and while they are stored. Encryption in transit Every connection between your devices and Nimbus uses TLS 1.2 or newer, and TLS…
2. **getting-started.md › Getting started with Nimbus** (vector, score 0.755): Nimbus Cloud Storage keeps your files safe in the cloud and in sync across your computer, phone and the web. This guide walks you through your first ten minutes.
3. **data-export.md › Export a copy of your data** (vector, score 0.74): You can download a copy of everything Nimbus stores about you: your files, their folder structure, your account details and your activity history. This is your right under data-protection laws such as the GDPR.
4. **integrations-and-api.md › Integrations and the Nimbus API › The Nimbus API** (keyword): Developers can build their own apps with the Nimbus REST API. Documentation is at developers.nimbus.example. - Apps use OAuth 2.0 to ask people for permission. Never ask users for their Nimbus password. - Each app can make up to 600 request…
5. **getting-started.md › Getting started with Nimbus › Install the apps** (keyword): - Desktop: download the Nimbus app for Windows, macOS or Linux from nimbus.example/download. After you sign in, it creates a folder called "Nimbus" in your home folder. Anything you put in that folder is uploaded automatically. - Mobile: ge…

## u016: How many computers and phones can I connect to one account?

**Why it should be unanswerable:** Devices can be listed and signed out; no device limit is stated.

1. **desktop-app.md › Install the desktop app › System requirements** (vector, score 0.683): - Windows: Windows 10 or 11, 64-bit. - macOS: macOS 12 Monterey or later, on Apple silicon or Intel Macs. - Linux: Ubuntu 22.04 or later, Debian 12, and Fedora 39 or later. We provide .deb and .rpm packages. - At least 2 GB of free disk spa…
2. **family-plan.md › The Family plan** (vector, score 0.679): The Family plan gives up to 6 people (the organizer plus 5 members) 2 TB of storage to share.
3. **suspicious-activity.md › Suspicious sign-ins and security alerts › New sign-in emails** (vector, score 0.675): We email you whenever your account is used on a new device or browser. The email shows the device, the approximate location and the time. If it was you, there's nothing to do.
4. **mobile-app.md › Nimbus on your phone and tablet › Lost phone** (keyword): Sign out the lost device remotely from the web app under Settings > Security > Devices. Offline files on the device are removed the next time it connects.
5. **change-email.md › Change the email address on your account › Things to know** (keyword): - The new address can't already be used by another Nimbus account. If it is, delete or change that other account first. - Shared folders and links keep working; people you share with will see your new address. - Your invoices from now on sh…
6. **mobile-app.md › Nimbus on your phone and tablet › Upload from your phone** (keyword): Tap + to upload photos, take a picture, scan a document to PDF, or create a folder. Mobile uploads are limited to 2 GB per file.

## u017: Do I get free storage for inviting friends to Nimbus?

**Why it should be unanswerable:** No referral programme is mentioned.

1. **plans-and-pricing.md › Page 1** (vector, score 0.765): Plans and pricing Nimbus has four plans. Prices are in US dollars and exclude sales tax or VAT, which is added at checkout based on your country. Free - 15 GB of storage - Desktop, mobile and web apps - File version history for 30 days - Sh…
2. **getting-started.md › Getting started with Nimbus › Create your account** (vector, score 0.758): Sign up at app.nimbus.example with your email address, or use "Continue with Google" or "Continue with Apple". Every new account starts on the Free plan with 15 GB of storage. No payment card is needed to sign up. We send a confirmation ema…
3. **shared-folders.md › Shared folders › Invite people** (vector, score 0.744): 1. Right-click a folder and choose Share. 2. Enter the email addresses of the people you want to invite. 3. Choose a role for each person: - Viewer: can open and download files. - Editor: can add, change and delete files, and invite others…
4. **security-and-encryption.md › Page 1** (keyword): How Nimbus protects your files This overview explains how your files are protected while they travel to Nimbus and while they are stored. Encryption in transit Every connection between your devices and Nimbus uses TLS 1.2 or newer, and TLS…
5. **getting-started.md › Getting started with Nimbus › Install the apps** (keyword): - Desktop: download the Nimbus app for Windows, macOS or Linux from nimbus.example/download. After you sign in, it creates a folder called "Nimbus" in your home folder. Anything you put in that folder is uploaded automatically. - Mobile: ge…

## u018: Can I print a document straight from the Nimbus mobile app?

**Why it should be unanswerable:** Not mentioned.

1. **mobile-app.md › Nimbus on your phone and tablet › Requirements** (vector, score 0.771): The Nimbus mobile app works on iPhone and iPad with iOS 16 or later, and on Android 10 or later. Download it from the App Store or Google Play and sign in with your Nimbus account.
2. **mobile-app.md › Nimbus on your phone and tablet › Browse and open files** (vector, score 0.768): The app shows your whole Nimbus space. Files aren't stored on your phone until you open them, so the app uses very little space. Tap a file to preview it; documents, photos, videos and PDFs open right in the app.
3. **mobile-app.md › Nimbus on your phone and tablet › Upload from your phone** (vector, score 0.768): Tap + to upload photos, take a picture, scan a document to PDF, or create a folder. Mobile uploads are limited to 2 GB per file.
4. **security-and-encryption.md › Page 1** (keyword): How Nimbus protects your files This overview explains how your files are protected while they travel to Nimbus and while they are stored. Encryption in transit Every connection between your devices and Nimbus uses TLS 1.2 or newer, and TLS…
5. **integrations-and-api.md › Integrations and the Nimbus API › The Nimbus API** (keyword): Developers can build their own apps with the Nimbus REST API. Documentation is at developers.nimbus.example. - Apps use OAuth 2.0 to ask people for permission. Never ask users for their Nimbus password. - Each app can make up to 600 request…
6. **getting-started.md › Getting started with Nimbus › Install the apps** (keyword): - Desktop: download the Nimbus app for Windows, macOS or Linux from nimbus.example/download. After you sign in, it creates a folder called "Nimbus" in your home folder. Anything you put in that folder is uploaded automatically. - Mobile: ge…

## u019: Can I limit how much bandwidth the desktop app uses when uploading?

**Why it should be unanswerable:** Not mentioned (the API's request limit is unrelated).

1. **file-size-limits.md › File size and file name limits › Maximum file size** (vector, score 0.733): How big a single file can be depends on how you upload it: - Desktop app: up to 50 GB per file. - Web app: up to 5 GB per file. Use the desktop app for bigger files. - Mobile apps: up to 2 GB per file. - API: up to 50 GB per file with resum…
2. **camera-uploads.md › Back up photos with camera uploads › Wi-Fi and mobile data** (vector, score 0.699): By default, camera uploads only run on Wi-Fi, to save your data plan. To upload over mobile data too, turn on Use cellular data. Videos still wait for Wi-Fi unless you also turn on Upload videos over cellular.
3. **desktop-app.md › Install the desktop app › System requirements** (vector, score 0.688): - Windows: Windows 10 or 11, 64-bit. - macOS: macOS 12 Monterey or later, on Apple silicon or Intel Macs. - Linux: Ubuntu 22.04 or later, Debian 12, and Fedora 39 or later. We provide .deb and .rpm packages. - At least 2 GB of free disk spa…
4. **web-app.md › Using Nimbus in your browser › Upload files and folders** (keyword): Click Upload and pick files, or drag files and whole folders from your computer into the browser window. Uploads through the browser are limited to 5 GB per file; use the desktop app for larger files. Keep the tab open until uploads finish.
5. **integrations-and-api.md › Integrations and the Nimbus API › The Nimbus API** (keyword): Developers can build their own apps with the Nimbus REST API. Documentation is at developers.nimbus.example. - Apps use OAuth 2.0 to ask people for permission. Never ask users for their Nimbus password. - Each app can make up to 600 request…

## u020: Is there a limit on how many sharing links I can create?

**Why it should be unanswerable:** Not mentioned.

1. **sharing-links.md › Share files with a link › Link settings** (vector, score 0.756): Paid plans can add extra protection under Link settings: - Expiry date: the link stops working after the date you choose. Available on Personal, Family and Business. - Password: people must enter a password before the file opens. Available…
2. **sharing-links.md › Share files with a link › Business sharing rules** (vector, score 0.749): Business administrators can restrict links, for example to allow links only for people inside the company, or to require an expiry date on every link.
3. **sharing-links.md › Share files with a link › Stop sharing** (vector, score 0.748): To turn off a link, open Share, click the link and choose Delete link. It stops working immediately for everyone. Creating a new link gives a different address, so the old one never works again. You can see all your active links under Setti…
4. **sharing-links.md › Share files with a link › Create a link** (keyword): 1. Right-click a file or folder and choose Share, or select it in the web app and click Share. 2. Click Create link. 3. Choose what people can do: Can view lets them see and download; Can edit lets people with a Nimbus account change the fi…
5. **sharing-links.md › Share files with a link › How many people opened my link?** (keyword): On Personal, Family and Business plans, click a link in Settings > Sharing > Links to see how many times it was viewed and downloaded. Viewer names aren't shown for people without a Nimbus account.

## u021: How do I merge two Nimbus accounts into one?

**Why it should be unanswerable:** Not mentioned.

1. **delete-account.md › Delete your Nimbus account › How to delete** (vector, score 0.764): Go to Settings > Account > Delete account, enter your password and type DELETE to confirm.
2. **change-email.md › Change the email address on your account** (vector, score 0.761): You can change the email address you use to sign in to Nimbus at any time. 1. Go to Settings > Account > Email address and click Change. 2. Enter your new address and your current password. 3. We send a confirmation link to the new address,…
3. **change-email.md › Change the email address on your account › Things to know** (vector, score 0.736): - The new address can't already be used by another Nimbus account. If it is, delete or change that other account first. - Shared folders and links keep working; people you share with will see your new address. - Your invoices from now on sh…
4. **security-and-encryption.md › Page 1** (keyword): How Nimbus protects your files This overview explains how your files are protected while they travel to Nimbus and while they are stored. Encryption in transit Every connection between your devices and Nimbus uses TLS 1.2 or newer, and TLS…
5. **delete-account.md › Delete your Nimbus account › Before you delete** (keyword): - Cancel any paid plan first. If you pay through the App Store or Google Play, cancel the subscription there as well, because deleting your account does not stop the store from charging you. - Family organizers: delete or transfer the Famil…

## u022: Can I use Nimbus to host a website?

**Why it should be unanswerable:** Not mentioned.

1. **web-app.md › Using Nimbus in your browser** (vector, score 0.788): The Nimbus web app at app.nimbus.example lets you use your files on any computer without installing anything.
2. **getting-started.md › Getting started with Nimbus** (vector, score 0.765): Nimbus Cloud Storage keeps your files safe in the cloud and in sync across your computer, phone and the web. This guide walks you through your first ten minutes.
3. **getting-started.md › Getting started with Nimbus › Install the apps** (vector, score 0.751): - Desktop: download the Nimbus app for Windows, macOS or Linux from nimbus.example/download. After you sign in, it creates a folder called "Nimbus" in your home folder. Anything you put in that folder is uploaded automatically. - Mobile: ge…
4. **security-and-encryption.md › Page 1** (keyword): How Nimbus protects your files This overview explains how your files are protected while they travel to Nimbus and while they are stored. Encryption in transit Every connection between your devices and Nimbus uses TLS 1.2 or newer, and TLS…
5. **web-app.md › Using Nimbus in your browser › Using a public or shared computer** (keyword): If you use Nimbus on a computer that isn't yours, untick Keep me signed in when you sign in, and sign out when you're done. You can sign out of all browsers at once under Settings > Security > Devices.
6. **integrations-and-api.md › Integrations and the Nimbus API › The Nimbus API** (keyword): Developers can build their own apps with the Nimbus REST API. Documentation is at developers.nimbus.example. - Apps use OAuth 2.0 to ask people for permission. Never ask users for their Nimbus password. - Each app can make up to 600 request…

## u023: How do I reset the password for my Google account?

**Why it should be unanswerable:** Off-topic but close: the article covers Nimbus passwords and "Continue with Google" sign-in, not Google's own password reset.

1. **reset-password.md › Reset your password** (vector, score 0.788): If you forgot your password, you can set a new one from the sign-in page.
2. **reset-password.md › Reset your password › Signed in with Google or Apple?** (vector, score 0.742): If you created your account with "Continue with Google" or "Continue with Apple", you don't have a Nimbus password. Keep using that button to sign in, or add a password under Settings > Security.
3. **reset-password.md › Reset your password › How to reset it** (vector, score 0.728): 1. Go to app.nimbus.example and click Forgot password? 2. Enter the email address you use for Nimbus. 3. Open the email from Nimbus and click Reset password. The link works once and expires after 60 minutes. 4. Choose a new password. It mus…
4. **reset-password.md › Reset your password › Accounts that use single sign-on** (keyword): If your company signs you in through single sign-on (SSO), your password is managed by your company, not by Nimbus. The reset link won't work for these accounts. Contact your IT team instead.

## u024: What will the weather be like in London tomorrow?

**Why it should be unanswerable:** Off-topic.

1. **mobile-app.md › Nimbus on your phone and tablet › Requirements** (vector, score 0.57): The Nimbus mobile app works on iPhone and iPad with iOS 16 or later, and on Android 10 or later. Download it from the App Store or Google Play and sign in with your Nimbus account.
2. **web-app.md › Using Nimbus in your browser › Supported browsers** (vector, score 0.569): We support the latest two versions of Google Chrome, Mozilla Firefox, Apple Safari and Microsoft Edge. Other browsers may work, but we don't test them. JavaScript and cookies must be enabled.
3. **contact-support.md › Contact Nimbus support › Is Nimbus down?** (vector, score 0.567): Check status.nimbus.example for the current status of every Nimbus service and any ongoing incidents. You can subscribe there to get emails or text messages when there's a problem and when it's fixed.
4. **account-recovery.md › Recover a locked account › Start a recovery request** (keyword): 1. On the sign-in page, click Can't sign in? and then Recover my account. 2. Enter the email address on the account and, if you still can, the address you'd like to use from now on. 3. Answer the verification questions. We may ask about rec…
5. **sync-conflicts.md › Conflicted copies › What you see** (keyword): Nimbus never throws away anyone's changes. It keeps one version under the original name, and saves the other as a separate file with the device name and date in it, like this: report (Conflicted copy from Sam's laptop 2026-03-02).docx
6. **sharing-links.md › Share files with a link › Create a link** (keyword): 1. Right-click a file or folder and choose Share, or select it in the web app and click Share. 2. Click Create link. 3. Choose what people can do: Can view lets them see and download; Can edit lets people with a Nimbus account change the fi…

## u025: Can you recommend a good laptop for video editing?

**Why it should be unanswerable:** Off-topic.

1. **desktop-app.md › Install the desktop app › System requirements** (vector, score 0.593): - Windows: Windows 10 or 11, 64-bit. - macOS: macOS 12 Monterey or later, on Apple silicon or Intel Macs. - Linux: Ubuntu 22.04 or later, Debian 12, and Fedora 39 or later. We provide .deb and .rpm packages. - At least 2 GB of free disk spa…
2. **web-app.md › Using Nimbus in your browser › Preview and edit** (vector, score 0.569): The web app previews more than 150 file types, including Office documents, PDFs, images, videos and code. To edit Word, Excel and PowerPoint files, click Open in and choose Microsoft 365 or Google Docs.
3. **plans-and-pricing.md › Page 2** (vector, score 0.562): discount on Personal; see the student discount article.
4. **sync-conflicts.md › Conflicted copies** (keyword): A conflicted copy is created when the same file is changed in two places before Nimbus can sync the changes, for example when you edit a document on your laptop while offline and a colleague edits it at the same time.
5. **sync-conflicts.md › Conflicted copies › Avoid conflicts** (keyword): - For Office documents, use Open in Microsoft 365 from the web app. Several people can edit at the same time without conflicts. - Close files on one device before editing them on another. - Make sure the desktop app is running and up to dat…

## u026: Can I sync my Nimbus files to a NAS drive like a Synology?

**Why it should be unanswerable:** Only Windows, macOS and Linux desktop apps are described; NAS devices are not mentioned.

1. **selective-sync.md › Save space with selective sync and online-only files** (vector, score 0.762): You don't have to keep every Nimbus file on your computer. Two features help you save disk space.
2. **desktop-app.md › Install the desktop app** (vector, score 0.756): The Nimbus desktop app keeps a folder on your computer in sync with your Nimbus account.
3. **getting-started.md › Getting started with Nimbus** (vector, score 0.755): Nimbus Cloud Storage keeps your files safe in the cloud and in sync across your computer, phone and the web. This guide walks you through your first ten minutes.
4. **security-and-encryption.md › Page 1** (keyword): How Nimbus protects your files This overview explains how your files are protected while they travel to Nimbus and while they are stored. Encryption in transit Every connection between your devices and Nimbus uses TLS 1.2 or newer, and TLS…
5. **sync-troubleshooting.md › Fix sync problems › Error codes** (keyword): The desktop app shows an error code next to files that can't sync: - NC-101: invalid file name. The name contains characters that aren't allowed on one of your devices, such as < > : " / \ | ? on Windows, or it ends with a space or a dot. R…
6. **selective-sync.md › Save space with selective sync and online-only files › Online-only files** (keyword): With online-only files, every file and folder appears on your computer, but only takes up space when you open it. A cloud icon means the file is online-only. When you open it, Nimbus downloads it on demand, and it shows a green tick. - Righ…

## u027: Can I schedule a file to be deleted automatically on a certain date?

**Why it should be unanswerable:** Links can expire and the trash empties after 30 or 90 days; scheduled deletion of files is not mentioned.

1. **deleted-files.md › Recover deleted files › How long deleted files are kept** (vector, score 0.693): - Free plan: 30 days in the trash - Paid plans: 90 days in the trash After that, files are permanently deleted. Files in the trash still count toward your storage.
2. **deleted-files.md › Recover deleted files** (vector, score 0.691): When you delete a file or folder, it goes to the trash first, so you can get it back if you change your mind.
3. **delete-account.md › Delete your Nimbus account › The 30-day grace period** (vector, score 0.679): Your account is deactivated immediately: you're signed out everywhere, links stop working and shared folders are no longer available to others. For 30 days you can still change your mind: sign in and click Restore my account, and everything…
4. **file-size-limits.md › File size and file name limits › Maximum file size** (keyword): How big a single file can be depends on how you upload it: - Desktop app: up to 50 GB per file. - Web app: up to 5 GB per file. Use the desktop app for bigger files. - Mobile apps: up to 2 GB per file. - API: up to 50 GB per file with resum…
5. **deleted-files.md › Recover deleted files › Files deleted by someone else** (keyword): If someone deletes a file in a folder you share, it goes to their trash and yours. Business administrators can also restore files that a team member deleted, for up to 90 days, from the admin console.

## u028: Is there a Nimbus app for Apple Watch or smart TVs?

**Why it should be unanswerable:** Only iPhone, iPad and Android phones and tablets are mentioned.

1. **mobile-app.md › Nimbus on your phone and tablet › Requirements** (vector, score 0.78): The Nimbus mobile app works on iPhone and iPad with iOS 16 or later, and on Android 10 or later. Download it from the App Store or Google Play and sign in with your Nimbus account.
2. **getting-started.md › Getting started with Nimbus › Install the apps** (vector, score 0.733): - Desktop: download the Nimbus app for Windows, macOS or Linux from nimbus.example/download. After you sign in, it creates a folder called "Nimbus" in your home folder. Anything you put in that folder is uploaded automatically. - Mobile: ge…
3. **web-app.md › Using Nimbus in your browser › Supported browsers** (vector, score 0.729): We support the latest two versions of Google Chrome, Mozilla Firefox, Apple Safari and Microsoft Edge. Other browsers may work, but we don't test them. JavaScript and cookies must be enabled.
4. **security-and-encryption.md › Page 1** (keyword): How Nimbus protects your files This overview explains how your files are protected while they travel to Nimbus and while they are stored. Encryption in transit Every connection between your devices and Nimbus uses TLS 1.2 or newer, and TLS…
5. **integrations-and-api.md › Integrations and the Nimbus API › The Nimbus API** (keyword): Developers can build their own apps with the Nimbus REST API. Documentation is at developers.nimbus.example. - Apps use OAuth 2.0 to ask people for permission. Never ask users for their Nimbus password. - Each app can make up to 600 request…

## u029: Do you have an office where I can get help in person?

**Why it should be unanswerable:** Support channels are online (help centre, email, chat, phone); no in-person help is mentioned.

1. **contact-support.md › Contact Nimbus support › Support by plan** (vector, score 0.668): - Free: the help centre and the community forum. Our team answers account and billing questions by email. - Personal and Family: email support, with a reply within 24 hours, 7 days a week. - Business: 24/7 live chat and phone support. Urgen…
2. **contact-support.md › Contact Nimbus support › How to reach us** (vector, score 0.651): Click Help in the app or go to help.nimbus.example and click Contact support. Sign in first, so we can see your plan and help you faster.
3. **refunds.md › Refund policy › How to ask for a refund** (vector, score 0.63): Go to Settings > Billing, find the payment and click Request refund, or contact support. Refunds for Business plans are handled by the account owner.
4. **plans-and-pricing.md › Page 1** (keyword): Plans and pricing Nimbus has four plans. Prices are in US dollars and exclude sales tax or VAT, which is added at checkout based on your country. Free - 15 GB of storage - Desktop, mobile and web apps - File version history for 30 days - Sh…
5. **family-plan.md › The Family plan › Invite someone** (keyword): The organizer goes to Settings > Family > Invite member and enters an email address. The invitation is valid for 14 days. Members must be at least 13 years old (16 in some EU countries). A person can belong to only one Family plan at a time…
6. **change-plan.md › Upgrade or downgrade your plan › Moving from Personal to Family** (keyword): Upgrading from Personal to Family keeps all your files. You become the Family organizer and can invite up to 5 more people.

## u030: Is there a tool to import all my files from Google Drive into Nimbus?

**Why it should be unanswerable:** Integrations open Google Docs and connect via Zapier; importing or migrating from another storage service is not mentioned.

1. **data-export.md › Export a copy of your data** (vector, score 0.768): You can download a copy of everything Nimbus stores about you: your files, their folder structure, your account details and your activity history. This is your right under data-protection laws such as the GDPR.
2. **integrations-and-api.md › Integrations and the Nimbus API › Built-in integrations** (vector, score 0.761): - Microsoft 365 and Google Workspace: open Word, Excel and PowerPoint files, or Google Docs, Sheets and Slides, straight from Nimbus and save changes back. - Slack and Microsoft Teams: when you paste a Nimbus link, people see a preview of t…
3. **getting-started.md › Getting started with Nimbus › Install the apps** (vector, score 0.734): - Desktop: download the Nimbus app for Windows, macOS or Linux from nimbus.example/download. After you sign in, it creates a folder called "Nimbus" in your home folder. Anything you put in that folder is uploaded automatically. - Mobile: ge…
4. **security-and-encryption.md › Page 1** (keyword): How Nimbus protects your files This overview explains how your files are protected while they travel to Nimbus and while they are stored. Encryption in transit Every connection between your devices and Nimbus uses TLS 1.2 or newer, and TLS…
5. **file-size-limits.md › File size and file name limits › Maximum file size** (keyword): How big a single file can be depends on how you upload it: - Desktop app: up to 50 GB per file. - Web app: up to 5 GB per file. Use the desktop app for bigger files. - Mobile apps: up to 2 GB per file. - API: up to 50 GB per file with resum…
6. **sync-troubleshooting.md › Fix sync problems › Error codes** (keyword): The desktop app shows an error code next to files that can't sync: - NC-101: invalid file name. The name contains characters that aren't allowed on one of your devices, such as < > : " / \ | ? on Windows, or it ends with a space or a dot. R…
