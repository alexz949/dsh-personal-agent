# Contributing

Thanks for helping. A few things keep this project easy to work on:

- **Run the tests.** `npm run build && npm test`. Tests use no network and none of your settings; add one for any behavior you change.
- **Keep personal data out.** No real names, addresses, accounts, course names or file paths in code, tests, fixtures or screenshots. Use `example.com` / `example.edu` and made-up people.
- **Mind the helper app.** Changing `helper/main.swift` or `helper/Info.plist` changes its code signature, and macOS may ask users for Calendar, Reminders, Notes and Mail access again. Put validation and wording in `src/apple.js` when you can.
- **Ask before acting.** New tools that change user data should either ask through a DSH confirmation card or be limited to one clearly named target (one list, one folder, one file), and must write to the action log. Nothing may send email, move money or delete user data.
- **Persona text** lives in `cordis.patch.yml`. It is Chinese for now; an English version is welcome.
