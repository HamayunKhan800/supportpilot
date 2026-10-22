# File size and file name limits

## Maximum file size

How big a single file can be depends on how you upload it:

- **Desktop app:** up to 50 GB per file.
- **Web app:** up to 5 GB per file. Use the desktop app for bigger files.
- **Mobile apps:** up to 2 GB per file.
- **API:** up to 50 GB per file with resumable uploads.

There's no limit on the number of files, only on your total storage. Files over the limit show error NC-204 in the desktop app.

## File names

- File and folder names can be up to 255 characters long.
- Names can't contain / and can't be "." or "..".
- Windows doesn't allow < > : " / \ | ? * in names, or names that end with a space or a dot. If you sync with a Windows computer, avoid these characters or the file will show error NC-101 there.
- Names are not case-sensitive: "Report.docx" and "report.docx" can't be in the same folder.

## File types

You can store any type of file. We don't block file types, but for safety, previews aren't shown for executable files such as .exe and .dmg.
