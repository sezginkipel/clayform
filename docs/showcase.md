# Showcase rules

The [showcase](https://clayform.sadelabs.site/showcase) lists real projects that use Clayform.
Adding yours takes a few minutes.

## Two ways to send it

- **Fill in the form.** [Open a showcase issue](https://github.com/sezginkipel/clayform/issues/new?template=showcase.yml),
  answer six questions and drop in a picture. We turn it into an entry.
- **Open a pull request.** Add two files to `docs/showcase/`: `<your-project>.json` and the
  picture it names. The test suite checks the entry, and the site shows it after it is merged.

## What an entry holds

```json
{
  "name": "Cargo Century",
  "url": "https://cargocentury.sadelabs.site",
  "by": "SadeLabs",
  "byUrl": "https://sadelabs.site",
  "summary": "One or two sentences for someone who has never heard of it.",
  "clayform": "What Clayform made in it: which models, animations or effects, and roughly how many.",
  "image": "cargo-century.png",
  "imageAlt": "What the picture shows, for people who cannot see it.",
  "repo": "https://github.com/… (optional)",
  "tags": ["game", "browser"],
  "added": "2026-09-29"
}
```

Links are `https`. The file name and picture name use lowercase letters, digits and dashes. The
picture is a PNG under 1.5 MB, and wide pictures look best (about 2:1).

## What gets listed

- The project is public and the link works without signing in.
- Clayform made something you can see in it: models, animations or effects.
- You made it, or you have permission to share it.
- The description says what the project is, in plain words. No invented numbers or quotes.

Anything unsafe for work, or anything that impersonates someone else, is not listed. If you
want your project taken off the showcase, open an issue or a pull request that removes it, and
it comes off.
