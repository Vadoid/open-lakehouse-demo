"""Local Docker configuration for the optional Superset add-on."""

import os

from pyhive.sqlalchemy_hive import HiveDialect
from sqlalchemy import text
from sqlalchemy.engine import URL


SECRET_KEY = os.environ["SUPERSET_SECRET_KEY"]
SUPERSET_WEBSERVER_WORKERS = int(os.environ.get("SUPERSET_WEBSERVER_WORKERS", "1"))


# Spark 3.5's SHOW TABLES returns (namespace, tableName, isTemporary), while
# PyHive's Hive dialect assumes Hive's one-column result and reads row[0]. That
# made Superset show the schema name (for example, "market") as a table. Use
# Spark's tableName column when present and retain the Hive behavior otherwise.
def _spark_compatible_get_table_names(self, connection, schema=None, **kwargs):
    query = "SHOW TABLES"
    if schema:
        query += " IN " + self.identifier_preparer.quote_identifier(schema)
    rows = connection.execute(text(query)).fetchall()
    return [row[1] if len(row) > 1 else row[0] for row in rows if row]


HiveDialect.get_table_names = _spark_compatible_get_table_names


# Spark adds a ``# Partitioning`` section to DESCRIBE output. PyHive's generic
# Hive reflection parser only stops at Hive's ``# Partition Information`` row,
# so it tries to parse Spark's blank partition metadata as a column type.
# Filter that trailing section before PyHive processes the actual columns.
_hive_get_table_columns = HiveDialect._get_table_columns


def _spark_compatible_get_table_columns(self, connection, table_name, schema=None):
    rows = _hive_get_table_columns(self, connection, table_name, schema)
    columns = []
    in_partition_section = False
    for row in rows:
        name = (row[0] or "").strip() if row else ""
        col_type = (row[1] or "").strip() if len(row) > 1 else ""
        if name.startswith("#"):
            in_partition_section = True
        if in_partition_section:
            continue
        if name and col_type:
            columns.append(row)
    return columns


HiveDialect._get_table_columns = _spark_compatible_get_table_columns

SQLALCHEMY_DATABASE_URI = URL.create(
    "postgresql+psycopg2",
    username=os.environ.get("SUPERSET_DB_USER", "superset"),
    password=os.environ["SUPERSET_DB_PASSWORD"],
    host=os.environ.get("SUPERSET_DB_HOST", "superset-db"),
    port=int(os.environ.get("SUPERSET_DB_PORT", "5432")),
    database=os.environ.get("SUPERSET_DB_NAME", "superset"),
).render_as_string(hide_password=False)
