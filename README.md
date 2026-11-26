# Open Lakehouse: New Features and Add-ons

This file documents additions made on top of the original project guide in
[README_Open_Lakehouse.md](README_Open_Lakehouse.md). See that guide for the
lakehouse architecture, Linux/macOS deployment, demo walkthrough, and existing
component details.

The additions described here are opt-in where applicable. The lakehouse core
remains independently deployable and is not changed when optional ML services
are started or stopped.

## Native Windows deployment

The project can run on Windows with Docker Desktop's Linux container engine,
Terraform 1.5 or later, and PowerShell 7 (Windows PowerShell 5.1 is also
supported). A separately managed WSL distribution or VirtualBox is not
required. Start Docker Desktop, then open PowerShell in the repository folder:

```powershell
.\deploy.ps1                         # Start Spark and Flink
.\deploy.ps1 -SparkOnly              # Start without Flink
.\deploy.ps1 -Jupyter                # Also enable optional JupyterLab
.\deploy.ps1 -Superset               # Start core + optional Apache Superset
.\deploy.ps1 -All                    # Start core + all optional add-ons
.\deploy.ps1 --all                   # Same full deployment using double-dash syntax
.\deploy.ps1 -RunDemo                # Also execute sql/demo.sql
.\destroy.ps1                        # Remove the local lakehouse stack
.\destroy.ps1 -All                   # Remove core + optional service containers
```

`-All` enables Flink and Jupyter in the core Terraform deployment, then starts
the independent Superset, MLflow, and portal Compose projects. Each add-on
keeps its own data volumes. The default `deploy.ps1` command remains a core
deployment and does not start optional services.

On Linux or macOS, use `./deploy.sh --superset` to start Superset by itself, or
`./deploy.sh --all` for the equivalent full deployment.
Running `./deploy.sh` without `--all` keeps the existing core deployment flow.

Windows uses `scripts/bootstrap.ps1`; Linux and macOS continue using the Bash
launcher and bootstrap. Docker Desktop must be using Linux containers. The
PowerShell deployment script handles Windows bind-mount paths and selects the
Windows bootstrap script. Existing Unix deployment commands remain documented
in [README_Open_Lakehouse.md](README_Open_Lakehouse.md).

## Optional JupyterLab

JupyterLab is a separate, opt-in container. It joins the lakehouse Docker
network and persists notebooks in `notebooks/`:

```powershell
.\deploy.ps1 -Jupyter
```

