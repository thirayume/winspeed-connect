"""Check the resolved R740 Compose model against the reviewed target file.

Usage: python3 validate-compose.py <targets/ENV.env> <migrator-env-file-path> < models.json
models.json = {"resolved": <compose config --format json>,
               "env_sources": <compose config --no-env-resolution --format json>}
Prints only fixed messages and key names, never a resolved value.
"""

import json
import re
import sys

PLACEHOLDERS = {"", "CHANGE_ME", "CHANGEME", "TODO"}
TARGET_KEYS = ("ONPREM_DB_SERVER", "ONPREM_DB_PORT", "ONPREM_DB_INSTANCE", "ONPREM_DB_NAME", "ONPREM_TARGET_KIND",
               "ONPREM_EXPECTED_SERVERNAME", "ONPREM_PRODUCT_VERSION_PREFIX",
               "ONPREM_DB_ENCRYPT", "ONPREM_DB_LEGACY_TLS")


def stop(message):
    print("ERROR: " + message)
    raise SystemExit(1)


def read_target(path):
    target = {}
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            line = line.rstrip("\n")
            if not line.strip() or line.lstrip().startswith("#"):
                continue
            match = re.fullmatch(r"([A-Z][A-Z0-9_]*)=(.*)", line)
            if not match:
                stop("target file has an invalid line.")
            target[match.group(1)] = match.group(2)
    return target


def env_file_path(item):
    raw = item if isinstance(item, str) else item.get("path", "") if isinstance(item, dict) else ""
    return raw.replace("\\", "/").rstrip("/") if isinstance(raw, str) else ""


