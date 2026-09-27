# Contributing

Thanks for helping. A few rules keep Clayform useful for agents:

1. **Agents are the users.** Every error message names the part or op and says how to fix it.
   Every new schema field has a `describe()` that an agent can act on, and a line in `src/guide.ts`.
2. **Prove critics.** A new critic ships with a test that builds the defect on purpose and
   checks that it is caught. All templates must stay free of errors and warnings (`src/test/critics.test.ts`).
3. **No fake output.** README images come from `scripts/`, and no benchmark claims are made
   without a published run.
4. **Hot paths don't allocate.** `primDist`, `noise3` and the field evaluation run millions of
   times per build. Measure before and after changing them.
5. **glTF stays valid.** `npm test` runs the Khronos validator on static, skinned and animated exports.

## Setup

```bash
npm install
npm test
npm run check
```

Templates live in `src/templates/index.ts`. After editing one, run
`npx tsx scripts/gallery.ts` and look at `docs/gallery.png`.
