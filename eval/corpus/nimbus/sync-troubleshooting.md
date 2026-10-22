# Fix sync problems

If files aren't syncing between your computer and Nimbus, work through these steps. Most problems are fixed in the first two.

## Check the status icon

Click the Nimbus icon in the menu bar (Mac) or system tray (Windows):

- **Green tick:** everything is up to date.
- **Blue arrows:** files are syncing. Large uploads can take a while on a slow connection.
- **Pause symbol:** sync is paused. Click **Resume syncing**.
- **Red cross:** something needs your attention. Click it to see which files have a problem and why.

## Basic fixes

1. Check your internet connection by opening app.nimbus.example in a browser.
2. Quit Nimbus completely and open it again.
3. Make sure you're signed in to the right account under **Preferences > Account**.
4. Check that the computer has enough free disk space. Nimbus needs at least 1 GB free to sync.
5. Update the app to the latest version.

## Error codes

The desktop app shows an error code next to files that can't sync:

- **NC-101: invalid file name.** The name contains characters that aren't allowed on one of your devices, such as < > : " / \ | ? * on Windows, or it ends with a space or a dot. Rename the file.
- **NC-204: file too large.** The file is bigger than the maximum file size. Split or compress it.
- **NC-403: permission denied.** You have view-only access to a shared folder, so your changes can't be uploaded. Ask the owner for edit access, or save your copy somewhere else. NC-403 can also appear when the operating system blocks Nimbus from reading the file; check that the file isn't open in another program.
- **NC-507: storage full.** Your Nimbus account has no space left. Empty the trash, delete files or upgrade.
- **NC-610: path too long.** The full path of the file is longer than 260 characters on Windows. Move the file to a folder nearer the top, or shorten folder names.

## Firewalls, proxies and antivirus

Nimbus needs to reach *.nimbus.example on port 443. If you're on a company network, ask your IT team to allow it. Some antivirus programs scan every file Nimbus writes, which slows syncing down a lot; add your Nimbus folder to the antivirus exclusions.

## Rebuild the sync cache

If files still don't sync, rebuilding the local cache usually fixes it. Go to **Preferences > Advanced > Rebuild sync cache**. Nimbus compares every file on your computer with the cloud again. Your files are not deleted, but this can take an hour or more for large folders.

## Still stuck?

Go to **Preferences > Help > Send diagnostic report** and contact support with the report ID. Reports contain file names and error logs, but never the contents of your files.
