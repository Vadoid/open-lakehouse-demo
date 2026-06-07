# Contributing

Thanks for taking a look. This is a teaching demo, so the bar for changes is a
little different from a production library: clarity beats cleverness, and a
change that makes the V3 story easier to follow is worth more than one that
shaves a few seconds off a build.

## Before you start

Open an issue first if you're planning anything bigger than a typo or a doc
tweak. It saves both of us the awkward moment where a finished PR turns out to
duplicate something already half-built on a branch, or to pull the demo in a
direction it isn't meant to go.

Good things to send:

- Bug fixes in `deploy.sh` / `destroy.sh` / `scripts/bootstrap.sh`, especially
  the fresh-VM edge cases in the Troubleshooting section.
- New `sql/demo.sql` steps that show off a V3 feature the demo doesn't cover yet.
- Webapp fixes (the Next.js app under `webapp/`).
- Doc corrections. If the README says one thing and the code does another, the
  code usually wins, but flag it either way.

Things that probably don't fit: turning this into a framework, adding a second
catalog or query engine just because, or pulling in heavy dependencies. When in
doubt, ask.

## Running it locally

```bash
./deploy.sh          # bring the stack up empty
./destroy.sh         # tear it down
```

You need `docker`, `terraform >= 1.5`, and `curl`. First Spark start downloads
the Iceberg jars from Maven, so give it a minute before the Thrift Server
answers on `:10000`. The README's Run section has the full story, including the
`RUN_DEMO=1` shortcut and the GCS path.

If you're touching SQL, run the step you changed through the webapp at `:3030`
and watch the right pane (object store, catalog, snapshot log). That's the
fastest way to see whether the change actually did what you think it did.

## Making changes

- Keep the diff focused. One idea per PR.
- Match the surrounding style. The shell scripts lean defensive (they probe and
  recover); the SQL is commented step by step; the README prose is meant to read
  like a person wrote it, not a model. Keep it that way.
- If you add or renumber a `sql/demo.sql` step, update the matching webapp page
  and the "What the demo shows" list in the README so the count stays honest.
- Pin versions deliberately. Bumping Spark, Iceberg, or Lakekeeper can break the
  warehouse bootstrap JSON shape, so test a full `./deploy.sh` before you claim a
  bump works.

## Commits and PRs

Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`) keep the history
readable, but I care more about a clear message than perfect prefixes. Say what
changed and why. In the PR description, mention how you tested it: a clean
`deploy.sh`, the step you ran, the VM or OS you were on.

Use whatever tools help you, LLMs and AI coding assistants included. I do too.
The only thing I ask is that you read your own PR before I do. Generated code is
fine; unread generated code is not. If you can't explain what a hunk does or why
it's there, it isn't ready. Keep the PR small enough to actually review, drop the
filler the model adds, and make sure it runs.

No CLA, no template to fill out. Be decent in the issue tracker and assume the
other person is too.

## License

By contributing you agree your work is released under the
[Apache License 2.0](LICENSE) that covers the rest of the repo.
