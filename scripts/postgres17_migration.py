#!/usr/bin/env python3
"""One explicit, journaled PostgreSQL 14 -> 17.12 transfer. Python stdlib only."""
import argparse
import copy
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import signal
import subprocess
import sys
import tempfile
import time

VERSION = "17.12"
BOOTSTRAP = "pg17_migration_admin"
DATA = "/var/lib/postgresql/data"
SETTING_DEFAULTS = (
    "hash_mem_multiplier", "work_mem", "maintenance_work_mem", "shared_buffers",
    "max_connections", "max_parallel_workers_per_gather", "max_parallel_workers",
    "max_worker_processes", "effective_cache_size", "jit", "random_page_cost",
    "effective_io_concurrency", "statement_timeout", "lock_timeout",
    "idle_in_transaction_session_timeout", "shared_preload_libraries",
)


class MigrationError(Exception):
    pass


def digest(path):
    value = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def private_write(path, data):
    """Atomic journal/config writes, including fsync before a write gate opens."""
    path = Path(path)
    fd, temporary = tempfile.mkstemp(prefix=".pg17-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            os.fchmod(stream.fileno(), 0o600)
            stream.write(data.encode() if isinstance(data, str) else data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def update_environment(original, values):
    keys = set(values)
    lines = [line for line in original.splitlines(keepends=True)
             if not (match := re.match(r"\s*(?:export\s+)?([A-Za-z_]\w*)\s*=", line))
             or match[1] not in keys]
    text = "".join(lines)
    newline = "\r\n" if "\r\n" in original else "\n"
    return text.rstrip("\r\n") + newline + "".join(f"{key}={value}{newline}" for key, value in values.items())


def identifier(value):
    return '"' + value.replace('"', '""') + '"'


def literal(value):
    return "E'" + value.replace("\\", "\\\\").replace("'", "''") + "'"


def environment(container):
    return dict(item.split("=", 1) for item in container["Config"]["Env"])


def compose_literals(value):
    # These files contain already resolved values from Docker inspect/config.
    # Prevent a second interpolation of passwords, commands and literal dollars.
    if isinstance(value, str):
        return value.replace("$", "$$")
    if isinstance(value, list):
        return [compose_literals(item) for item in value]
    if isinstance(value, dict):
        return {key: compose_literals(item) for key, item in value.items()}
    return value


def hba_fence(database, administrator, subnet, method, original):
    if any(char in database + administrator for char in '\n\r\0"'):
        raise MigrationError("Unsupported quoted database/role name for the temporary HBA fence.")
    return (f'# Temporary PostgreSQL migration fence\n'
            f'host "{database}" "{administrator}" {subnet} {method}\n'
            f'local "{database}" all reject\n'
            f'host "{database}" all 0.0.0.0/0 reject\n'
            f'host "{database}" all ::0/0 reject\n' + original)


class Migration:
    def __init__(self, directory, migration_dir=None, wait_seconds=180):
        self.root = Path(directory).resolve()
        self.envfile = (self.root / ".env.coding-box").resolve()
        self.pointer = self.root / "backup/postgres17/latest.json"
        self.run_dir = Path(migration_dir).resolve() if migration_dir else None
        self.state = {}
        self.wait_seconds = wait_seconds
        self.process_env = os.environ.copy()
        # GNU Make exports the old values from its included dotenv file.
        # Compose must reread these two values after the atomic cutover edit.
        for key in ("POSTGRES_DATA_VOLUME", "POSTGRES_DATA_VOLUME_EXTERNAL"):
            self.process_env.pop(key, None)
        self.log_number = 0
        self.lock = None

    def acquire(self):
        self.lock = (self.root / ".postgres17-migration.lock").open("a")
        try:
            fcntl.flock(self.lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise MigrationError("Another migration/rollback is running. Use the status command.") from error

    def save(self, phase=None, **values):
        if phase:
            self.state["phase"] = phase
            print(f"[pg17] {phase}", flush=True)
        self.state.update(values)
        private_write(self.run_dir / "state.json", json.dumps(self.state, indent=2) + "\n")

    def run(self, args, data=None, input_file=None, output=None, extra_env=None, timeout=3600):
        self.log_number += 1
        log = self.run_dir / f"command-{self.log_number:03d}-{secrets.token_hex(3)}.log"
        env = {**self.process_env, **(extra_env or {})}
        with log.open("xb") as errors:
            os.chmod(log, 0o600)
            target = Path(output).open("xb") if output else subprocess.PIPE
            source = Path(input_file).open("rb") if input_file else None
            try:
                if output:
                    os.chmod(output, 0o600)
                result = subprocess.run(args, input=data.encode() if isinstance(data, str) else data,
                                        stdin=source, stdout=target, stderr=errors, env=env, timeout=timeout)
                if result.returncode:
                    if result.stdout:
                        errors.write(result.stdout)
                    raise MigrationError(f"Command failed; private diagnostic log: {log}")
                if output:
                    target.flush()
                    os.fsync(target.fileno())
                return result.stdout.decode() if result.stdout is not None else ""
            finally:
                if output:
                    target.close()
                if source:
                    source.close()

    def docker(self, *args, **kwargs):
        return self.run(["docker", *args], **kwargs)

    def compose(self, file, *args, **kwargs):
        rendered = self.run_dir / ("compose-" + file)
        private_write(rendered, json.dumps(compose_literals(json.loads((self.run_dir / file).read_text()))))
        return self.docker("compose", "--project-directory", str(self.root), "-p", self.state["project"],
                           "-f", str(rendered), *args, **kwargs)

    def inspect(self, value):
        return json.loads(self.docker("inspect", value))[0]

    def container(self, file, service):
        ids = self.compose(file, "ps", "-aq", service).split()
        if len(ids) != 1:
            raise MigrationError(f"Expected exactly one {service} container.")
        return self.inspect(ids[0])

    def sql(self, container, sql, database="postgres", bootstrap=False, maintenance=False):
        user = BOOTSTRAP if bootstrap else self.state["administrator"]
        secret = self.stage["services"]["pg17_stage"]["environment"]["POSTGRES_PASSWORD"] if bootstrap else self.admin_password
        host = "127.0.0.1"
        if database == self.state["database"] and self.state.get("network") in container["NetworkSettings"]["Networks"]:
            host = container["NetworkSettings"]["Networks"][self.state["network"]]["IPAddress"]
        options = ["-e", "PGOPTIONS"] if maintenance else []
        return self.docker("exec", "-i", "-e", "PGPASSWORD", *options, container["Id"], "psql", "-X", "-qAt",
                           "-v", "ON_ERROR_STOP=1", "-h", host, "-U", user, "-d", database,
                           data=sql, extra_env={"PGPASSWORD": secret, "PGOPTIONS": "-c default_transaction_read_only=off"})

    def wait(self, file, service, bootstrap=False):
        deadline = time.monotonic() + self.wait_seconds
        while time.monotonic() < deadline:
            item = self.container(file, service)
            if item["State"]["Running"]:
                try:
                    if service in ("db", "pg17_stage"):
                        self.sql(item, "SELECT 1", bootstrap=bootstrap)
                        return item
                    health = item["State"].get("Health", {}).get("Status")
                    if health == "healthy":
                        return item
                    if not health:
                        if service in self.state.get("database_clients", []):
                            addresses = [n["IPAddress"] for n in item["NetworkSettings"]["Networks"].values() if n["IPAddress"]]
                            database = self.container(file, "db")
                            clients = self.sql(database, "SELECT count(*) FROM pg_stat_activity WHERE datname=" + literal(self.state["database"]) + " AND host(client_addr) IN (" + ",".join(literal(ip) for ip in addresses) + ")").strip()
                            if clients != "0":
                                return item
                        else:
                            time.sleep(2)
                            if self.inspect(item["Id"])["State"]["Running"]:
                                return item
                except MigrationError:
                    pass
            time.sleep(1)
        raise MigrationError(f"Timed out waiting for {service}; keep maintenance active.")

    def write_container_file(self, container, name, contents):
        if name not in ("pg_hba.conf", "pg_ident.conf"):
            raise MigrationError("Unexpected PostgreSQL configuration file.")
        command = 'umask 077; cat > "$PGDATA/.pg17-config.tmp" && mv "$PGDATA/.pg17-config.tmp" "$PGDATA/$1"'
        self.docker("exec", "-i", "--user", "postgres", container["Id"], "sh", "-ec", command, "sh", name, data=contents)

    def attach_source(self, container):
        if self.state["network"] not in container["NetworkSettings"]["Networks"]:
            self.docker("network", "connect", "--alias", "pg17_source", self.state["network"], container["Id"])
        return self.inspect(container["Id"])

    def snapshot(self, host, name, baseline=None):
        args = ["run", "--rm", "--no-deps", "-T", "-e", f"POSTGRES_HOST={host}",
                "-e", f"POSTGRES_USER={self.state['administrator']}", "-e", "POSTGRES_PASSWORD",
                "-e", f"POSTGRES_DB={self.state['database']}", "-e", "MIGRATION_SNAPSHOT_TIMEOUT_MS",
                "pg17_check", f"--reportFile=/migration/{name}"]
        if baseline:
            args.append(f"--compareWith=/migration/{baseline}")
        self.compose("stage.json", *args, extra_env={"POSTGRES_PASSWORD": self.admin_password,
                     "MIGRATION_SNAPSHOT_TIMEOUT_MS": os.environ.get("MIGRATION_SNAPSHOT_TIMEOUT_MS", "900000")})

    def load(self):
        if not self.run_dir:
            if not self.pointer.exists():
                raise MigrationError("No recorded PostgreSQL migration found.")
            self.run_dir = Path(json.loads(self.pointer.read_text())["directory"]).resolve()
        self.state = json.loads((self.run_dir / "state.json").read_text())
        if self.state["directory"] != str(self.root):
            raise MigrationError("Migration belongs to a different installation.")
        server = json.loads(self.docker("info", "--format", "{{json .ID}}"))
        if server != self.state["docker_server"]:
            raise MigrationError("Migration belongs to a different Docker daemon/context.")
        self.source = json.loads((self.run_dir / "source.json").read_text())
        self.stage = json.loads((self.run_dir / "stage.json").read_text())
        self.admin_password = self.source["services"]["db"]["environment"]["POSTGRES_PASSWORD"]

    def initialize(self):
        if self.pointer.exists():
            previous = Path(json.loads(self.pointer.read_text())["directory"]) / "state.json"
            if previous.exists() and json.loads(previous.read_text())["phase"] not in ("complete", "rolled_back"):
                raise MigrationError("An unfinished migration exists. Inspect status and roll it back first.")
        self.run_dir = self.run_dir or self.root / "backup/postgres17" / (time.strftime("%Y%m%dT%H%M%S") + "-" + secrets.token_hex(4))
        self.run_dir.mkdir(mode=0o700, parents=True, exist_ok=False)
        os.chmod(self.run_dir, 0o700)
        model = json.loads(self.docker("compose", "--project-directory", str(self.root), "--env-file", str(self.envfile),
                                      "-f", str(self.root / "docker-compose.coding-box.yaml"),
                                      "-f", str(self.root / "docker-compose.coding-box.prod.yaml"), "config", "--format", "json"))
        self.state = {"format": 1, "phase": "preflight", "directory": str(self.root), "project": model["name"],
                      "docker_server": json.loads(self.docker("info", "--format", "{{json .ID}}")),
                      "writes_released": False, "maintenance": False, "cutover": False, "env_changed": False}
        private_write(self.run_dir / "source.json", json.dumps(model))
        db = self.container("source.json", "db")
        if not db["State"]["Running"]:
            raise MigrationError("The existing PostgreSQL 14 service must be running; do not start 17 on its volume.")
        self.source = model
        db_env = environment(db)
        self.state["administrator"] = db_env.get("POSTGRES_USER", "postgres")
        self.admin_password = db_env.get("POSTGRES_PASSWORD", "")
        app_ids = self.compose("source.json", "ps", "-q", "backend").split()
        if not app_ids:
            raise MigrationError("The current backend must be running before migration.")
        app = self.inspect(app_ids[0])
        self.state["database"] = environment(app).get("POSTGRES_DB", "")
        database = self.state["database"]
        if not database or database in ("postgres", "template0", "template1"):
            raise MigrationError("A dedicated application database is required.")
        version = self.sql(db, "SHOW server_version").strip()
        if version.split()[0] == VERSION:
            print("[pg17] PostgreSQL 17.12 is already running; no database changes made.")
            return False
        if not version.startswith("14."):
            raise MigrationError(f"Expected a 14.x source, received {version}. No database changes made.")
        mounts = [mount for mount in db["Mounts"] if mount["Destination"] == DATA and mount["Type"] == "volume"]
        if len(mounts) != 1 or db_env.get("PGDATA", DATA) != DATA:
            raise MigrationError("Automatic migration requires the standard named PostgreSQL data volume.")
        self.state.update(source_volume=mounts[0]["Name"], source_image=db["Image"], source_version=version)
        inventory = json.loads(self.sql(db, self.inventory_sql(), database))
        private_write(self.run_dir / "inventory.json", json.dumps(inventory, indent=2))
        if inventory["unsupported"] or not inventory["superuser"] or inventory["ssl"] != "off":
            raise MigrationError("Source has unsupported objects/TLS or lacks administrative access; no writers stopped. See inventory.json.")
        if not all(re.fullmatch(r"[A-Za-z0-9_.@-]+", inventory[key]) for key in ("collate", "ctype")):
            raise MigrationError("Source locale requires a manual transfer.")
        if not self.admin_password:
            raise MigrationError("A password for the source administrator is required.")
        self.state.update(readonly_setting=inventory["readonly_setting"], authentication=inventory["authentication"],
                          system_id=inventory["system_id"])
        if self.sql(db, "SELECT count(*) FROM pg_database WHERE NOT datistemplate AND datname NOT IN ('postgres'," + literal(database) + ")").strip() != "0":
            raise MigrationError("Additional databases require a separate full-cluster migration plan.")
        if self.sql(db, "SELECT count(*) FROM pg_replication_slots").strip() != "0":
            raise MigrationError("Replication slots need a separate migration plan.")
        if self.sql(db, "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('information_schema') AND left(n.nspname,3)<>'pg_'").strip() != "0":
            raise MigrationError("The administrative postgres database contains user objects; use a full-cluster plan.")
        self.state["runtimes"] = {}
        self.state["runtime_ids"] = {}
        self.state["database_clients"] = []
        for service in ("backend", "backend-export-worker", "frontend"):
            ids = self.compose("source.json", "ps", "-q", service).split() if service in model["services"] else []
            if not ids:
                continue
            containers = [self.inspect(value) for value in ids]
            first = containers[0]
            if any(c["Image"] != first["Image"] or environment(c) != environment(first) for c in containers):
                raise MigrationError("Mixed runtime replicas must finish their rollout first.")
            health_status = first["State"].get("Health", {}).get("Status")
            if (service == "backend" and health_status != "healthy") or health_status == "unhealthy":
                raise MigrationError(f"{service} must have a healthy readiness check before migration.")
            self.state["runtimes"][service] = len(ids)
            self.state["runtime_ids"][service] = ids
            if environment(first).get("POSTGRES_DB") == database:
                self.state["database_clients"].append(service)
            definition = model["services"][service]
            definition.update(image=first["Image"], pull_policy="never", environment=environment(first),
                              command=first["Config"].get("Cmd"), entrypoint=first["Config"].get("Entrypoint"))
            health = first["Config"].get("Healthcheck")
            if health:
                definition["healthcheck"] = {{"StartPeriod": "start_period", "StartInterval": "start_interval"}.get(key, key.lower()):
                    (f"{value}ns" if key not in ("Test", "Retries") else value) for key, value in health.items()}
        model["services"]["db"].update(image=db["Image"], pull_policy="never", environment=db_env,
                                       command=db["Config"].get("Cmd"), entrypoint=db["Config"].get("Entrypoint"))
        model["volumes"]["db_vol"] = {"name": self.state["source_volume"], "external": True}
        self.target_reference = json.loads((self.run_dir / "source.json").read_text())["services"]["db"]["image"]
        try:
            target = self.inspect(self.target_reference)
            actual = self.docker("run", "--rm", "--entrypoint", "postgres", target["Id"], "--version")
        except MigrationError:
            actual = ""
        if not re.search(r"\b17\.12\b", actual):
            self.docker("pull", self.target_reference)
            target = self.inspect(self.target_reference)
            actual = self.docker("run", "--rm", "--entrypoint", "postgres", target["Id"], "--version")
        if not re.search(r"\b17\.12\b", actual):
            raise MigrationError("The configured release DB image must contain PostgreSQL 17.12.")
        self.state["target_image"] = target["Id"]
        size = int(self.sql(db, f"SELECT pg_database_size({literal(database)})").strip())
        if shutil.disk_usage(self.run_dir).free < 2 * size + int(self.inspect(db["Image"])["Size"]) + 256 * 1024 ** 2:
            raise MigrationError("Insufficient backup disk space for the database and old image.")
        self.state["original_env_hash"] = digest(self.envfile)
        info = self.envfile.stat()
        self.state["env_owner"] = [info.st_uid, info.st_gid, info.st_mode & 0o777]
        private_write(self.run_dir / "environment.before", self.envfile.read_bytes())
        for name in ("pg_hba.conf", "pg_ident.conf"):
            path = self.sql(db, "SHOW " + ("hba_file" if name == "pg_hba.conf" else "ident_file")).strip()
            if path != f"{DATA}/{name}":
                raise MigrationError("External PostgreSQL authentication files require a manual transfer.")
            private_write(self.run_dir / name, self.docker("exec", db["Id"], "cat", path))
        private_write(self.run_dir / "source.json", json.dumps(model))
        self.source = model
        token = secrets.token_hex(6)
        self.state.update(network=f"{model['name']}-pg17-{token}", target_volume=f"{model['name']}_pg17_{token}")
        self.docker("network", "create", "--internal", self.state["network"])
        network = self.inspect(self.state["network"])
        self.state["subnet"] = network["IPAM"]["Config"][0]["Subnet"]
        try:
            self.docker("volume", "inspect", self.state["target_volume"])
        except MigrationError:
            self.docker("volume", "create", self.state["target_volume"])
        else:
            raise MigrationError("The selected target volume already exists and will not be reused.")
        self.stage = copy.deepcopy(model)
        self.stage["networks"]["pg17_private"] = {"name": self.state["network"], "external": True}
        self.stage["volumes"]["pg17_target"] = {"name": self.state["target_volume"], "external": True}
        self.stage["services"]["pg17_stage"] = {"image": target["Id"], "pull_policy": "never",
            "environment": {"POSTGRES_USER": BOOTSTRAP, "POSTGRES_PASSWORD": secrets.token_urlsafe(32), "POSTGRES_DB": "postgres",
                            "POSTGRES_INITDB_ARGS": f"--lc-collate={inventory['collate']} --lc-ctype={inventory['ctype']}"},
            "shm_size": model["services"]["db"].get("shm_size", "512m"),
            "volumes": [{"type": "volume", "source": "pg17_target", "target": DATA}], "networks": {"pg17_private": None}}
        script = Path(__file__).resolve().parent / "qa/postgres-migration-snapshot.mjs"
        if not script.is_file():
            raise MigrationError("The migration snapshot script is missing.")
        workdir = app["Config"].get("WorkingDir") or "/usr/src/coding-box-backend"
        tool_path = workdir.rstrip("/") + "/pg17-migration-snapshot.mjs"
        self.stage["services"]["pg17_check"] = {"image": app["Image"], "pull_policy": "never", "working_dir": workdir,
            "entrypoint": ["node", tool_path],
            "environment": {"POSTGRES_PORT": "5432"}, "user": f"{os.getuid()}:{os.getgid()}",
            "volumes": [f"{script}:{tool_path}:ro", f"{self.run_dir}:/migration"],
            "networks": {"pg17_private": None}}
        private_write(self.run_dir / "stage.json", json.dumps(self.stage))
        self.pointer.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        private_write(self.pointer, json.dumps({"directory": str(self.run_dir)}))
        self.save("preparing")
        self.docker("image", "save", self.state["source_image"], output=self.run_dir / "postgres14-image.tar")
        stage = self.wait_stage_start()
        self.compose("stage.json", "run", "--rm", "--no-deps", "-T", "--entrypoint", "node", "pg17_check", "-e",
                     "const fs=require('node:fs');require('pg');fs.accessSync(process.argv[1]);"
                     "fs.writeFileSync('/migration/.mount-probe','ok',{flag:'wx',mode:0o600});fs.unlinkSync('/migration/.mount-probe');", tool_path)
        self.copy_settings(db, stage)
        space = self.docker("exec", stage["Id"], "df", "-Pk", DATA).splitlines()[-1].split()
        if int(space[3]) * 1024 < 2 * size + 256 * 1024 ** 2:
            raise MigrationError("Insufficient Docker data-volume space; source writers remain running.")
        self.save("ready")
        return True

    def inventory_sql(self):
        # Fail closed for objects not covered by the content/schema comparison.
        return """SELECT json_build_object(
          'system_id',(SELECT system_identifier::text FROM pg_control_system()),
          'superuser',(SELECT rolsuper FROM pg_roles WHERE rolname=current_user),
          'authentication',(SELECT CASE WHEN rolpassword LIKE 'SCRAM-SHA-256$%' THEN 'scram-sha-256' ELSE 'md5' END FROM pg_authid WHERE rolname=current_user),
          'ssl',current_setting('ssl'),
          'collate',(SELECT datcollate FROM pg_database WHERE datname=current_database()),
          'ctype',(SELECT datctype FROM pg_database WHERE datname=current_database()),
          'readonly_setting',(SELECT split_part(s,'=',2) FROM pg_db_role_setting d,unnest(d.setconfig) s
            WHERE d.setdatabase=(SELECT oid FROM pg_database WHERE datname=current_database()) AND d.setrole=0 AND s LIKE 'default_transaction_read_only=%'),
          'unsupported',
            EXISTS(SELECT 1 FROM pg_namespace WHERE nspname NOT IN ('public','information_schema') AND left(nspname,3)<>'pg_')
            OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind NOT IN ('r','S','i') AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.objid=c.oid AND d.classid='pg_class'::regclass AND d.deptype='e'))
            OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.objid=p.oid AND d.classid='pg_proc'::regclass AND d.deptype='e'))
            OR EXISTS(SELECT 1 FROM pg_trigger WHERE NOT tgisinternal)
            OR EXISTS(SELECT 1 FROM pg_event_trigger)
            OR EXISTS(SELECT 1 FROM pg_subscription)
            OR EXISTS(SELECT 1 FROM pg_publication)
            OR EXISTS(SELECT 1 FROM pg_policy)
            OR EXISTS(SELECT 1 FROM pg_class WHERE relrowsecurity)
            OR EXISTS(SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typtype IN ('d','r','m') AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.objid=t.oid AND d.classid='pg_type'::regclass AND d.deptype='e'))
            OR EXISTS(SELECT 1 FROM pg_rewrite r JOIN pg_class c ON c.oid=r.ev_class JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND r.rulename<>'_RETURN')
            OR EXISTS(SELECT 1 FROM pg_largeobject_metadata)
            OR EXISTS(SELECT 1 FROM pg_tablespace WHERE spcname NOT IN ('pg_default','pg_global'))
            OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname='pg17_migration_admin')
            OR EXISTS(SELECT 1 FROM pg_extension WHERE extname NOT IN ('plpgsql','pg_trgm','pg_stat_statements'))
            OR EXISTS(SELECT 1 FROM pg_index WHERE NOT indisvalid)
            OR EXISTS(SELECT 1 FROM pg_constraint WHERE NOT convalidated)
        )"""

    def wait_stage_start(self):
        self.compose("stage.json", "up", "-d", "--no-deps", "--no-build", "pg17_stage")
        return self.wait("stage.json", "pg17_stage", bootstrap=True)

    def copy_settings(self, source, target):
        names = ",".join(literal(name) for name in SETTING_DEFAULTS)
        settings = json.loads(self.sql(source, f"""SELECT COALESCE(json_object_agg(name,value),'{{}}') FROM (
          SELECT DISTINCT ON (name) name,value FROM (
            SELECT name,CASE WHEN unit ~ '^[0-9]+' THEN (boot_val::numeric * substring(unit from '^[0-9]+')::numeric)::text || regexp_replace(unit,'^[0-9]+','')
              ELSE boot_val || COALESCE(unit,'') END AS value,0 AS priority FROM pg_settings WHERE name IN ({names})
            UNION ALL SELECT name,setting,seqno FROM pg_file_settings WHERE applied
            UNION ALL SELECT name,current_setting(name),2147483647 FROM pg_settings WHERE source='command line'
          ) s ORDER BY name,priority DESC) q"""))
        for name in ("data_directory", "hba_file", "ident_file", "config_file", "external_pid_file"):
            settings.pop(name, None)
        if settings.get("shared_preload_libraries", "").strip(" '\"") not in ("", "pg_stat_statements"):
            raise MigrationError("Unsupported preload libraries; use the manual migration plan.")
        for name, value in settings.items():
            # PostgreSQL quotes an empty shared_preload_libraries SET as a
            # one-element list containing an empty library name (server FATAL).
            statement = (f"ALTER SYSTEM RESET {identifier(name)}" if value == "" else
                         f"ALTER SYSTEM SET {identifier(name)} = {literal(value)}")
            self.sql(target, statement, bootstrap=True)
        self.compose("stage.json", "restart", "pg17_stage")
        self.wait("stage.json", "pg17_stage", bootstrap=True)

    def set_readonly(self, container, value):
        sql = (f"ALTER DATABASE {identifier(self.state['database'])} RESET default_transaction_read_only" if value is None
               else f"ALTER DATABASE {identifier(self.state['database'])} SET default_transaction_read_only={literal(value)}")
        self.sql(container, sql)

    def freeze(self):
        self.save("maintenance", maintenance=True)
        self.stop_apps()
        db = self.attach_source(self.container("source.json", "db"))
        self.save(hba_fenced=True)
        fence = hba_fence(self.state["database"], self.state["administrator"], self.state["subnet"],
                          self.state["authentication"], (self.run_dir / "pg_hba.conf").read_text())
        self.write_container_file(db, "pg_hba.conf", fence)
        self.sql(db, "SELECT pg_reload_conf()")
        self.set_readonly(db, "on")
        time.sleep(1)
        count = self.sql(db, "SELECT count(*) FROM pg_stat_activity WHERE datname=" + literal(self.state["database"]) + " AND backend_type='client backend'").strip()
        if count != "0":
            raise MigrationError("External database clients are still connected. They were not terminated; coordinate them before retrying.")
        self.save("backing_up")
        self.snapshot("pg17_source", "before.json")
        for command, name in ((["pg_dumpall", "--roles-only", "--database=postgres"], "roles.sql"),
                              (["pg_dump", "--format=custom", "--create", f"--dbname={self.state['database']}"], "database.dump")):
            self.compose("stage.json", "exec", "-T", "-e", "PGPASSWORD", "pg17_stage", *command,
                         "--host=pg17_source", f"--username={self.state['administrator']}", output=self.run_dir / name,
                         extra_env={"PGPASSWORD": self.admin_password})
        checksums = {name: digest(self.run_dir / name) for name in ("roles.sql", "database.dump", "postgres14-image.tar", "environment.before", "before.json")}
        private_write(self.run_dir / "checksums.json", json.dumps(checksums, indent=2))
        self.save("restoring")
        stage = self.container("stage.json", "pg17_stage")
        self.sql(stage, (self.run_dir / "roles.sql").read_text(), bootstrap=True)
        self.compose("stage.json", "exec", "-T", "-e", "PGOPTIONS", "pg17_stage", "pg_restore", "--exit-on-error", "--create",
                     f"--username={BOOTSTRAP}", "--dbname=postgres", input_file=self.run_dir / "database.dump",
                     extra_env={"PGOPTIONS": "-c default_transaction_read_only=off"})
        self.snapshot("pg17_stage", "restored.json", "before.json")
        if self.sql(stage, "SELECT count(*) FROM pg_index WHERE NOT indisvalid", self.state["database"]).strip() != "0":
            raise MigrationError("The restored database contains invalid indexes.")
        self.sql(stage, "ANALYZE", self.state["database"], maintenance=True)
        fence = hba_fence(self.state["database"], self.state["administrator"], self.state["subnet"], self.state["authentication"], (self.run_dir / "pg_hba.conf").read_text())
        self.write_container_file(stage, "pg_hba.conf", fence)
        self.write_container_file(stage, "pg_ident.conf", (self.run_dir / "pg_ident.conf").read_text())
        self.save("switching", cutover=True)
        self.compose("stage.json", "stop", "pg17_stage")
        self.target = copy.deepcopy(self.source)
        self.target["services"]["db"]["image"] = self.state["target_image"]
        self.target["networks"]["pg17_private"] = {"name": self.state["network"], "external": True}
        self.target["services"]["db"]["networks"]["pg17_private"] = {"aliases": ["pg17_target"]}
        self.target["volumes"]["db_vol"] = {"name": self.state["target_volume"], "external": True}
        private_write(self.run_dir / "target.json", json.dumps(self.target))
        if digest(self.envfile) != self.state["original_env_hash"]:
            raise MigrationError("The environment file changed during migration. It was not overwritten.")
        updated = update_environment((self.run_dir / "environment.before").read_text(), {
            "POSTGRES_DATA_VOLUME": self.state["target_volume"], "POSTGRES_DATA_VOLUME_EXTERNAL": "true"})
        self.save(env_changed=True, changed_env_hash=hashlib.sha256(updated.encode()).hexdigest())
        self.replace_env(updated)
        self.compose("target.json", "up", "-d", "--no-deps", "--no-build", "--force-recreate", "db")
        db = self.wait("target.json", "db")
        if self.sql(db, "SHOW server_version").strip().split()[0] != VERSION:
            raise MigrationError("Wrong server version after cutover.")
        self.snapshot("pg17_target", "cutover.json", "before.json")
        self.save("verified")

    def stop_apps(self):
        ids = [value for group in self.state.get("runtime_ids", {}).values() for value in group]
        if ids:
            self.docker("stop", "--time", "120", *ids)

    def start_apps(self, file):
        # Resume the same containers, including their original mounts, resources
        # and image. New release Compose definitions must not roll out the app.
        ids = [value for group in self.state["runtime_ids"].values() for value in group]
        self.docker("start", *ids)
        for service in self.state["runtimes"]:
            if self.state["runtimes"][service] == 1:
                self.wait(file, service)
            else:
                deadline = time.monotonic() + self.wait_seconds
                while time.monotonic() < deadline:
                    replicas = [self.inspect(value) for value in self.compose(file, "ps", "-q", service).split()]
                    if len(replicas) == self.state["runtimes"][service] and all(c["State"].get("Health", {}).get("Status") == "healthy" for c in replicas):
                        break
                    time.sleep(1)
                else:
                    raise MigrationError("Runtime replicas did not become healthy.")

    def finish(self):
        if self.state["phase"] == "complete":
            print("[pg17] Already complete; no database changes made.")
            return
        if self.state["phase"] != "verified":
            raise MigrationError("Only a verified, write-protected migration may be completed.")
        if digest(self.envfile) != self.state["changed_env_hash"]:
            raise MigrationError("The environment file changed after verification.")
        self.validate_target()
        self.verify_backups()
        for ids in self.state.get("runtime_ids", {}).values():
            for value in ids:
                if self.inspect(value)["State"]["Running"]:
                    raise MigrationError("An application container was started externally before verification completed.")
        self.snapshot("pg17_target", f"release-{secrets.token_hex(4)}.json", "before.json")
        # Persist BEFORE either HBA or read-only protection is lifted. Failure or
        # SIGKILL after this point must never automatically restart the stale 14 DB.
        self.save("releasing_writes", writes_released=True)
        db = self.container("target.json", "db")
        self.write_container_file(db, "pg_hba.conf", (self.run_dir / "pg_hba.conf").read_text())
        self.sql(db, "SELECT pg_reload_conf()")
        self.set_readonly(db, self.state["readonly_setting"])
        self.sql(db, f"ALTER ROLE {identifier(BOOTSTRAP)} NOLOGIN")
        self.docker("network", "disconnect", self.state["network"], db["Id"])
        self.start_apps("target.json")
        self.save("complete")
        self.cleanup()

    def validate_target(self):
        db = self.container("target.json", "db")
        names = [item.get("Name") for item in db["Mounts"] if item["Destination"] == DATA]
        if db["Image"] != self.state["target_image"] or names != [self.state["target_volume"]]:
            raise MigrationError("Target container image/volume changed externally. Keep writers stopped.")

    def replace_env(self, contents):
        private_write(self.envfile, contents)
        uid, gid, mode = self.state["env_owner"]
        os.chown(self.envfile, uid, gid)
        os.chmod(self.envfile, mode)

    def verify_backups(self):
        values = json.loads((self.run_dir / "checksums.json").read_text())
        if any(digest(self.run_dir / name) != value for name, value in values.items()):
            raise MigrationError("A backup/checksum changed. Writes remain disabled.")

    def cleanup(self):
        # Keep both data volumes and all backups. Cleanup cannot turn a completed
        # upgrade into an application outage merely because Docker rejects removal.
        try:
            if self.state.get("writes_released"):
                command = 'umask 077; cat > "$PGDATA/.pg17-hba.tmp" && mv "$PGDATA/.pg17-hba.tmp" "$PGDATA/pg_hba.conf"'
                self.docker("run", "--rm", "-i", "--user", "postgres", "--entrypoint", "sh", "-v", f"{self.state['source_volume']}:{DATA}",
                            self.state["source_image"], "-ec", command, data=(self.run_dir / "pg_hba.conf").read_bytes())
            self.compose("stage.json", "rm", "-f", "-s", "pg17_stage")
            self.docker("network", "rm", self.state["network"])
        except MigrationError:
            print(f"[pg17] Auxiliary cleanup pending; data retained. See private logs in {self.run_dir}", file=sys.stderr)

    def rollback(self):
        if self.state.get("writes_released"):
            raise MigrationError("Rollback to 14 is blocked: writes may have occurred on 17. Keep the 17 volume and use forward recovery.")
        if self.state.get("phase") == "rolled_back":
            print("[pg17] Already rolled back; no database changes made.")
            return
        if (self.run_dir / "checksums.json").exists():
            self.verify_backups()
        if self.state.get("maintenance"):
            try:
                self.inspect(self.state["source_image"])
            except MigrationError:
                self.docker("image", "load", input_file=self.run_dir / "postgres14-image.tar")
        self.save("rolling_back")
        if not self.state.get("maintenance"):
            if (self.run_dir / "stage.json").exists():
                self.compose("stage.json", "stop", "pg17_stage")
            self.save("rolled_back")
            self.cleanup()
            return
        self.stop_apps()
        if self.state.get("cutover") and (self.run_dir / "target.json").exists():
            self.compose("target.json", "stop", "db")
        self.compose("stage.json", "stop", "pg17_stage")
        if self.state.get("env_changed"):
            if digest(self.envfile) not in (self.state["changed_env_hash"], self.state["original_env_hash"]):
                raise MigrationError("Environment was edited externally. Writers remain stopped; restore it explicitly from environment.before.")
            self.replace_env((self.run_dir / "environment.before").read_bytes())
        if self.state.get("cutover"):
            self.compose("source.json", "up", "-d", "--no-deps", "--no-build", "--force-recreate", "db")
        db = self.attach_source(self.wait("source.json", "db"))
        if self.sql(db, "SELECT system_identifier::text FROM pg_control_system()").strip() != self.state["system_id"]:
            raise MigrationError("The rollback cluster identity differs. Writers remain stopped.")
        if (self.run_dir / "before.json").exists():
            self.snapshot("pg17_source", f"rollback-{secrets.token_hex(4)}.json", "before.json")
        self.write_container_file(db, "pg_hba.conf", (self.run_dir / "pg_hba.conf").read_text())
        self.sql(db, "SELECT pg_reload_conf()")
        self.set_readonly(db, self.state["readonly_setting"])
        self.docker("network", "disconnect", self.state["network"], db["Id"])
        self.start_apps("source.json")
        self.save("rolled_back")
        self.cleanup()

    def protect_target(self):
        self.stop_apps()
        db = self.container("target.json", "db")
        self.set_readonly(db, "on")
        self.docker("exec", "-e", "PGPASSWORD", db["Id"], "pg_dump", "--format=custom", "--create", "-h", "127.0.0.1",
                    "-U", self.state["administrator"], "-d", self.state["database"], output=self.run_dir / f"recovery17-{secrets.token_hex(4)}.dump",
                    extra_env={"PGPASSWORD": self.admin_password})
        self.save("needs_attention")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("migrate", "finish", "rollback", "status"))
    parser.add_argument("--directory", default=str(Path(__file__).resolve().parents[1]))
    parser.add_argument("--migration-dir")
    parser.add_argument("--prepare-only", action="store_true")
    parser.add_argument("--wait-seconds", type=int, default=180)
    args = parser.parse_args(argv)
    if args.wait_seconds < 1:
        parser.error("--wait-seconds must be positive")
    operation = Migration(args.directory, args.migration_dir, args.wait_seconds)
    if args.action == "status":
        directory = operation.run_dir
        if not directory:
            if not operation.pointer.exists():
                print("No recorded PostgreSQL migration.")
                return 0
            directory = Path(json.loads(operation.pointer.read_text())["directory"])
        state = json.loads((directory / "state.json").read_text())
        print(json.dumps({key: state.get(key) for key in ("phase", "project", "source_version", "source_volume", "target_volume", "writes_released")}, indent=2))
        print(f"Backup and journal: {directory}")
        return 0
    signal.signal(signal.SIGTERM, lambda *_: (_ for _ in ()).throw(MigrationError("Interrupted by SIGTERM")))
    try:
        operation.acquire()
        if args.action == "migrate":
            if not operation.initialize():
                return 0
            operation.freeze()
            if not args.prepare_only:
                operation.finish()
        else:
            operation.load()
            getattr(operation, args.action)()
        print(f"[pg17] Backup and journal: {operation.run_dir}")
        return 0
    except (MigrationError, OSError, ValueError, subprocess.TimeoutExpired, KeyboardInterrupt) as error:
        print(f"[pg17] {error}", file=sys.stderr)
        if operation.state.get("maintenance") or operation.state.get("phase") in ("preparing", "ready"):
            try:
                if operation.state.get("writes_released"):
                    if args.action != "rollback":
                        operation.protect_target()
                elif args.action != "rollback":
                    operation.rollback()
            except Exception as recovery_error:
                print(f"[pg17] Recovery needs attention: {recovery_error}", file=sys.stderr)
        if operation.run_dir:
            print(f"[pg17] Keep all volumes and backups. Journal: {operation.run_dir}", file=sys.stderr)
        return 1
    finally:
        if operation.lock:
            operation.lock.close()


if __name__ == "__main__":
    sys.exit(main())
