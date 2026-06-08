# Changelog

A high-level, themed view of what's changed in this demo, newest first. This is
a curated highlights list, not a per-commit log — it gets updated when a notable
feature lands. For the full detail, read the [commit history](https://github.com/Vadoid/open-lakehouse-demo/commits/main)
and [CONTRIBUTING.md](CONTRIBUTING.md).

## Flink streaming engine (additive second engine)

Apache Flink 1.20 joins the stack as a second engine on the same Lakekeeper
catalog and object store as Spark, on by default. It runs a button-triggered,
format-version 3 `datagen → Iceberg` stream into `demo.market.trades_stream`,
with GCS support, a temporal join against the batch table, a step 19 page that
shows the live interop, a Flink health pill, and a SQL Console.
(`3a69896`, `45dc27e`, `7b8ffe5`, `37dd722`, `0abc17e`, `123a9e3`)

## Swappable storage: MinIO or GCS

The warehouse can point at MinIO (the offline default) or Google Cloud Storage,
picked from a first-run setup screen with no redeploy. The whole UI and lineage
graph relabel for the active target, and GCS uses Lakekeeper's vended
credentials so no service-account key reaches Spark.
(`d71babc`, `dba780f`, `0685bb3`, gcs-sandbox merge `a002edb`)

## Apache-2.0 relicense

Relicensed to Apache License 2.0, with a NOTICE file for third-party
attributions and a trademark note for the Apache marks. (`7d6ddc9`)

## Webapp UX overhaul

The step pages moved to a roomier 8:4 column layout with tabbed metadata panels
and an onboarding guard, plus light-theme fixes on the lineage and storage
views. (`023fdfd`, ui-improvements merge `e3a2864`)