Open [JupyterLab](http://localhost:8888/lab). Token authentication is the
default; retrieve its login token with:

```powershell
docker logs lake-jupyter 2>&1 | Select-String -Pattern 'token='
```

Choose password authentication explicitly at deployment. The script prompts
for the password without echoing it and creates the hash inside the Jupyter image:

```powershell
.\deploy.ps1 -Jupyter -JupyterAuth Password
```

For the full deployment, use `.\deploy.ps1 -All -JupyterAuth Password`. Token
remains the default with `-Jupyter` or `-All`. On Linux/macOS, run
`./deploy.sh --jupyter-auth password` (or add `--all`); use
`--jupyter-auth token` to choose token explicitly. Terraform marks the hash
input sensitive, but state still records container configuration, so keep
local state files private and out of version control.

```bash
./deploy.sh --jupyter-auth password
```

Use the Jupyter server's Python kernel when running notebooks that need to
reach lakehouse services. From a container on the `lakedemo` network, Spark
Thrift is available as `spark-thrift:10000`; use the configured Lakekeeper and
object-store endpoints supplied in the Jupyter environment. Jupyter is not
required by the core deployment.

## Optional Apache Superset

Apache Superset runs as a separate Compose add-on with its own PostgreSQL
metadata database. It does not modify the lakehouse core. To deploy it with the
core stack on Windows:

```powershell
.\deploy.ps1 -Superset
```

On Linux or macOS, use `./deploy.sh --superset`. Both commands also start the
core lakehouse so Superset can join the `lakedemo` Docker network. Superset is
also included in `-All` / `--all` deployments.

Open [Apache Superset](http://localhost:8088). The local demo login defaults
are:

- Default username: `admin`
- Default password: `admin`

To reset the password for the existing `admin` user, run this from the
repository root; Superset prompts for the new password without echoing it:

```powershell
docker exec -it superset superset fab reset-password --username admin
```

To configure credentials before the first start, put these values in the
repository-root `.env` file (which is ignored by Git):

```text
SUPERSET_ADMIN_PASSWORD=choose-a-local-password
SUPERSET_DB_PASSWORD=choose-a-local-database-password
SUPERSET_SECRET_KEY=choose-a-long-random-secret
```

Keep the same values for later starts because Superset and PostgreSQL retain
their state in Docker volumes. This Compose setup binds the web UI to localhost
and is intended for local development; change the default credentials and
secret before exposing it to other machines.

### Connect Superset to Spark Thrift

In Superset, open **Settings → Data → Database Connections → + Database** and
select **Apache Spark SQL**. The custom Superset image includes PyHive. Use this
SQLAlchemy URI because Superset runs in Docker on the same network as Spark:

The SQLAlchemy URI is a connection string that tells Superset which database
service to contact and how. In this URI, `hive` names the HiveServer2 protocol
(Spark Thrift speaks that protocol), `spark-thrift` is the Docker service name,
`10000` is the Thrift port, and `default` is the initial database:

```text
hive://hive@spark-thrift:10000/default
```

Test and save the connection. Then choose **Data → Datasets → + Dataset**,
select the Spark database, schema, and table, and use the dataset to browse
rows or create charts. Spark Thrift must be running, and the table must already
exist in the Iceberg catalog. The Spark endpoint uses HiveServer2 on port
`10000`; it is not an HTTP page.

The Superset server starts with one web worker and a 2 GB memory limit for this
local demo. Tune it before deployment with `SUPERSET_WEBSERVER_WORKERS`,
`SUPERSET_SERVER_CPUS`, or `SUPERSET_SERVER_MEM_LIMIT` in the repository-root
`.env` file. `destroy.ps1` and `destroy.sh` stop Superset before removing the
shared Docker network and preserve its metadata database volume.

To stop only Superset and keep its database and uploaded files, run:

```powershell
docker compose -p superset -f .\superset\compose.yaml down
```

## Optional MLflow Tracking and Model Registry

MLflow runs as a separate Docker Compose project. It provides the open-source
Tracking API and UI plus a database-backed Model Registry. Its PostgreSQL
database and artifact volume are separate from the lakehouse database and
object store. Start the core lakehouse first so its `lakedemo` network exists.

From PowerShell in the repository root, optionally set a local database
password, then start MLflow:

```powershell
$env:MLFLOW_DB_PASSWORD = 'ChooseALocalPassword123'
docker compose -p mlflow -f .\mlflow\compose.yaml up -d
docker compose -p mlflow -f .\mlflow\compose.yaml ps
```

Open the [MLflow UI](http://localhost:5000) to see experiments and registered
models. Use `http://mlflow:5000` as the tracking URI from Jupyter containers on
the Docker network, and `http://localhost:5000` from a Python process running
on the Windows host.

The local configuration starts MLflow with **one worker** and limits its
container to 1 CPU and 1 GB RAM. The separate MLflow PostgreSQL container is
limited to 0.5 CPU and 768 MB RAM. Measure resource use before increasing
worker count or limits:

```powershell
docker stats --no-stream mlflow mlflow-db
```

If measurements show the MLflow server needs more resources, adjust only its
settings for the current PowerShell session and recreate the service:

```powershell
$env:MLFLOW_SERVER_WORKERS = '2'
$env:MLFLOW_SERVER_CPUS = '2.0'
$env:MLFLOW_SERVER_MEM_LIMIT = '2g'
docker compose -p mlflow -f .\mlflow\compose.yaml up -d
```

Unset these variables to return to Compose defaults. MLflow attaches to the
core's external Docker network. On Windows, `destroy.ps1` stops the MLflow
Compose project before removing that network and preserves its named volumes.
`destroy.sh` does the same on Linux and macOS.

```powershell
docker compose -p mlflow -f .\mlflow\compose.yaml down
```

This keeps the MLflow database and artifact volumes. Add `-v` only when you
intend to erase those persisted MLflow records and artifacts.

### Jupyter notebook example

Open `02_mlflow_tracking_registry.ipynb` in JupyterLab and run its cells in
order. It installs the matching MLflow client in the notebook kernel, trains a
small scikit-learn model, logs a run to MLflow, and registers the model. The
notebook file persists under `notebooks/`; installed packages live in the
optional Jupyter container and must be installed again if that container is
recreated.

## SQL client connection

For a desktop SQL client such as DBeaver, use its Apache Hive / HiveServer2
driver to connect to Spark Thrift Server:

- Host: `localhost`
- Port: `10000`
- JDBC URL: `jdbc:hive2://localhost:10000`
- Authentication: none, unless you configured it

Port `10000` speaks the HiveServer2/Thrift protocol, not HTTP, so open it in a
SQL client rather than a browser. The webapp's browser-based SQL Console is
available at [http://localhost:3030](http://localhost:3030).

## Standalone service portal

Open the standalone portal first at [http://localhost:3050](http://localhost:3050).
It is the main landing page for the local Open Lakehouse platform. The existing
Open Lakehouse Demo webapp at `http://localhost:3030` is one component, alongside
Spark Thrift, Flink, Lakekeeper, MinIO, JupyterLab, and MLflow. The portal does
not modify the existing demo webapp. It runs on `127.0.0.1:3050` and needs the
core `lakedemo` network so its health monitor can check services from inside Docker.

Start the core stack first so the `lakedemo` network exists, then start the
portal from the repository root:

```powershell
docker compose -p open-lakehouse-portal -f .\portal\compose.yaml up -d
```

After starting the portal, open [http://localhost:3050](http://localhost:3050).
It polls the
lakehouse, Spark Thrift, Flink, Lakekeeper, MinIO, JupyterLab, and MLflow health
endpoints; use **Refresh** for an immediate check. The **Settings** panel lets
you switch dark/light themes, set the polling interval, show or hide optional
service cards, and customize the links. Settings are saved in this browser.
The Spark Thrift card copies the configured JDBC URL. Each service must be
running for its link to open successfully.

Stop the portal with:

```powershell
docker compose -p open-lakehouse-portal -f .\portal\compose.yaml down
```

Both `destroy.ps1` and `destroy.sh` stop the portal before removing `lakedemo`.

## Future optional LLM and RAG work

MLflow supports GenAI tracing, evaluation, and prompt versioning, but this
add-on does not itself provide an LLM, retrieval pipeline, or explanation UI.
Possible follow-up work is a separate RAG service that reads curated lakehouse
tables, traces retrieval and generation with MLflow, and evaluates prompt or
model changes. Keep such services optional and isolated from the core
lakehouse.
