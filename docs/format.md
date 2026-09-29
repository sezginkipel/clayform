# Format stability

Scene files say which format they are written in: `"format": "clayform/1"`. From release 0.9.0
on, that format is frozen.

## The promise

- **A document that is valid `clayform/1` today stays valid and builds the same model** in every
  later Clayform.
- **New optional fields can still be added** within `clayform/1`. Old documents do not use them,
  so nothing changes for them. A document that uses a new field needs a Clayform that knows it:
  older versions reject fields they do not know instead of silently dropping them.
- **Anything else bumps the format.** Removing or renaming a field, changing a default, or changing
  what a value means makes `clayform/2`. That release ships a migration, and older files are
  upgraded on the way in. The upgrade is reported, and `clayform migrate` writes it to disk.

Layout files (`clayform-layout/1`) and style sheets (`clayform-style/1`) make the same promise, and
the frozen corpus below includes one of each. Only scenes run through a migration chain today;
layouts and styles get one the first time either format has to change.

## How it is enforced

The test suite keeps a frozen copy of everything Clayform shipped when the format was frozen:
all 43 templates of that release, the README's goblin, the example layout and the example style sheet
([`src/test/fixtures/clayform-1.json`](../src/test/fixtures/clayform-1.json)). Every release
must parse and build each of them. The fixture file is never edited. A new format gets a corpus
file of its own next to it.

Migrations live in [`src/core/migrate.ts`](../src/core/migrate.ts). Each one is a small function
from one format to the next, and a document written in an old format walks the chain step by step.
The chain is tested with a made-up older format, so the machinery is proven before it is first
needed.

## Upgrading a file

```bash
clayform migrate old.clay.json            # rewrites the file in place if it needs upgrading
clayform migrate old.clay.json -o new.clay.json
```

A file from a newer Clayform is refused with a message saying so, rather than half-read.
