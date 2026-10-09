# Further Machines plugins for Claude Code

The Claude Code plugin marketplace of [Further Machines](https://furthermachines.ai). It carries one plugin, `findry`, which brings Findry's Estate Map and governed changes into Claude Code: what a file carries, who consumes it, the decisions to preserve and the changes already in flight.

## Install

In Claude Code:

```
/plugin marketplace add furthermachines/claude-plugins
/plugin install findry@furthermachines
/mcp
```

In `/mcp`, choose `plugin:findry:findry` and sign in to Findry as yourself. The hosted plugin connects directly to `https://mcp.findry.ai/mcp`, with no URL option. The [plugin's README](https://github.com/furthermachines/claude-plugins/tree/main/findry) covers updates, private self-hosted packages, sign-in and what the plugin does.

## What leaves the machine

The repository's remote URL (without a token or password; an ssh host alias as the host it names), HEAD, repo-relative paths of files read, edited or changed by a command in the session, and what the person types or presses; never the transcript, file contents or diffs.

## This repository

Each release replaces this repository's contents and history with a single commit, so it is a place to install from, not to edit.
