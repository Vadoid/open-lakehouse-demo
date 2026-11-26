"""Dependency-free configuration and wiring checks for optional add-ons.

Run with ``python tests/test_optional_integrations.py``. This intentionally uses
plain Python assertions instead of pytest or unittest. Compose files are rendered
through Docker Compose so interpolation, ports, volumes, and networks are checked
as users will deploy them. ``--source-only`` skips those Compose CLI checks.
"""

import json
import os
import runpy
import subprocess
import sys
import types
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def read(relative_path):
    return (ROOT / relative_path).read_text(encoding="utf-8")


def render_compose(relative_path, overrides=None):
    env = os.environ.copy()
    for key in (
        "MLFLOW_SERVER_CPUS",
        "MLFLOW_SERVER_MEM_LIMIT",
        "MLFLOW_SERVER_WORKERS",
        "SUPERSET_SERVER_CPUS",
        "SUPERSET_SERVER_MEM_LIMIT",
        "SUPERSET_WEBSERVER_WORKERS",
    ):
        env.pop(key, None)
    if overrides:
        env.update(overrides)
    result = subprocess.run(
        [
            "docker",
            "compose",
            "-p",
            "lakehouse-ci",
            "-f",
            str(ROOT / relative_path),
            "config",
            "--format",
            "json",
        ],
        check=True,
        capture_output=True,
        text=True,
        env=env,
        cwd=ROOT,
    )
    return json.loads(result.stdout)


def check_mlflow(include_compose=True):
    compose_text = read("mlflow/compose.yaml")
    assert "${MLFLOW_SERVER_WORKERS:-1}" in compose_text
    assert "${MLFLOW_SERVER_MEM_LIMIT:-1g}" in compose_text
    if include_compose:
        default = render_compose("mlflow/compose.yaml")
        tuned = render_compose(
            "mlflow/compose.yaml",
            {
                "MLFLOW_SERVER_CPUS": "2.0",
                "MLFLOW_SERVER_MEM_LIMIT": "2g",
                "MLFLOW_SERVER_WORKERS": "2",
            },
        )
        server = default["services"]["mlflow"]
        database = default["services"]["mlflow-db"]
        command = server["command"]
        assert server["cpus"] == 1.0
        assert int(server["mem_limit"]) == 1024**3
        assert command[command.index("--workers") + 1] == "1"
        assert tuned["services"]["mlflow"]["cpus"] == 2.0
        assert int(tuned["services"]["mlflow"]["mem_limit"]) == 2 * 1024**3
        tuned_command = tuned["services"]["mlflow"]["command"]
        assert tuned_command[tuned_command.index("--workers") + 1] == "2"
        assert "lakedemo" in server["networks"]
        assert "lakedemo" not in database["networks"]
        assert "ports" not in database
        assert server["ports"][0]["host_ip"] == "127.0.0.1"
        assert server["ports"][0]["published"] == "5000"
        assert database["cpus"] == 0.5
        assert int(database["mem_limit"]) == 768 * 1024**2
        assert "--backend-store-uri" in command
        assert "postgresql://mlflow:" in " ".join(command)
        assert "--artifacts-destination" in command
        assert any(volume["target"] == "/mlartifacts" for volume in server["volumes"])


def check_superset(include_compose=True):
    if include_compose:
        compose = render_compose("superset/compose.yaml")
        services = compose["services"]
        app = services["superset"]
        database = services["superset-db"]
        assert app["image"] == "open-lakehouse-superset:6.1.0"
        assert app["ports"][0]["host_ip"] == "127.0.0.1"
        assert app["ports"][0]["published"] == "8088"
        assert "lakedemo" in app["networks"]
        assert "ports" not in database
        assert "lakedemo" not in database["networks"]
        assert "service_completed_successfully" in app["depends_on"]["superset-init"]["condition"]
        assert services["superset-init"]["restart"] == "no"
        assert database["cpus"] == 0.5
        assert int(database["mem_limit"]) == 512 * 1024**2

    dockerfile = read("superset/Dockerfile")
    config = read("superset/superset_config.py")
    init_script = read("superset/init-superset.sh")
    assert "pyhive[hive_pure_sasl]" in dockerfile
    assert "_spark_compatible_get_table_names" in config
    assert "HiveDialect.get_table_names" in config
    assert "_spark_compatible_get_table_columns" in config
    assert "HiveDialect._get_table_columns" in config
    assert "# Partitioning" in config
    assert "superset db upgrade" in init_script
    assert "superset init" in init_script

    # Exercise the actual configured adapters with tiny fake DB responses. This
    # keeps the test independent of PyHive/SQLAlchemy installs while verifying
    # Spark's SHOW TABLES and DESCRIBE row shapes are handled correctly.
    class FakeDialect:
        def __init__(self):
            self.identifier_preparer = types.SimpleNamespace(
                quote_identifier=lambda value: f"`{value}`"
            )

        def _get_table_columns(self, connection, table_name, schema=None):
            return connection.describe_rows

    class FakeURL:
        @classmethod
        def create(cls, *args, **kwargs):
            return cls()

        def render_as_string(self, **kwargs):
            return "postgresql://test/test"

    pyhive_package = types.ModuleType("pyhive")
    pyhive_package.__path__ = []
    pyhive_module = types.ModuleType("pyhive.sqlalchemy_hive")
    pyhive_module.HiveDialect = FakeDialect
    sqlalchemy_package = types.ModuleType("sqlalchemy")
    sqlalchemy_package.__path__ = []
    sqlalchemy_package.text = lambda query: query
    sqlalchemy_engine = types.ModuleType("sqlalchemy.engine")
    sqlalchemy_engine.URL = FakeURL
    fake_modules = {
        "pyhive": pyhive_package,
        "pyhive.sqlalchemy_hive": pyhive_module,
        "sqlalchemy": sqlalchemy_package,
        "sqlalchemy.engine": sqlalchemy_engine,
    }
    previous_modules = {name: sys.modules.get(name) for name in fake_modules}
    previous_secret = os.environ.get("SUPERSET_SECRET_KEY")
    previous_db_password = os.environ.get("SUPERSET_DB_PASSWORD")
    try:
        sys.modules.update(fake_modules)
        os.environ["SUPERSET_SECRET_KEY"] = "integration-test-secret"
        os.environ["SUPERSET_DB_PASSWORD"] = "integration-test-password"
        namespace = runpy.run_path(str(ROOT / "superset" / "superset_config.py"))
    finally:
        for name, previous in previous_modules.items():
            if previous is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = previous
        if previous_secret is None:
            os.environ.pop("SUPERSET_SECRET_KEY", None)
        else:
            os.environ["SUPERSET_SECRET_KEY"] = previous_secret
        if previous_db_password is None:
            os.environ.pop("SUPERSET_DB_PASSWORD", None)
        else:
            os.environ["SUPERSET_DB_PASSWORD"] = previous_db_password

    class FakeResult:
        def fetchall(self):
            return [("market", "trades_v3", False)]

    class FakeConnection:
        describe_rows = [
            ("trade_id", "bigint", None),
            ("symbol", "string", None),
            ("", "", ""),
            ("# Partitioning", "", ""),
            ("Part 0", "days(ts)", ""),
        ]

        def execute(self, query):
            self.query = query
            return FakeResult()

    dialect = FakeDialect()
    connection = FakeConnection()
    assert namespace["HiveDialect"].get_table_names(dialect, connection, "market") == ["trades_v3"]
    assert connection.query == "SHOW TABLES IN `market`"
    filtered_rows = namespace["HiveDialect"]._get_table_columns(
        dialect, connection, "trades_v3", "market"
    )
    assert filtered_rows == [
        ("trade_id", "bigint", None),
        ("symbol", "string", None),
    ]