def main():
    if len(sys.argv) != 3:
        stop("usage: validate-compose.py <target-file> <migrator-env-file>")
    target = read_target(sys.argv[1])
    migrator_env_path = sys.argv[2]
    try:
        models = json.load(sys.stdin)
        cfg = models["resolved"]
        sources = models["env_sources"].get("services", {})
        services = cfg.get("services", {})
    except (json.JSONDecodeError, KeyError, AttributeError, TypeError):
        stop("could not read the Compose model.")

    expected = {"backend", "frontend", "caddy", "migrate"}
    if set(services) != expected or set(sources) != expected:
        stop("Compose must contain only backend, frontend, caddy and the one-off migrate service.")
    backend, frontend, caddy, migrate = (services[n] for n in ("backend", "frontend", "caddy", "migrate"))
    app = backend.get("environment", {})
    migration = migrate.get("environment", {})
    if not isinstance(app, dict) or not isinstance(migration, dict):
        stop("service environment is not in the expected format.")

    stack = target["SALEAPP_STACK"]
    for name, service in (("backend", backend), ("migrate", migrate)):
        if service.get("image") != "worldfert-saleapp-%s-backend:local" % stack:
            stop(name + " image is not the " + stack + " backend image.")
    if frontend.get("image") != "worldfert-saleapp-%s-frontend:local" % stack:
        stop("frontend image is not the " + stack + " frontend image.")

    # The API receives exactly the reviewed target; only secrets may come from config\.env.
    for key in TARGET_KEYS + ("ONPREM_DB_USER", "CORS_ORIGIN"):
        if str(app.get(key, "")) != target.get(key, ""):
            stop("API setting " + key + " does not match the target file.")
    if app.get("DB_MODE") != "onprem":
        stop("DB_MODE must be onprem.")
    if str(app.get("ONPREM_DB_ENCRYPT", "")).lower() != "true":
        stop("ONPREM_DB_ENCRYPT must stay true.")
    for key in ("ONPREM_DB_PASSWORD", "JWT_SECRET"):
        if str(app.get(key, "")).strip().upper() in PLACEHOLDERS:
            stop(key + " is blank or a placeholder in config/.env.")
    for key in ("NATIVE_BOOKING_AI_ENABLED", "NATIVE_DELIVERY_104_ENABLED", "DISABLE_BACKGROUND_WORKERS"):
        if target.get(key, "").lower() not in ("true", "false"):
            stop("target file must set " + key + " to true or false.")
        if str(app.get(key, "")).lower() != target[key].lower():
            stop("API setting " + key + " does not match the target file.")
    for key, value in {"COUPON_NATIVE_POSTING_ENABLED": "false", "ENFORCE_PASSWORD_CHANGE": "true",
                       "TRUST_PROXY": "1"}.items():
        if str(app.get(key, "")).lower() != value:
            stop("required safety setting is not enforced: " + key)

    # Migrator: same target, its own login, and no application secret.
    if (migration.get("DB_MODE"), migration.get("DB_OPERATION"), migration.get("MIGRATION_PROFILE")) != ("onprem", "migration", "onprem"):
        stop("the migrate service must use the guarded onprem migration profile.")
    for key in TARGET_KEYS:
        if str(migration.get(key, "")) != str(app.get(key, "")):
            stop("migrate and API target setting " + key + " differ.")
    if {"ONPREM_DB_USER", "ONPREM_DB_PASSWORD", "JWT_SECRET", "MIGRATE_SECRET"} & set(migration):
        stop("the migrate service must not receive application credentials or secrets.")
    if migrate.get("profiles", []) != ["migrate"]:
        stop("the migrate service must stay behind the migrate profile.")
    raw_files = sources["migrate"].get("env_file", [])
    if isinstance(raw_files, (str, dict)):
        raw_files = [raw_files]
    if [env_file_path(item) for item in raw_files] != [migrator_env_path.rstrip("/")]:
        stop("the migrate service must read only the environment's config/.env.migrator.local.")
    declared = sources["migrate"].get("environment", {})
    if not isinstance(declared, dict) or set(migration) - set(declared) != {"ONPREM_MIGRATOR_USER", "ONPREM_MIGRATOR_PASSWORD"}:
        stop("config/.env.migrator.local must supply only ONPREM_MIGRATOR_USER and ONPREM_MIGRATOR_PASSWORD.")
    if str(migration.get("ONPREM_MIGRATOR_USER", "")).lower() != target["SALEAPP_MIGRATOR_LOGIN"].lower():
        stop("ONPREM_MIGRATOR_USER does not match the target migrator login.")
    if str(migration.get("ONPREM_MIGRATOR_PASSWORD", "")).strip().upper() in PLACEHOLDERS:
        stop("ONPREM_MIGRATOR_PASSWORD is blank or a placeholder.")
    if migration["ONPREM_MIGRATOR_PASSWORD"] == app["ONPREM_DB_PASSWORD"]:
        stop("the app and migrator passwords must differ.")
    if migration["ONPREM_MIGRATOR_USER"].lower() == app["ONPREM_DB_USER"].lower():
        stop("the app and migrator logins must differ.")

    # Ingress: only Caddy publishes, on the target ports, from the built image.
    if caddy.get("image") != "worldfert-saleapp-%s-caddy:local" % stack:
        stop("caddy must use the built " + stack + " Caddy image.")
    if any(mount.get("type") == "bind" for mount in caddy.get("volumes", [])):
        stop("caddy must not bind-mount host files.")
    caddy_env = caddy.get("environment", {})
    for key in ("APP_DOMAIN", "HTTP_PORT", "HTTPS_PORT"):
        if str(caddy_env.get(key, "")) != target[key]:
            stop("Caddy setting " + key + " does not match the target file.")
    if frontend.get("build", {}).get("args", {}).get("VITE_API_BASE_URL") != target["VITE_API_BASE_URL"]:
        stop("VITE_API_BASE_URL does not match the target file.")
    if frontend.get("ports") or backend.get("ports") or migrate.get("ports"):
        stop("only Caddy may publish host ports.")
    published = {(str(p.get("published")), str(p.get("target"))) for p in caddy.get("ports", [])}
    wanted = {(target["HTTP_PORT"], target["HTTP_PORT"]), (target["HTTPS_PORT"], target["HTTPS_PORT"])}
    if published != wanted:
        stop("Caddy must publish exactly the target HTTP and HTTPS ports.")
    print("Compose model matches targets; resolved values were not displayed.")


if __name__ == "__main__":
    main()
