# Security

Vdex has no server and no accounts. Everything lives on your device and in the cloud storage you choose to link, so security is about the device, that storage, and the app code itself.

## What protects your data

| Risk | What Vdex does |
|---|---|
| Someone picks up your unlocked phone or laptop | Set a PIN under Settings → Security; add fingerprint / face unlock if your device offers it. Vdex locks when you leave it (straight away, or after 1, 5 or 15 minutes) and the 🔒 button locks it at once. |
| The device is stolen or its storage is copied | With a PIN set, the database and the cloud sign-ins are encrypted (AES-256-GCM) whenever Vdex is locked, in the background or closed. The PIN is never stored; a key derived from it (PBKDF2-SHA-256, 300,000 iterations) wraps the data key. Wrong PINs are rate-limited; you can choose to wipe after 10. |
| The device is lost or breaks | Link a cloud storage: it syncs continuously and writes a dated backup once a day (one per weekday, one per month). Export backups too; the encrypted kind takes a passphrase. Settings shows the age of the last off-device copy. |
| Kit is stolen | Equipment → Asset register exports serial numbers and values for the insurer and the police. |
| A malicious script or supply-chain change | A Content Security Policy limits where code can come from; the two run-time libraries are pinned with integrity hashes; the DOM is built from text, never from HTML strings with user data. |
| A forged sign-in return | Dropbox sign-in uses PKCE and a random state checked on return; Google and Microsoft use their own libraries' pop-ups. |

## What it does not protect

- The copy in your cloud storage is plain JSON, protected by that account. Use a strong password and two-factor sign-in there.
- The phone-to-laptop link trusts whoever scanned the code: pair only with your own devices.
- A 4-digit PIN can be brute-forced offline by someone who copied the device's storage. Use 6 or more digits, and keep the device's own lock on.
- Nothing in a browser can stop someone who controls the device at the operating-system level.

## Reporting a problem

Open an issue on the repository, or email the maintainer privately if the problem would put users at risk before a fix is out.
