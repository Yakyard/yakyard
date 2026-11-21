Yakyard logo files. All are full-color SVGs with fixed fills (no currentColor), so they look the same anywhere.

- `yakyard-app-icon.svg`: indigo rounded tile with the horned bubble. App icons, favicons, avatars, social profiles.
- `yakyard-lockup.svg`: tile plus wordmark. Default sign-off on `paper` or `surface`.
- `yakyard-wordmark.svg`: indigo letters, red second "y". Light grounds only.
- `yakyard-wordmark-reverse.svg`: paper letters, yellow second "y". On `night` or `yak-indigo`.
- `yakyard-mark.svg`: the bubble and horns alone with `night` dots. Stickers, loaders, empty states on `paper`, `surface` or `night`.

Clear space is one horn height on every side. Minimum sizes: app icon 16px, lockup 96px wide, wordmark 72px wide. There is no reverse lockup yet; on dark grounds pair the app icon with the reverse wordmark.

As an `<img>`, give it `alt="Yakyard"`. Inlined, add `role="img" aria-label="Yakyard"` to the `<svg>`. Inside a heading, the heading carries the name.
