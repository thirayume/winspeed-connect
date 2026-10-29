"""Offline regression checks for the UAT Compose guard; never read local secrets.

Run: python scripts/test-wsl-deploy-config.py
If Docker Compose is installed, one test renders temporary dummy env files with
the real root Compose file. No daemon, container, connection, or SQL is used.
"""

import copy
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
script = (ROOT / "docs/deploy/onprem/wsl-deploy.sh").read_text(encoding="utf-8")
start = script.index("python3 -c '") + len("python3 -c '")
VALIDATOR = script[start:script.index("\n'; then", start)]


def fixture_models():
    target = {
        "DB_MODE": "onprem",
        "ONPREM_DB_SERVER": "172.21.48.1",
        "ONPREM_DB_PORT": "51433",
        "ONPREM_DB_INSTANCE": "",
        "ONPREM_DB_NAME": "dbwins_worldfert9_uat2",
        "ONPREM_EXPECTED_SERVERNAME": "AMYOU-YOGA7\\V2008R2",
        "ONPREM_PRODUCT_VERSION_PREFIX": "10.50.",
        "ONPREM_DB_ENCRYPT": "true",
        "ONPREM_DB_LEGACY_TLS": "true",
    }
    app = dict(target, ONPREM_DB_USER="wf_local_uat_app",
               ONPREM_DB_PASSWORD="dummy-app-only", JWT_SECRET="dummy-jwt-only",
               CORS_ORIGIN="https://localhost:8444", COUPON_NATIVE_POSTING_ENABLED="false",
               DISABLE_BACKGROUND_WORKERS="true", ENFORCE_PASSWORD_CHANGE="true")
    migration = dict(target, DB_OPERATION="migration", MIGRATION_PROFILE="onprem",
                     ONPREM_MIGRATOR_USER="wf_local_uat_migrator",
                     ONPREM_MIGRATOR_PASSWORD="dummy&Migration$literal #value=1")
    resolved = {"services": {
        "backend": {"environment": app},
        "migrate": {"profiles": ["migrate"], "environment": migration},
        "frontend": {"build": {"args": {"VITE_API_BASE_URL": "/api"}}},
        "caddy": {"image": "worldfert-saleapp-uat-caddy:local",
                  "volumes": [{"type": "volume", "source": "caddy-data", "target": "/data"},
                              {"type": "volume", "source": "caddy-config", "target": "/config"}],
                  "environment": {"APP_DOMAIN": "localhost", "HTTP_PORT": "8080", "HTTPS_PORT": "8444"},
                  "ports": [{"published": "8080", "target": 8080}, {"published": "8444", "target": 8444}]},
    }}
    sources = copy.deepcopy(resolved)
    source_migrate = sources["services"]["migrate"]
    source_migrate["env_file"] = [{"path": "/fixture/.env.migrator.local", "required": True}]
    for key in ("ONPREM_MIGRATOR_USER", "ONPREM_MIGRATOR_PASSWORD"):
        source_migrate["environment"].pop(key)
    return {"resolved": resolved, "env_sources": sources}


def validate(models):
    return subprocess.run([sys.executable, "-c", VALIDATOR], input=json.dumps(models),
                          capture_output=True, text=True, timeout=10)


class ComposeGuardTests(unittest.TestCase):
    def test_caddy_host_bind_is_rejected(self):
        models = fixture_models()
        models["resolved"]["services"]["caddy"]["volumes"].append(
            {"type": "bind", "source": "/fixture/Caddyfile.uat", "target": "/etc/caddy/Caddyfile"})
        self.assert_rejected(models, "without host bind mounts")

    def test_caddy_context_excludes_local_sql_and_settings(self):
        context = ROOT / "docs/deploy/onprem"
        rules = (context / ".dockerignore").read_text(encoding="utf-8").splitlines()
        self.assertEqual(rules, ["*", "!Dockerfile.caddy", "!Caddyfile.uat", "!Caddyfile.r740-edge"])
        dockerfile = (context / "Dockerfile.caddy").read_text(encoding="utf-8")
        self.assertEqual(dockerfile.splitlines(), ["FROM caddy:2-alpine", "ARG CADDYFILE=Caddyfile.uat",
                                                 "COPY ${CADDYFILE} /etc/caddy/Caddyfile"])

    def assert_accepted(self, models):
        result = validate(models)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(result.stdout + result.stderr, "")

    def assert_rejected(self, models, reason):
        result = validate(models)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(reason, result.stdout)
        self.assertEqual(result.stderr, "")
        for secret in ("dummy-app-only", "dummy-jwt-only", "dummy&Migration$literal #value=1"):
            self.assertNotIn(secret, result.stdout)

    def test_resolved_model_without_env_file_declaration_is_accepted(self):
        models = fixture_models()
        self.assertNotIn("env_file", models["resolved"]["services"]["migrate"])
        self.assert_accepted(models)

    def test_source_path_formats(self):
        for entry in (".env.migrator.local", "/fixture/.env.migrator.local",
                      r"C:\fixture\.env.migrator.local", {"path": "/fixture/.env.migrator.local", "required": True}):
            with self.subTest(entry=entry):
                models = fixture_models()
                models["env_sources"]["services"]["migrate"]["env_file"] = [entry]
                self.assert_accepted(models)

    def test_missing_or_additional_env_files_are_rejected(self):
        for files in ([], [".env"], [".env.migrator.local", ".env"]):
            with self.subTest(files=files):
                models = fixture_models()
                models["env_sources"]["services"]["migrate"]["env_file"] = files
                self.assert_rejected(models, "must receive only .env.migrator.local")

    def test_app_credentials_are_rejected_from_migration_service(self):
        models = fixture_models()
        models["resolved"]["services"]["migrate"]["environment"]["JWT_SECRET"] = "dummy-jwt-only"
        self.assert_rejected(models, "must not receive application credentials")

    def test_extra_env_file_keys_are_rejected(self):
        models = fixture_models()
        models["resolved"]["services"]["migrate"]["environment"]["UNRELATED_SECRET"] = "dummy-app-only"
        self.assert_rejected(models, "must supply only ONPREM_MIGRATOR_USER")

    def test_explicit_migrator_credentials_are_rejected(self):
        models = fixture_models()
        models["env_sources"]["services"]["migrate"]["environment"]["ONPREM_MIGRATOR_USER"] = "wf_local_uat_migrator"
        self.assert_rejected(models, "must come only from .env.migrator.local")

    def test_wrong_migrator_login_is_rejected(self):
        models = fixture_models()
        models["resolved"]["services"]["migrate"]["environment"]["ONPREM_MIGRATOR_USER"] = "wf_local_uat_app"
        self.assert_rejected(models, "must use the dedicated wf_local_uat_migrator")

    def test_blank_or_placeholder_password_is_rejected(self):
        for password in ("", "CHANGE_ME"):
            with self.subTest(password=password):
                models = fixture_models()
                models["resolved"]["services"]["migrate"]["environment"]["ONPREM_MIGRATOR_PASSWORD"] = password
                self.assert_rejected(models, "non-placeholder ONPREM_MIGRATOR_PASSWORD")

    def test_production_target_is_rejected(self):
        models = fixture_models()
        for service in ("backend", "migrate"):
            models["resolved"]["services"][service]["environment"]["ONPREM_DB_NAME"] = "dbwins_worldfert9"
        self.assert_rejected(models, "Target is pinned to dbwins_worldfert9_uat2")

    def test_reused_application_and_migrator_password_is_rejected(self):
        models = fixture_models()
        models["resolved"]["services"]["backend"]["environment"]["ONPREM_DB_PASSWORD"] = models["resolved"]["services"]["migrate"]["environment"]["ONPREM_MIGRATOR_PASSWORD"]
        self.assert_rejected(models, "Application and migrator passwords must be different")

    def test_desktop_host_and_private_ipv4_are_accepted(self):
        for host in ("host.docker.internal", "172.21.48.1", "10.0.0.1"):
            with self.subTest(host=host):
                models = fixture_models()
                for service in ("backend", "migrate"):
                    models["resolved"]["services"][service]["environment"]["ONPREM_DB_SERVER"] = host
                self.assert_accepted(models)

    def test_other_hostnames_public_and_loopback_endpoints_are_rejected(self):
        for host in ("unapproved.example", "localhost", "127.0.0.1", "8.8.8.8", "0.0.0.0"):
            with self.subTest(host=host):
                models = fixture_models()
                for service in ("backend", "migrate"):
                    models["resolved"]["services"][service]["environment"]["ONPREM_DB_SERVER"] = host
                self.assert_rejected(models, "ONPREM_DB_SERVER must be")

    def test_failure_summary_emits_only_fixed_labels(self):
        helper = ROOT / "docs/deploy/onprem/migration-failure-summary.py"
        for message, expected in (
            ("Failed to connect: EHOSTUNREACH Password=Secret&P@ss$keep;", "TCP_OR_DNS_FAILURE"),
            ("Login failed for user 'private-account' password=Secret&P@ss$keep; ELOGIN", "SQL_LOGIN_FAILURE"),
            ("SSL handshake unsupported protocol Secret&P@ss$keep;", "TLS_OR_ENCRYPTION_FAILURE"),
            ("ONPREM SAFETY VIOLATION: private-account Secret&P@ss$keep;", "TARGET_GUARD_FAILURE"),
            ("CRITICAL SAFETY VIOLATION: Cross-database write private-account Secret&P@ss$keep;", "TARGET_GUARD_FAILURE"),
            ("ORIGINAL_HASH_DRIFT: checksum mismatch Secret&P@ss$keep;", "MIGRATION_DRIFT"),
            ("Unknown private message Secret&P@ss$keep;", "UNCLASSIFIED_FAILURE"),
        ):
            with self.subTest(expected=expected):
                result = subprocess.run([sys.executable, str(helper)], input=message, text=True, capture_output=True, timeout=10)
                self.assertEqual(result.returncode, 0)
                self.assertIn("MIGRATION_DIAGNOSTIC=" + expected, result.stdout)
                self.assertNotIn("Secret&P@ss$keep", result.stdout + result.stderr)
                self.assertNotIn("private-account", result.stdout + result.stderr)

    def test_pinned_sql2008_artifacts_match_policy_bytes(self):
        policy = json.loads((ROOT / "backend/migration-policy.json").read_text(encoding="utf-8"))
        for filename, override in policy["dialectOverrides"].items():
            artifacts = (
                (ROOT / "backend/migrations" / filename, override["originalHash"]),
                (ROOT / "backend/migrations/compat/sql2008" / override["executedFile"], override["executedHash"]),
            )
            for path, expected in artifacts:
                with self.subTest(artifact=path.name):
                    self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), expected,
                                     "Migration artifact bytes differ from the pinned policy; check checkout line endings.")

    def test_fatal_sql_error_is_not_hidden_by_tls_warning(self):
        helper = ROOT / "docs/deploy/onprem/migration-failure-summary.py"
        message = ("(node:1) [DEP0123] DeprecationWarning: Setting TLS ServerName to an IP address\n"
                   "Migration failed: 157_initial_coupon_invoice_107.sql batch execution failed (SQL 15517): "
                   "Cannot execute as the database principal 'private-account' password=Secret&P@ss$keep;\n")
        result = subprocess.run([sys.executable, str(helper)], input=message, text=True, capture_output=True, timeout=10)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout.splitlines(), [
            "MIGRATION_DIAGNOSTIC=DATABASE_PRINCIPAL_FAILURE", "SQL_ERROR_NUMBER=15517",
            "MIGRATION_FILE=157_initial_coupon_invoice_107.sql"])
        self.assertNotIn("private-account", result.stdout + result.stderr)
        self.assertNotIn("Secret&P@ss$keep", result.stdout + result.stderr)

    def test_fatal_tls_error_is_still_reported(self):
        helper = ROOT / "docs/deploy/onprem/migration-failure-summary.py"
        result = subprocess.run([sys.executable, str(helper)],
                                input="Migration failed: Failed to connect: TLS handshake unsupported protocol ESOCKET",
                                text=True, capture_output=True, timeout=10)
        self.assertEqual(result.stdout.splitlines(), [
            "MIGRATION_DIAGNOSTIC=TLS_OR_ENCRYPTION_FAILURE", "ERROR_CODE=ESOCKET"])

    @unittest.skipUnless(shutil.which("docker"), "Docker CLI not installed")
    def test_actual_compose_resolution_with_dummy_special_characters(self):
        with tempfile.TemporaryDirectory(prefix=".uat-compose-guard-", dir=ROOT) as tmp:
            directory = Path(tmp).resolve()
            self.assertEqual(directory.parent, ROOT.resolve())
            compose_file = directory / "docker-compose.yml"
            compose_file.write_text((ROOT / "docker-compose.yml").read_text(encoding="utf-8"), encoding="utf-8")
            app = fixture_models()["resolved"]["services"]["backend"]["environment"]
            settings = dict(app, APP_DOMAIN="localhost", HTTP_PORT="8080", HTTPS_PORT="8444", VITE_API_BASE_URL="/api")
            fixture_env = directory / "fixture.env"
            fixture_env.write_text("".join(f"{key}={value}\n" for key, value in settings.items()), encoding="utf-8")
            (directory / ".env.migrator.local").write_text(
                "ONPREM_MIGRATOR_USER=wf_local_uat_migrator\n"
                "ONPREM_MIGRATOR_PASSWORD='dummy&Migration$literal #value=1'\n", encoding="utf-8")
            env = {key: value for key, value in os.environ.items()
                   if not key.startswith(("COMPOSE_", "ONPREM_")) and key not in settings}
            command = [shutil.which("docker"), "compose", "--project-directory", tmp,
                       "-f", str(compose_file), "--env-file", str(fixture_env), "--profile", "migrate", "config"]
            models = {}
            for name, flags in (("resolved", []), ("env_sources", ["--no-env-resolution"])):
                result = subprocess.run(command + flags + ["--format", "json"], env=env,
                                        capture_output=True, text=True, timeout=30)
                self.assertEqual(result.returncode, 0, f"Dummy Compose render failed: {name} (exit {result.returncode})")
                models[name] = json.loads(result.stdout)
            self.assertIn("ONPREM_MIGRATOR_PASSWORD", models["resolved"]["services"]["migrate"]["environment"])
            self.assertNotIn("env_file", models["resolved"]["services"]["migrate"])
            self.assertIn("env_file", models["env_sources"]["services"]["migrate"],
                          "Compose must preserve env_file with --no-env-resolution; CI and R740 use v5.6.1.")
            self.assertTrue(models["env_sources"]["services"]["migrate"]["env_file"])
            self.assert_accepted(models)


