FROM apache/superset:6.1.0

# ADDITIVE OPTIONAL INTEGRATION — add the PyHive driver used by Superset's
# Apache Spark SQL engine. This image is separate from every core service.
USER root
RUN uv pip install --python /app/.venv/bin/python \
    'pyhive[hive_pure_sasl]>=0.7.0' \
    'psycopg2-binary==2.9.13'
COPY superset_config.py /app/pythonpath/superset_config.py
COPY init-superset.sh /app/docker/init-superset.sh
RUN chmod 755 /app/docker/init-superset.sh
USER superset
