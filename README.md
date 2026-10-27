# multi-google-mcp

One MCP server for all your Google accounts. Claude reads mail across every account and writes
drafts from the right address, finds and reads files in every Drive, creates and edits Docs and
Sheets, and manages every calendar. It cannot send an email and it cannot delete anything.

Built for people who juggle a work account, a school or association account, and a personal one,
and want one assistant that sees all of them.

## What you can ask

- "What came in today across my inboxes?"
- "Summarise the thread with the venue about Thursday and draft a reply from my work address."
- "Find the budget sheet in any of my Drives and tell me what changed this month."
- "Read the client deck and the meeting notes, then write a one-page brief as a new Doc."
- "Add these three expenses to the tracking sheet." (shown to you first if the sheet is shared)
- "Block Thursday 2 to 4 pm for deep work on my work calendar."
- "Who have I been waiting on for more than three days?"

With the included `/mail-triage` skill for Claude Code, one command sorts new mail into
*needs you / FYI / noise*, finds the replies you owe and the answers you are waiting for, and leaves
drafts written in your own voice in each account.

## Tools

| Area | Tool | Does |
|---|---|---|
| Accounts | `list_accounts` | The connected accounts |
| Mail | `search_mail` | Gmail search syntax, across all accounts or one |
| | `read_thread` | A whole thread as plain text, with attachment names |
| | `create_draft` | A reply in the thread, or a new email, saved as a draft in the chosen account |
| | `list_labels`, `label_threads` | Read and apply labels (missing labels are created) |
| | `archive_threads`, `mark_read` | Archive and read state, reversible |
| Calendar | `list_events` | Events from every calendar of every account, duplicates merged |
| | `create_event`, `update_event` | Add or change events, optionally with a Meet link |
| Drive | `search_files` | Names and contents, in My Drive, shared with me and shared drives, all accounts |
| | `read_file` | Docs as Markdown, Sheets tab by tab, Slides with speaker notes; PDFs and images saved locally for Claude to open |
| Docs | `create_doc`, `edit_doc` | New Doc from Markdown; append or find-and-replace |
| Sheets | `create_sheet`, `update_sheet` | New Sheet from rows (formulas work); append or overwrite |

## Safety, by design

- **No send, no delete.** Those tools do not exist. Every email goes out from your own Gmail, after
  you read it. No file, event, label or message can be deleted.
- **Shared files wait for you.** Editing a Doc or Sheet that other people can see is refused until
  you approve that exact change. Files you alone own are edited directly.
- **Guests wait for you.** An event with guests notifies them, so creating or changing one is
  refused until you approve that exact event and guest list.
- **Mail sorting is reversible.** Archived mail stays in All Mail and returns on any reply.
- **Your keys, your machine.** You create your own Google login key. Tokens are stored in
  `~/.config/multi-google-mcp/` (readable by your user only). Nothing goes through a third-party server.

Note: the permissions are broad (Gmail modify, full Drive, Calendar events), so Google's consent
screen lists more than the server does. The safety rules above are enforced in the code, not left
to the assistant.

## Setup

Requirements: Node.js 20+, a Google account, and an MCP client (Claude Code, Claude Desktop, Cursor).

```bash
npx multi-google-mcp setup
```

The wizard walks you through three parts and waits for you at each step.

### 1. Your own Google login key (one time, about 10 minutes)

Each user makes their own key, so your data never goes through anyone else.

