---
name: Bug report
about: Something in the demo stack broke or didn't behave as documented
title: ''
labels: bug
assignees: ''
---

## What happened

A clear description of the problem.

## Steps to reproduce

1.
2.
3.

## What you expected

What should have happened instead.

## Deploy mode

- Storage: MinIO / GCS
- Flink: on / off
- Ran via: `./deploy.sh` / `RUN_DEMO=1 ./deploy.sh` / manual `terraform`

## Logs

`deploy.sh` output and any relevant container logs (`docker logs spark-thrift`,
`lakekeeper`, `flink-jobmanager`, `demo-webapp`, ...). Trim to the part that
shows the failure.

```
paste logs here
```

## Environment

- OS:
- Docker (Desktop / Engine) version:
- Terraform version:
