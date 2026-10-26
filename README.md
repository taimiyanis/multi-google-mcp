# multi-mail-mcp

One MCP server for all your Gmail accounts. Claude reads mail across every account, writes drafts
from the right address, tidies your inboxes, and checks every calendar. It cannot send and it cannot
delete.

Built for people who juggle a work address, a school or association address, and a personal one, and
want one assistant that sees all of them.

## What you can ask

- "What came in today across my inboxes?"
- "Summarise the thread with the venue about Thursday and draft a reply from my work address."
- "Who have I been waiting on for more than three days?"
- "Archive the newsletters and label the client emails." (shown to you first)
- "Am I free Thursday afternoon on any calendar?"

With the included `/mail-triage` skill for Claude Code, one command sorts new mail into
*needs you / FYI / noise*, finds the replies you owe and the answers you are waiting for, and leaves
drafts written in your own voice in each account.

## Tools

| Tool | Does |
|---|---|
| `list_accounts` | The connected accounts |
| `search_mail` | Gmail search syntax, across all accounts or one |
| `read_thread` | A whole thread as plain text, with attachment names |
| `create_draft` | A reply in the thread, or a new email, saved as a draft in the chosen account |
| `list_labels`, `label_threads` | Read and apply labels (missing labels are created) |
| `archive_threads`, `mark_read` | Archive and read state, reversible |
| `list_events` | Events from every calendar of every account, duplicates merged |

## Safety, by design

- **No send, no delete.** Those tools do not exist. Every email goes out from your own Gmail,
  after you read it.
- **Everything reversible.** Archived mail stays in All Mail and returns on any reply. Labels can be
  removed.
- **Your keys, your machine.** You create your own Google login key. Tokens are stored in
  `~/.config/multi-mail-mcp/` (readable by your user only). Nothing goes through a third-party server.
- **Calendar is read-only.**

Note: Gmail's archive and label permission (`gmail.modify`) is broad enough that Google lists sending
on the consent screen. The server does not expose any send tool.

## Setup

Requirements: Node.js 20+, a Google account, and an MCP client (Claude Code, Claude Desktop, Cursor).

```bash
git clone https://github.com/taimiyanis/multi-mail-mcp.git
cd multi-mail-mcp
npm install
npm run setup
```

`setup` walks you through three parts:

1. **Your Google login key** (one time, about 10 minutes): create a Google Cloud project, turn on
   Gmail and Calendar, set up the sign-in screen, publish it, and create a *Desktop app* client.
   The wizard gives you each link and waits for you.
2. **Your accounts:** type each address; a browser tab opens for each. Google warns that the app is
   not verified: it is your own private app, so click *Advanced*, then *Go to (your app)*, and tick
   every box.
3. **Claude:** registers the server in Claude Code for all projects, and installs `/mail-triage`.

Other clients: point them at `node_modules/.bin/tsx` with the argument `src/mcp.ts` (full paths).

### Manage accounts

```bash
npm run add -- you@company.com
npm run remove -- you@company.com
npm run accounts
```

## FAQ

**Why do I need my own Google project?**
Reading Gmail is a restricted permission. An app shared by many people needs a paid yearly security
audit from Google. A private app used only by you does not, and your mail never touches anyone else's
server.

**"Access blocked: admin_policy_enforced".**
That organisation's Google admin blocks outside apps. Only the admin can allow it.

**Does it work with Outlook or iCloud?**
Not yet. Gmail and Google Workspace only.

**How is this different from other Gmail MCP servers?**
Several let you switch between accounts. This one is built around doing your email with an assistant:
drafts land in the right account and thread, sorting is safe and reversible, calendars are included,
and the triage skill learns how you write.

## Uninstall

```bash
claude mcp remove multi-mail -s user
rm -rf ~/.config/multi-mail-mcp ~/.claude/skills/mail-triage
```
Then remove the app's access at https://myaccount.google.com/permissions.

## License

MIT
