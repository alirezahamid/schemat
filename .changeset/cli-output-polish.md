---
"@schemat/cli": patch
---

Give the CLI colour, symbols and a readable visual hierarchy — presentation only, no behaviour change.

- Success, warning and error states share one symbol and colour vocabulary
  across every command, so `snapshot`, `init`, `check`, `diff`, `export` and
  `dev` no longer each invent their own prefix.
- `check` and `diff` colour additions green, removals red and modifications
  yellow, on top of the renderer's existing `+`/`-`/`~` markers. The renderer
  still emits plain text; the CLI styles it as a post-processing pass.
- `snapshot` and `export` lead with the path written and drop counts to a muted
  second line, with correct singular/plural (`1 relation`, not `1 relations`).
- `dev` prints a calm startup banner with the URL and watch root, then one line
  per rebuild instead of per-file noise.
- Errors are structured as headline, detail, then suggestion — including
  multi-line messages from an underlying parser, which are no longer bolded as
  a single wall of text.
- Colour is decided per stream, so redirecting stdout does not change how stderr
  is styled. `NO_COLOR` (any value), `FORCE_COLOR` (including `0`) and
  `TERM=dumb` are all honoured, and symbols fall back to ASCII outside a UTF-8
  locale.
- `--format json` and `--format markdown` stay byte-clean even when colour is
  forced on, and copy-pasteable `schemat …` suggestions never carry escape
  sequences, so pasting one from coloured output runs verbatim.