def check_portal(include_compose=True):
    if include_compose:
        compose = render_compose("portal/compose.yaml")
        portal = compose["services"]["portal"]
        assert portal["ports"][0]["host_ip"] == "127.0.0.1"
        assert portal["ports"][0]["published"] == "3050"
        assert "lakedemo" in portal["networks"]

    server = read("portal/server.mjs")
    html = read("portal/index.html")
    for service in ("lakehouse", "spark", "flink", "lakekeeper", "minio", "jupyter", "mlflow", "superset"):
        assert f'["{service}",' in server or f'"{service}"' in server
        assert f'data-card="{service}"' in html or service == "spark"
    for expected in (
        "http://localhost:3030",
        "http://localhost:8081",
        "http://localhost:8888/lab",
        "http://localhost:5000",
        "http://localhost:8088",
        "jdbc:hive2://localhost:10000",
        "Save settings",
        "Refresh",
    ):
        assert expected in html
    assert 'pathname === "/api/health"' in server
    assert 'pathname === "/" || pathname === "/index.html"' in server


def check_jupyter_and_notebook():
    terraform = read("main.tf")
    variables = read("variables.tf")
    notebook = json.loads(read("notebooks/02_mlflow_tracking_registry.ipynb"))
    code = "\n".join(
        "".join(cell.get("source", []))
        for cell in notebook["cells"]
        if cell["cell_type"] == "code"
    )
    assert 'resource "docker_container" "jupyter"' in terraform
    assert "count      = var.enable_jupyter ? 1 : 0" in terraform
    assert 'container_path = "/home/jovyan/work"' in terraform
    assert 'internal = 8888' in terraform
    assert 'default     = false' in variables[variables.index('variable "enable_jupyter"'):]
    assert 'jupyter_password_hash' in variables
    assert notebook["nbformat"] == 4
    assert 'mlflow.set_tracking_uri("http://mlflow:5000")' in code
    assert 'experiment_url = f"http://localhost:5000/#/experiments/{experiment.experiment_id}"' in code
    assert 'registered_model_name="lakehouse-demo-regressor"' in code
    assert "mlflow.log_metric" in code


def check_deployment_wiring():
    powershell = read("deploy.ps1")
    shell = read("deploy.sh")
    for content in (powershell, shell):
        for feature in ("Jupyter", "Superset", "MLflow", "portal"):
            assert feature.lower() in content.lower()
    for target in ("deploy.ps1", "deploy.sh", "destroy.ps1", "destroy.sh"):
        content = read(target)
        assert "superset" in content.lower()
        assert "mlflow" in content.lower()
        assert "portal" in content.lower()


def main():
    include_compose = "--source-only" not in sys.argv[1:]
    checks = (
        (
            "MLflow compose, tuning, tracking store, and artifacts",
            lambda: check_mlflow(include_compose),
        ),
        (
            "Superset compose isolation and Spark metadata compatibility",
            lambda: check_superset(include_compose),
        ),
        (
            "Portal links, settings, monitoring, and Compose network",
            lambda: check_portal(include_compose),
        ),
        ("Opt-in Jupyter and MLflow notebook integration", check_jupyter_and_notebook),
        ("Cross-platform deploy and destroy wiring", check_deployment_wiring),
    )
    failures = []
    for name, check in checks:
        try:
            check()
            print(f"PASS {name}")
        except Exception as error:  # report every independent failure in one run
            failures.append((name, error))
            print(f"FAIL {name}: {error}", file=sys.stderr)
    if failures:
        raise SystemExit(f"{len(failures)} integration check(s) failed")
    print(f"All {len(checks)} optional-integration checks passed.")


if __name__ == "__main__":
    main()
