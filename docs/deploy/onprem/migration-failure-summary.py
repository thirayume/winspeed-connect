"""Print only fixed diagnostic labels from captured migration output, never raw text."""

import re
import sys


RULES = (
    ("MODULE_NOT_FOUND", r"cannot find module|module_not_found"),
    ("TLS_OR_ENCRYPTION_FAILURE", r"tls|ssl|handshake|certificate|unsupported protocol"),
    ("SQL_LOGIN_FAILURE", r"login failed|authentication failed|\b18456\b|\belogin\b"),
    ("DATABASE_ACCESS_FAILURE", r"cannot open database|not accessible|\b4060\b"),
    ("TARGET_GUARD_FAILURE", r"onprem safety violation|security_error|target_mismatch"),
    ("SQL_PERMISSION_FAILURE", r"permission|not authorized|denied|\b229\b|\b262\b"),
    ("MIGRATION_POLICY_FAILURE", r"migration policy|policy_integrity|unknown_target_profile|configured .* migration is missing"),
    ("MIGRATION_DRIFT", r"applied migrations are immutable|missing from disk|(?:original|executed)_hash_drift|checksum.*drift|batchcount.*drift"),
    ("MIGRATION_LEDGER_FAILURE", r"ledger|wf\.schemamigration"),
    ("DOCKER_RUNTIME_FAILURE", r"cannot connect to the docker|no such image|executable file not found"),
    ("TCP_OR_DNS_FAILURE", r"ehostunreach|enotfound|econnrefused|einstlookup|failed to connect|could not connect"),
    ("CONNECT_TIMEOUT", r"timeout|timed out|etimedout"),
)


def summarize(text):
    label = next((name for name, pattern in RULES if re.search(pattern, text, re.I)), "UNCLASSIFIED_FAILURE")
    lines = ["MIGRATION_DIAGNOSTIC=" + label]
    for code in ("EHOSTUNREACH", "ENOTFOUND", "ECONNREFUSED", "ETIMEDOUT", "ELOGIN", "ESOCKET", "EREQUEST"):
        if re.search(r"\b" + code + r"\b", text, re.I):
            lines.append("ERROR_CODE=" + code)
    if label == "TCP_OR_DNS_FAILURE":
        lines.append("NEXT_STEP=Check SQL TCP port 51433 from the container. Docker Desktop uses ONPREM_DB_SERVER=host.docker.internal.")
    elif label == "SQL_LOGIN_FAILURE":
        lines.append("NEXT_STEP=Match the dedicated migrator SQL login password with .env.migrator.local.")
    elif label == "TARGET_GUARD_FAILURE":
        lines.append("NEXT_STEP=Review target identity and principal isolation; keep the target guard enabled.")
    return lines


if __name__ == "__main__":
    print("\n".join(summarize(sys.stdin.read())))
