# Security Policy

## Reporting a vulnerability

Use GitHub's private vulnerability reporting. Go to the repository's
**Security** tab and click **Report a vulnerability**, or open a new advisory
directly at
<https://github.com/Vadoid/open-lakehouse-demo/security/advisories/new>.

That keeps the report private until a fix is ready. Please don't open a public
issue for a security problem.

## What this project is

This is a local teaching demo that runs on a laptop, not a production
deployment. Several things that would be flaws in production are deliberate
here so the stack comes up with zero config:

- Lakekeeper runs `authz: allow-all` (no auth, no IdP).
- MinIO and Spark use static demo credentials baked into the compose stack.
- Nothing speaks TLS; everything is plain HTTP on localhost.

Those are intentional trade-offs for a single-host demo, not vulnerabilities.
The README's Caveats and Production hardening sections spell out what you'd
change to take it real.

If you're looking for genuine security surface worth reporting, the more
interesting areas are:

- the webapp's server routes under `webapp/` (the Next.js app does all the I/O),
- how the GCS service-account key is generated, stored (`.demo-state/`), and
  passed around in GCS mode.

## Supported versions

Only `main` is supported. There are no tagged releases or backports; fixes land
on `main`.
