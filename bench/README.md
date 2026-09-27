# Bench: Clayform vs. other agent 3D tools

A fixed set of 20 prompts (`prompts.json`) covering characters, creatures,
vehicles, buildings, weapons, props, nature, animation and effects.

**No results are published yet.** This folder is the protocol, not a claim.

## Protocol

1. **Same agent, same prompts.** Run one model (e.g. Claude) with the same system
   prompt and the same turn budget (30 tool calls) in two setups:
   - A: Clayform MCP (`clayform mcp`)
   - B: the tool under comparison (e.g. [blender-mcp](https://github.com/ahujasid/blender-mcp) with Blender open)
2. **Save the outputs.** Clayform: `export` with format `json` to
   `<run>/clayform/<id>.clay.json`. B: export GLB per prompt.
3. **Measure.** `npx tsx scripts/bench.ts <run>/clayform` writes `report.md` (critic
   errors/warnings, triangle count at the 5,000 budget, expected clips/effects
   present) and identical renders in `renders/`.
4. **Render B identically.** Front + three-quarter, 384 px tiles, neutral background.
5. **Judge blind.** For each prompt show the two sheets side by side in random
   order to at least three judges who do not know which tool made which. They pick
   the one that better matches the prompt and would be usable in a game, or "tie".
6. **Report everything**: per-prompt picks, ties, failures, turn counts, wall time.
   Publish the raw outputs with the report.

The success bar set before running: Clayform is preferred in at least 70% of
non-tie pairs **and** has zero critic errors on the prompts it completes.
