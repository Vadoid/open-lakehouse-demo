"""Static checks for the opt-in MLflow Compose stack and Jupyter example."""

import json
import os
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
COMPOSE_FILE = ROOT / "mlflow" / "compose.yaml"
NOTEBOOK_FILE = ROOT / "notebooks" / "02_mlflow_tracking_registry.ipynb"


def render_compose(overrides=None):
    env = os.environ.copy()
    env.pop("MLFLOW_SERVER_CPUS", None)
    env.pop("MLFLOW_SERVER_MEM_LIMIT", None)
    env.pop("MLFLOW_SERVER_WORKERS", None)
    if overrides:
        env.update(overrides)
    result = subprocess.run(
        [
            "docker",
            "compose",
            "-p",
            "mlflow-ci",
            "-f",
            str(COMPOSE_FILE),
            "config",
            "--format",
            "json",
        ],
        check=True,
        capture_output=True,
        text=True,
        env=env,
    )
    return json.loads(result.stdout)


@pytest.fixture(scope="module")
def compose_configs():
    return (
        render_compose(),
        render_compose(
            {
                "MLFLOW_SERVER_CPUS": "2.0",
                "MLFLOW_SERVER_MEM_LIMIT": "2g",
                "MLFLOW_SERVER_WORKERS": "2",
            }
        ),
    )


@pytest.fixture(scope="module")
def notebook():
    return json.loads(NOTEBOOK_FILE.read_text(encoding="utf-8"))


def test_mlflow_resource_defaults_and_overrides(compose_configs):
    default, overridden = compose_configs
    assert default["services"]["mlflow"]["cpus"] == 1.0
    assert default["services"]["mlflow"]["mem_limit"] == 1024**3
    default_command = default["services"]["mlflow"]["command"]
    assert default_command[default_command.index("--workers") + 1] == "1"
    assert overridden["services"]["mlflow"]["cpus"] == 2.0
    assert overridden["services"]["mlflow"]["mem_limit"] == 2 * 1024**3
    overridden_command = overridden["services"]["mlflow"]["command"]
    assert overridden_command[overridden_command.index("--workers") + 1] == "2"


def test_tracking_server_and_database_are_isolated(compose_configs):
    compose, _ = compose_configs
    services = compose["services"]
    server = services["mlflow"]
    database = services["mlflow-db"]

    assert "lakedemo" in server["networks"]
    assert "lakedemo" not in database["networks"]
    assert "ports" not in database
    assert server["ports"][0]["host_ip"] == "127.0.0.1"
    assert server["ports"][0]["published"] == "5000"
    assert database["cpus"] == 0.5
    assert database["mem_limit"] == 768 * 1024**2


def test_tracking_store_and_artifacts_are_persistent(compose_configs):
    compose, _ = compose_configs
    server = compose["services"]["mlflow"]
    command = server["command"]
    assert "--backend-store-uri" in command
    assert "--artifacts-destination" in command
    assert "postgresql://mlflow:" in " ".join(command)
    assert any(volume["target"] == "/mlartifacts" for volume in server["volumes"])


def test_jupyter_notebook_targets_server_and_registers_model(notebook):
    code = "\n".join(
        "".join(cell.get("source", []))
        for cell in notebook["cells"]
        if cell["cell_type"] == "code"
    )
    assert notebook["nbformat"] == 4
    assert 'mlflow.set_tracking_uri("http://mlflow:5000")' in code
    assert 'MLFLOW_SUPPRESS_PRINTING_URL_TO_STDOUT"] = "true"' in code
    assert 'os.environ.get("MLFLOW_UI_URL", "http://localhost:5000")' in code
    assert 'registered_model_name="lakehouse-demo-regressor"' in code
    assert "mlflow.log_metric" in code
