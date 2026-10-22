# How Nimbus protects your files

This overview explains how your files are protected while they travel to Nimbus and while they are stored.

## Encryption in transit

Every connection between your devices and Nimbus uses TLS 1.2 or newer, and TLS 1.3 wherever your device supports it. This includes the desktop and mobile apps, the web app and the API.

## Encryption at rest

Files are split into blocks and each block is encrypted with AES-256 before it is written to disk. Encryption keys are stored separately from the data, in a hardware security module, and are rotated regularly.

## Data centres and data residency

Nimbus stores data in two regions: the European Union (Frankfurt, Germany) and the United States (Virginia). Personal, Family and Free accounts are stored in the region closest to where you signed up. Business customers choose the region when they create the team, and all of the team's files stay in that region. The region cannot be changed later.

## Who can see your files

Nimbus staff cannot browse your files. A small number of engineers can access stored data only during a documented investigation that you have approved, for example when you ask support to look at a broken file, and every access is logged.

Standard encryption means Nimbus manages the keys. This lets us show previews, search inside documents and recover your account if you lose your password.

## Nimbus Vault: end-to-end encryption

For your most sensitive files, use Nimbus Vault, available on Personal, Family and Business plans. Files in the Vault are encrypted on your device with a key that only you hold, so not even Nimbus can read them. Because we never have the key, we cannot recover Vault files if you forget your Vault passphrase, and previews and search don't work inside the Vault.

## Certifications

Nimbus is audited every year against ISO 27001 and SOC 2 Type II. Business customers can request the reports and sign a data processing agreement (DPA) in the admin console.
