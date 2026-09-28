# Security

## Reporting a vulnerability

Please report security problems privately through
[GitHub's private vulnerability reporting](https://github.com/sezginkipel/clayform/security/advisories/new),
not in a public issue. Include what you found, how to reproduce it, and which version you used.

You will get a reply within a few days. Once a fix is released, the advisory is published with
credit to you unless you prefer otherwise.

## What Clayform does on your machine

Knowing this helps judge whether something is a vulnerability:

- The MCP server talks over stdio only. It opens no network port.
- It reads and writes scene files under its workspace (`./.clayform` or `--workspace`). `export`
  writes to the path you give it. The `mesh` shape and `compare_reference` read the files you name.
- `clayform view` serves the model on `127.0.0.1` only, and the page loads three.js from jsDelivr.
- It runs no shell commands and evaluates no code from scene files.

## Supported versions

Fixes go into the latest release.