1. **Create a project.** Open [projectcreate](https://console.cloud.google.com/projectcreate), name it
   `multi-google-mcp`, click **Create**, then **Select project** in the notification.

   <img src="https://multi-google-mcp-tau.vercel.app/setup/1-project.png" alt="New Project form with the name multi-google-mcp" width="480">

2. **Turn on the six APIs with one link:**
   [enable Gmail, Calendar, Drive, Docs, Sheets and Slides](https://console.cloud.google.com/flows/enableapi?apiid=gmail.googleapis.com,calendar-json.googleapis.com,drive.googleapis.com,docs.googleapis.com,sheets.googleapis.com,slides.googleapis.com).
   Check that the top bar shows your project, then **Next** and **Enable**.

   <img src="https://multi-google-mcp-tau.vercel.app/setup/2-enable.png" alt="Enable access to APIs, listing the six APIs" width="560">

3. **Set up the sign-in screen.** Open [Google Auth Platform](https://console.cloud.google.com/auth/overview),
   click **Get started**. App name: anything without "Google", "Gmail" or "Inbox". Support email: yours.
   Audience: **External**. Contact email: yours. Tick the policy box, **Continue**, **Create**.

   <img src="https://multi-google-mcp-tau.vercel.app/setup/3-signin.png" alt="Project configuration, App Information step" width="480">

4. **Add the two links Google requires before publishing.** Open
   [Branding](https://console.cloud.google.com/auth/branding) and fill in, then **Save**:
   - Application home page: `https://multi-google-mcp-tau.vercel.app`
   - Application privacy policy link: `https://multi-google-mcp-tau.vercel.app/privacy`
   - Authorized domains, **Add domain**: `multi-google-mcp-tau.vercel.app`

   <img src="https://multi-google-mcp-tau.vercel.app/setup/4-links.png" alt="App domain section with the home page, privacy link and domain" width="480">

5. **Publish the app.** Open [Audience](https://console.cloud.google.com/auth/audience), click
   **Publish app**, then **Confirm**. Ignore the note about verification: the app is only for you.
   Without publishing, Google signs you out every 7 days.

   <img src="https://multi-google-mcp-tau.vercel.app/setup/8-confirm.png" alt="Push to production dialog" width="480">

6. **Create the login key.** Open [Create client](https://console.cloud.google.com/auth/clients/create),
   choose **Desktop app**, click **Create**, then **Download JSON**. Google shows the secret only once.
   The wizard finds the downloaded file by itself.

   <img src="https://multi-google-mcp-tau.vercel.app/setup/6-download.png" alt="OAuth client created dialog with Download JSON" width="420">

### 2. Your accounts

Type each address; a browser tab opens for each. Google warns that it has not verified the app. It is
your own app: click **Advanced**, then **Go to (your app name)**, and tick every box.

<img src="https://multi-google-mcp-tau.vercel.app/setup/9-warning.png" alt="Google hasn't verified this app, with Advanced opened" width="480">

The wizard then checks Gmail, Drive and Calendar on each account and tells you how to fix anything
that fails.

### 3. Claude

It registers the server in Claude Code for all your projects and installs the `/mail-triage` skill.
Other clients (Claude Desktop, Cursor): command `npx`, arguments `-y multi-google-mcp mcp`.

### Manage accounts

```bash
npx multi-google-mcp add you@company.com
npx multi-google-mcp remove you@company.com
npx multi-google-mcp accounts
npx multi-google-mcp check
```

### From source

```bash
git clone https://github.com/taimiyanis/multi-google-mcp.git
cd multi-google-mcp && npm install && npm run setup
```

## FAQ

**Why do I need my own Google project?**
Reading Gmail and Drive are restricted permissions. An app shared by many people needs a paid yearly
security audit from Google. A private app used only by you does not, and your data never touches
anyone else's server.

**"Access blocked: admin_policy_enforced".**
That organisation's Google admin blocks outside apps. Only the admin can allow it.

**Can it read Word, Excel or PowerPoint files?**
Not yet: it reads Google Docs, Sheets and Slides, text files, PDFs and images. Open an Office file in
Google Drive and save it as a Google file first.

**Does it work with Outlook or iCloud?**
No. Google accounts only (Gmail and Google Workspace).

**How is this different from other Google MCP servers?**
Most connect one account. This one is built around running several at once: every search covers
every account, results are merged, drafts and files land in the account you choose, and the
guardrails for shared files and guests are in the code.

## Uninstall

```bash
claude mcp remove multi-google -s user
rm -rf ~/.config/multi-google-mcp ~/.claude/skills/mail-triage
```
Then remove the app's access at https://myaccount.google.com/permissions.

## License

MIT
