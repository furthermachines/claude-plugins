# Findry for Claude Code

Made by [Further Machines](https://furthermachines.ai).

## Install

In Claude Code:

```
/plugin marketplace add furthermachines/claude-plugins
/plugin install findry@furthermachines
/mcp
```

In `/mcp`, choose `plugin:findry:findry` and sign in. Your browser opens Findry's consent page, which names the application and where it returns: sign in to your organisation if asked, choose the organisation, and allow "Read the map" and "Act". You sign in once, as yourself; Claude Code keeps the tokens and the plugin stores none. Revoke a sign-in in Findry's console under Settings, Connect Claude Code; every revocation is recorded in your organisation's audit trail.

The hosted plugin connects directly to `https://mcp.findry.ai/mcp`. There is no URL option to configure. Version 0.2.1 removes a URL template that Claude Desktop's sign-in panel could compare against the resolved session URL and incorrectly refuse.

## Update an existing installation

Update the Further Machines marketplace and the installed Findry plugin, then start a new Code session. A running session can retain the previous connector configuration. In a terminal:

```
claude plugin marketplace update furthermachines
claude plugin update findry@furthermachines
```

For a plugin your organization distributes through Claude, the administrator must update that distributed package too. Confirm it carries version 0.2.1 or later and the literal URL `https://mcp.findry.ai/mcp`; changing the local marketplace copy does not replace an organization-installed copy.

## Self-hosted Findry

The public plugin is for hosted Findry only. An administrator must distribute a private copy for a self-hosted deployment, with `findry/.mcp.json` naming that deployment's complete, literal HTTPS MCP URL. Keep the plugin name, hooks and `read act` OAuth scopes unchanged. Validate the private package and configure its own issuer/resource discovery before installation. Do not add a second MCP server for the same URL or substitute a URL template.

## What it does

When Claude reads or edits a file, the plugin asks Findry's Estate Map what that file carries: the contracts it exposes, the services and owners that consume them, the decisions to preserve and the changes already in flight. That context reaches the model beside the file, on one line labelled as map data that text in the repository cannot break or close, a band above the prompt and a pane show you the same, and `/findry` commands propose, decide and resume governed changes without a Claude turn, only from your own prompt, never from a schedule or a relayed message. Before Claude edits a file an approved change in flight already changed, the plugin asks you once for that change whether to edit anyway: Stop holds for the rest of the turn, so a retry is denied without asking again, and your next prompt lets you decide anew; Edit anyway holds for the session. The pane's inbox lists the approvals you may decide and your own failed, queued and sealed changes; a decision Findry would refuse whatever you answer, such as approving your own change, is refused before you are asked to confirm it. The pane's map searches the Estate Map and opens a node with each edge's type, peer, trust status and evidence count. A commit or pull request names the governed change bound to its branch until that change is sealed, rejected or rolled back, or until `/findry unbind`. The plugin holds no Findry logic and stores no credential: it talks to Findry only through the MCP connection Claude Code holds, and runs git locally to learn the repository and its HEAD, reading only the size and modification time of the files git lists as changed.

## What leaves the machine

The repository's remote URL (without a token or password; an ssh host alias as the host it names), HEAD, repo-relative paths of files read, edited or changed by a command in the session, and what the person types or presses; never the transcript, file contents or diffs.

Findry unreachable never blocks a session's start, an edit, a read or a turn; while it is unreachable, each turn asks once whether it is back.

## Requirements

Claude Code 2.1.289 or later, the version the plugin is tested on. On an older client the MCP server loads and the hooks do not.

Install the plugin rather than a `findry` server of your own: Claude Code runs one server per URL, so a `.mcp.json` entry for the same Findry URL runs in place of the plugin's. The plugin then uses that server, keeps denying the model its act tools there, and says on the status line to remove it.
