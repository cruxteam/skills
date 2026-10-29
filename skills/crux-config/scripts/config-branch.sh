#!/usr/bin/env sh
# The config branch of a CRUX project (D-CF27).
#
#   config-branch.sh <projectKey> [<boundBranch>]
#
# Creates or reuses crux-config/<projectKey> and prints the absolute path to work in on stdout:
# this checkout when it is already on that branch, else a worktree at
# <main checkout>/.claude/worktrees/crux-config-<projectKey>. A new branch starts at
# origin/<boundBranch> (the remote's default branch when none is given). An existing one is
# fast-forwarded to its remote copy, and to origin/<boundBranch> once its last PR merged there
# (after a squash merge it starts over from there, once every file it changed landed).
# Nothing is ever force-pushed: a branch that diverged from its remote is refused.
#
# Progress and errors go to stderr. Nothing here talks to CRUX; it is plain git.
set -eu

die() {
  echo "config-branch: $*" >&2
  exit 1
}

[ $# -ge 1 ] && [ $# -le 2 ] || die "usage: config-branch.sh <projectKey> [<boundBranch>]"
key=$1
echo "$key" | grep -Eq '^[A-Z][A-Z0-9_]{1,9}$' || die "'$key' is not a project key like CR"
branch="crux-config/$key"

git rev-parse --git-dir >/dev/null 2>&1 || die "not inside a git repository"
# The main worktree is the first entry; a bare repository has none to add worktrees beside.
git worktree list --porcelain | sed -n 2p | grep -qx bare && die "the main repository is bare; run this in a checkout"
root=$(git worktree list --porcelain | sed -n 's/^worktree //p' | head -n 1)
git -C "$root" remote get-url origin >/dev/null 2>&1 || die "the repository has no remote named origin"
git -C "$root" fetch --quiet --prune origin >&2 || die "fetch from origin failed"

if [ $# -eq 2 ]; then
  base="origin/$2"
else
  base=$(git -C "$root" symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null) ||
    die "origin has no default branch; name the bound branch"
fi
git -C "$root" rev-parse --verify --quiet "$base^{commit}" >/dev/null || die "$base does not exist"

# Where the branch is checked out already, if anywhere: this checkout first, else any worktree.
dir=
if [ "$(git branch --show-current)" = "$branch" ]; then
  dir=$(git rev-parse --show-toplevel)
else
  dir=$(git -C "$root" worktree list --porcelain | awk -v ref="branch refs/heads/$branch" '
    /^worktree / { path = substr($0, 10) }
    $0 == ref { print path; exit }')
fi

if [ -z "$dir" ]; then
  dir="$root/.claude/worktrees/crux-config-$key"
  [ -e "$dir" ] && die "$dir exists but is not on $branch"
  exclude="$(git -C "$root" rev-parse --path-format=absolute --git-path info/exclude)"
  mkdir -p "$(dirname "$exclude")"
  grep -qx '/.claude/worktrees/' "$exclude" 2>/dev/null || echo '/.claude/worktrees/' >>"$exclude"

  if git -C "$root" show-ref --verify --quiet "refs/heads/$branch"; then
    echo "branch $branch exists; adding a worktree for it" >&2
    git -C "$root" worktree add --quiet "$dir" "$branch" >&2 || die "cannot add a worktree for $branch at $dir"
  elif git -C "$root" show-ref --verify --quiet "refs/remotes/origin/$branch"; then
    echo "tracking origin/$branch" >&2
    git -C "$root" worktree add --quiet --track -b "$branch" "$dir" "origin/$branch" >&2 ||
      die "cannot add a worktree for $branch at $dir"
  else
    echo "creating $branch from $base" >&2
    git -C "$root" worktree add --quiet --no-track -b "$branch" "$dir" "$base" >&2 ||
      die "cannot add a worktree for $branch at $dir"
  fi
fi

# Fast-forward only: to the remote copy a teammate may have pushed, then past a merged PR.
if git -C "$dir" show-ref --verify --quiet "refs/remotes/origin/$branch"; then
  if git -C "$dir" merge-base --is-ancestor HEAD "origin/$branch"; then
    git -C "$dir" merge --quiet --ff-only "origin/$branch" >&2 ||
      die "cannot fast-forward $dir to origin/$branch: commit or stash its changes first"
  elif ! git -C "$dir" merge-base --is-ancestor "origin/$branch" HEAD; then
    die "$branch has diverged from origin/$branch; reconcile them by hand (never force-push)"
  fi
fi
if git -C "$dir" merge-base --is-ancestor HEAD "$base"; then
  git -C "$dir" merge --quiet --ff-only "$base" >&2 ||
    die "cannot fast-forward $dir to $base: commit or stash its changes first"
elif ! git -C "$dir" show-ref --verify --quiet "refs/remotes/origin/$branch" &&
  [ "$(git -C "$dir" config "branch.$branch.merge" || true)" = "refs/heads/$branch" ]; then
  # Pushed once and gone from origin: a squash or rebase merge (the host deleted the head)
  # leaves the branch's own commits off the bound branch. When every file they changed is the
  # same there, start over from it (local only, nothing is pushed); else the person decides.
  fork=$(git -C "$dir" merge-base HEAD "$base") || die "$branch shares no history with $base"
  if git -C "$dir" diff --quiet "$fork" HEAD ||
    git -C "$dir" diff --name-only -z "$fork" HEAD | xargs -0 git -C "$dir" diff --quiet HEAD "$base" --; then
    echo "$branch was merged into $base; starting it over from there" >&2
    git -C "$dir" reset --quiet --keep "$base" >&2 ||
      die "cannot move $dir to $base: commit or stash its changes first"
  else
    die "$branch is gone on origin (merged?) but differs from $base; check git diff $base $branch, then delete it or push it again"
  fi
fi

echo "$dir"