class R740ComposeGuardTests(unittest.TestCase):
    """R740 must pin every native writer flag outside the secret env files."""

    def fixture(self, environment):
        target_path = ROOT / f"docs/deploy/r740/targets/{environment}.env"
        target = dict(line.split("=", 1) for line in target_path.read_text(encoding="utf-8").splitlines()
                      if line and not line.startswith("#"))
        models = fixture_models()
        app = models["resolved"]["services"]["backend"]["environment"]
        migration = models["resolved"]["services"]["migrate"]["environment"]
        target_keys = ("ONPREM_DB_SERVER", "ONPREM_DB_PORT", "ONPREM_DB_INSTANCE", "ONPREM_DB_NAME",
                       "ONPREM_TARGET_KIND", "ONPREM_EXPECTED_SERVERNAME", "ONPREM_PRODUCT_VERSION_PREFIX",
                       "ONPREM_DB_ENCRYPT", "ONPREM_DB_LEGACY_TLS")
        for key in target_keys:
            app[key] = migration[key] = target[key]
        for key in ("ONPREM_DB_USER", "CORS_ORIGIN", "ONPREM_SWITCHABLE_DATABASES", "NATIVE_BOOKING_AI_ENABLED",
                    "NATIVE_DELIVERY_104_ENABLED", "NATIVE_MANUAL_116_ENABLED", "NATIVE_INVOICE_107_ENABLED",
                    "DISABLE_BACKGROUND_WORKERS"):
            app[key] = target[key]
        app["TRUST_PROXY"] = "1"
        migration["ONPREM_MIGRATOR_USER"] = target["SALEAPP_MIGRATOR_LOGIN"]
        models["env_sources"]["services"]["migrate"]["environment"] = {
            key: value for key, value in migration.items()
            if key not in ("ONPREM_MIGRATOR_USER", "ONPREM_MIGRATOR_PASSWORD")}
        services = models["resolved"]["services"]
        for service in ("backend", "migrate"):
            services[service]["image"] = f"worldfert-saleapp-{environment}-backend:local"
        services["frontend"]["image"] = f"worldfert-saleapp-{environment}-frontend:local"
        services["caddy"]["image"] = f"worldfert-saleapp-{environment}-caddy:local"
        services["caddy"]["environment"] = {key: target[key] for key in ("APP_DOMAIN", "HTTP_PORT", "HTTPS_PORT")}
        services["caddy"]["ports"] = [{"published": target[key], "target": int(target[key])}
                                          for key in ("HTTP_PORT", "HTTPS_PORT")]
        models["resolved"]["networks"] = {"default": {"name": f"saleapp-{environment}_default"}}
        for name, service in services.items():
            service["networks"] = {"default": None}
            if name in ("backend", "frontend"):
                service["networks"]["default"] = {"aliases": [f"worldfert-saleapp-{environment}-{name}"]}
        if environment == "prod":
            services["caddy"]["build"] = {"args": {"CADDYFILE": "Caddyfile.r740-edge"}}
            services["caddy"]["networks"]["uat_ingress"] = None
            services["caddy"]["environment"].update({key: target[key] for key in ("PUBLIC_PROD_DOMAIN", "PUBLIC_UAT_DOMAIN")})
            models["resolved"]["networks"]["uat_ingress"] = {"external": True, "name": "saleapp-uat_default"}
        return models, target_path

    def validate(self, models, target_path):
        return subprocess.run([sys.executable, str(ROOT / "docs/deploy/r740/validate-compose.py"),
                               str(target_path), "/fixture/.env.migrator.local"],
                              input=json.dumps(models), capture_output=True, text=True, timeout=10)

    def test_reviewed_uat_and_prod_models_are_accepted(self):
        for environment in ("uat", "prod"):
            with self.subTest(environment=environment):
                models, target_path = self.fixture(environment)
                result = self.validate(models, target_path)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_corrected_uat_clone_uses_isolated_logins_and_one_database(self):
        models, target_path = self.fixture("uat")
        app = models["resolved"]["services"]["backend"]["environment"]
        migration = models["resolved"]["services"]["migrate"]["environment"]
        self.assertEqual(app["ONPREM_DB_NAME"], "dbwins_worldfert9_uat")
        self.assertEqual(app["ONPREM_SWITCHABLE_DATABASES"], "dbwins_worldfert9_uat")
        self.assertEqual(app["ONPREM_DB_USER"], "wf_r740_uat_app_v2")
        self.assertEqual(migration["ONPREM_MIGRATOR_USER"], "wf_r740_uat_migrator_v2")
        self.assertNotIn("dbwins_worldfert9-uat", target_path.read_text(encoding="utf-8"))

    def test_cross_stack_network_is_rejected_for_app_and_migrator(self):
        for environment in ("uat", "prod"):
            for service in ("backend", "frontend", "migrate"):
                with self.subTest(environment=environment, service=service):
                    models, target_path = self.fixture(environment)
                    models["resolved"]["services"][service]["networks"]["uat_ingress"] = None
                    self.assertNotEqual(self.validate(models, target_path).returncode, 0)

    def test_edge_rejects_ambiguous_aliases_wrong_image_or_foreign_network(self):
        for defect in ("alias", "image", "network", "domain", "host-network"):
            with self.subTest(defect=defect):
                models, target_path = self.fixture("prod")
                cfg = models["resolved"]
                if defect == "alias":
                    cfg["services"]["backend"]["networks"]["default"]["aliases"] = ["backend"]
                elif defect == "image":
                    cfg["services"]["caddy"]["build"]["args"]["CADDYFILE"] = "Caddyfile.uat"
                elif defect == "network":
                    cfg["networks"]["uat_ingress"]["name"] = "unrelated_default"
                elif defect == "domain":
                    cfg["services"]["caddy"]["environment"]["PUBLIC_UAT_DOMAIN"] = "unexpected.example.com"
                else:
                    cfg["services"]["caddy"]["network_mode"] = "host"
                self.assertNotEqual(self.validate(models, target_path).returncode, 0)

    def test_actual_r740_compose_models_with_public_edge(self):
        docker = shutil.which("docker")
        if not docker:
            self.skipTest("Docker Compose CLI unavailable")
        with tempfile.TemporaryDirectory() as tmp:
            migrator = Path(tmp) / ".env.migrator.local"
            app_env = Path(tmp) / ".env"
            for environment in ("uat", "prod"):
                _, target_path = self.fixture(environment)
                target = dict(line.split("=", 1) for line in target_path.read_text(encoding="utf-8").splitlines()
                              if line and not line.startswith("#"))
                migrator.write_text("ONPREM_MIGRATOR_USER=" + target["SALEAPP_MIGRATOR_LOGIN"] +
                                    "\nONPREM_MIGRATOR_PASSWORD='dummy&separate$literal#value=1'\n", encoding="utf-8")
                app_env.write_text("ONPREM_DB_PASSWORD='dummy&app$literal#value=2'\nJWT_SECRET=dummy-test-jwt\n", encoding="utf-8")
                env = dict(os.environ, **target, SALEAPP_MIGRATOR_ENV_FILE=str(migrator))
                args = [docker, "compose", "--project-directory", str(ROOT), "-p", "saleapp-" + environment,
                        "-f", str(ROOT / "docker-compose.yml")]
                if environment == "prod":
                    args += ["-f", str(ROOT / "docs/deploy/r740/compose.edge-prod.yml")]
                args += ["--env-file", str(app_env), "--profile", "migrate", "config", "--format", "json"]
                rendered = {}
                for key, suffix in (("resolved", []), ("env_sources", ["--no-env-resolution"])):
                    result = subprocess.run(args + suffix, env=env, capture_output=True, text=True, timeout=20)
                    self.assertEqual(result.returncode, 0, "real Compose render failed")
                    rendered[key] = json.loads(result.stdout)
                result = subprocess.run([sys.executable, str(ROOT / "docs/deploy/r740/validate-compose.py"),
                                         str(target_path), migrator.as_posix()], input=json.dumps(rendered),
                                        capture_output=True, text=True, timeout=10)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_secret_env_cannot_override_any_native_writer(self):
        for environment in ("uat", "prod"):
            for key in ("NATIVE_BOOKING_AI_ENABLED", "NATIVE_DELIVERY_104_ENABLED",
                        "NATIVE_MANUAL_116_ENABLED", "NATIVE_INVOICE_107_ENABLED"):
                with self.subTest(environment=environment, flag=key):
                    models, target_path = self.fixture(environment)
                    app = models["resolved"]["services"]["backend"]["environment"]
                    app[key] = "false" if app[key] == "true" else "true"
                    result = self.validate(models, target_path)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn(key + " does not match the target file", result.stdout)
                    self.assertNotIn("dummy-app-only", result.stdout + result.stderr)
                    self.assertNotIn("dummy&Migration", result.stdout + result.stderr)

    def test_launcher_exports_all_reviewed_native_flags(self):
        launcher = (ROOT / "docs/deploy/r740/r740-deploy.sh").read_text(encoding="utf-8")
        pin_line = next(line for line in launcher.splitlines() if line.startswith("readonly PIN_KEYS="))
        for environment in ("uat", "prod"):
            models, target_path = self.fixture(environment)
            for key in ("NATIVE_BOOKING_AI_ENABLED", "NATIVE_DELIVERY_104_ENABLED",
                        "NATIVE_MANUAL_116_ENABLED", "NATIVE_INVOICE_107_ENABLED"):
                self.assertIn(" " + key + " ", pin_line)
                app = models["resolved"]["services"]["backend"]["environment"]
                self.assertIn(key + "=" + app[key], target_path.read_text(encoding="utf-8"))
                if environment == "prod":
                    self.assertEqual(app[key], "false", "Live native writers have not passed acceptance.")


if __name__ == "__main__":
    unittest.main(verbosity=2)
