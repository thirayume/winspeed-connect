#!/usr/bin/env bash
# Runs as root in WSL Ubuntu on R740-SRV. deploy-r740.ps1 streams this file over SSH
# from the exact commit being deployed:
#   bash -s -- <uat|prod> <plan|apply> <40-hex commit> <operator> [approved-plan-id]
# It brings D:\SaleApp\<env>\app to that commit (cloning on first use), then hands
# over to that commit's r740-deploy.sh. It never reads or prints secret files.
set -Eeuo pipefail

fail() { printf 'ERROR: %s\n' "$1" >&2; exit 1; }

readonly REPO_URL='https://github.com/thirayume/winspeed-connect.git'
ENV_NAME="${1:-}"; PHASE="${2:-}"; COMMIT="${3:-}"; OPERATOR="${4:-}"; APPROVED_PLAN="${5:-}"

case "$ENV_NAME" in
  uat) BRANCH='uat' ;;
  prod) BRANCH='main' ;;
  *) fail "environment must be uat or prod." ;;
esac
[[ "$PHASE" == plan || "$PHASE" == apply ]] || fail "phase must be plan or apply."
[[ "$COMMIT" =~ ^[0-9a-f]{40}$ ]] || fail "commit must be a full 40-character SHA."
[[ "$OPERATOR" =~ ^[A-Za-z0-9._@-]{1,80}$ ]] || fail "operator name is missing or invalid."
[[ -z "$APPROVED_PLAN" || "$APPROVED_PLAN" =~ ^[0-9a-f]{64}$ ]] || fail "approved plan id is invalid."

readonly ROOT="/mnt/d/SaleApp/$ENV_NAME"
readonly APP="$ROOT/app"
[[ -d "$ROOT/config" && -d "$ROOT/deploy-logs" ]] || fail "$ROOT/config and deploy-logs must exist (see docs/deploy/r740/README.md)."
command -v git >/dev/null 2>&1 || fail "git is not installed in this WSL distribution."
command -v flock >/dev/null 2>&1 || fail "flock is not installed in this WSL distribution."

# One deploy per environment at a time; the lock is held until r740-deploy.sh exits.
exec 9>"/run/lock/saleapp-$ENV_NAME-deploy.lock"
flock -n 9 || fail "another $ENV_NAME deploy is already running."

g() { git -c safe.directory="$APP" -C "$APP" "$@"; }

if [[ ! -d "$APP/.git" ]]; then
  if [[ -e "$APP" ]] && [[ -n "$(ls -A "$APP" 2>/dev/null)" ]]; then
    fail "$APP exists but is not a Git clone; move it away first."
  fi
  echo "First deploy: cloning $BRANCH into $APP ..."
  git -c core.autocrlf=false clone --quiet --filter=blob:none --no-checkout --branch "$BRANCH" "$REPO_URL" "$APP" \
    || fail "git clone failed."
  g config core.autocrlf false
  g config core.filemode false
fi

[[ "$(g remote get-url origin)" == "$REPO_URL" ]] || fail "origin of $APP is not the Sale-App repository."
g fetch --quiet --prune origin "+refs/heads/$BRANCH:refs/remotes/origin/$BRANCH" || fail "git fetch failed."
REMOTE_HEAD="$(g rev-parse "refs/remotes/origin/$BRANCH")"
[[ "$REMOTE_HEAD" == "$COMMIT" ]] \
  || fail "requested commit ${COMMIT:0:12} is not the current origin/$BRANCH head (${REMOTE_HEAD:0:12}); fetch and retry."

# Tracked files must not have local edits; ignored files are left alone.
if g rev-parse --verify --quiet HEAD >/dev/null && [[ -n "$(g status --porcelain --untracked-files=no)" ]]; then
  fail "$APP has local changes to tracked files; nothing was deployed."
fi
g -c advice.detachedHead=false checkout --quiet --force --detach "$COMMIT" || fail "git checkout failed."
[[ "$(g rev-parse HEAD)" == "$COMMIT" ]] || fail "checkout did not reach the requested commit."
echo "Code at ${COMMIT:0:12} (origin/$BRANCH) in $APP."

exec bash "$APP/docs/deploy/r740/r740-deploy.sh" "$ENV_NAME" "$PHASE" "$COMMIT" "$OPERATOR" "$APPROVED_PLAN"
