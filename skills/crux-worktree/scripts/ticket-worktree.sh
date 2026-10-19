#!/usr/bin/env sh
# Ticket worktrees for CRUX pipeline sessions.
#
#   ticket-worktree.sh ensure <KEY>-N   create or reuse <main checkout>/.claude/worktrees/<KEY>-N on
#                                       branch <KEY>-N; prints the absolute path on stdout
#   ticket-worktree.sh cleanup <path>   remove a launch worktree on a claude/* branch, refusing when
#                                       the tree is dirty or holds commits no remote branch has
#
# Progress and errors go to stderr. Nothing here talks to CRUX; it is plain git.
set -eu

die() {
  echo "ticket-worktree: $*" >&2
  exit 1
}

main_checkout() {
  common=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || die "not inside a git repository"
  dirname "$common"
}

ensure() {
  key=$1
  echo "$key" | grep -Eq '^[A-Z][A-Z0-9_]{1,9}-[1-9][0-9]*$' || die "'$key' is not a ticket key like CR-12"
  root=$(main_checkout)
  dir="$root/.claude/worktrees/$key"

  if [ -e "$dir/.git" ]; then
    echo "reusing $dir" >&2
    echo "$dir"
    return
  fi
  [ -e "$dir" ] && die "$dir exists but is not a git worktree"

  # Keep ticket worktrees out of the main checkout's `git status` without touching tracked files.
  exclude="$(git -C "$root" rev-parse --path-format=absolute --git-path info/exclude)"
  mkdir -p "$(dirname "$exclude")"
  grep -qx '/.claude/worktrees/' "$exclude" 2>/dev/null || echo '/.claude/worktrees/' >>"$exclude"

  if git -C "$root" remote get-url origin >/dev/null 2>&1; then
    git -C "$root" fetch --quiet origin >&2 || echo "fetch from origin failed; using local refs" >&2
  fi

  if git -C "$root" show-ref --verify --quiet "refs/heads/$key"; then
    echo "branch $key exists; adding a worktree for it" >&2
    git -C "$root" worktree add --quiet "$dir" "$key" >&2
  elif git -C "$root" show-ref --verify --quiet "refs/remotes/origin/$key"; then
    echo "tracking origin/$key" >&2
    git -C "$root" worktree add --quiet --track -b "$key" "$dir" "origin/$key" >&2
  else
    base=$(git -C "$root" symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null || true)
    [ -n "$base" ] || base=HEAD
    echo "creating branch $key from $base" >&2
    git -C "$root" worktree add --quiet --no-track -b "$key" "$dir" "$base" >&2
  fi
  echo "$dir"
}

cleanup() {
  path=$(cd "$1" 2>/dev/null && pwd -P) || die "$1 does not exist"
  root=$(cd "$(main_checkout)" && pwd -P)
  case "$path" in
    "$root"/.claude/worktrees/*) ;;
    *) die "refusing: $path is not under $root/.claude/worktrees/" ;;
  esac
  branch=$(git -C "$path" branch --show-current)
  case "$branch" in
    claude/*) ;;
    *) die "refusing: $path is on '$branch', not a claude/* launch branch" ;;
  esac
  [ -z "$(git -C "$path" status --porcelain)" ] || die "refusing: $path has uncommitted changes"
  unpushed=$(git -C "$path" rev-list --count HEAD --not --remotes)
  [ "$unpushed" = 0 ] || die "refusing: $branch has $unpushed commit(s) that no remote branch has"

  git -C "$root" worktree remove "$path" >&2
  git -C "$root" branch -D "$branch" >&2
  echo "removed $path and branch $branch" >&2
}

case "${1:-}" in
  ensure) [ $# -eq 2 ] || die "usage: ticket-worktree.sh ensure <KEY>-N"; ensure "$2" ;;
  cleanup) [ $# -eq 2 ] || die "usage: ticket-worktree.sh cleanup <path>"; cleanup "$2" ;;
  *) die "usage: ticket-worktree.sh ensure <KEY>-N | cleanup <path>" ;;
esac
