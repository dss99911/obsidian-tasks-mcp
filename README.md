# Obsidian Tasks MCP Server

An Obsidian plugin that exposes task management functionality via MCP (Model Context Protocol), enabling AI assistants like Claude to interact with your tasks directly.

## Features

- **Full CRUD operations**: Add, update, remove, and toggle tasks programmatically
- **Query tasks** using Obsidian Tasks syntax with powerful filtering
- **Smart defaults**: Tasks are added to today's Daily Note by default
- **Tasks plugin integration**: When available, leverages Tasks plugin API for proper recurrence handling
- **Real-time vault sync**: Uses Obsidian's Vault API for reliable file operations
- **Rich metadata support**: Dates, priority, tags, recurrence rules

## Installation

### From GitHub Release

1. Go to [Releases](https://github.com/dss99911/obsidian-tasks-mcp/releases)
2. Download `main.js` and `manifest.json` from the latest release
3. In your vault, create folder: `.obsidian/plugins/tasks-mcp/`
4. Copy the downloaded files into this folder
5. Open Obsidian Settings > Community plugins
6. Turn off "Restricted mode" if enabled
7. Find "Tasks MCP Server" and enable it

### Build from Source

```bash
git clone https://github.com/dss99911/obsidian-tasks-mcp.git
cd obsidian-tasks-mcp
npm install
npm run build
```

Copy `main.js` and `manifest.json` to your vault's `.obsidian/plugins/obsidian-tasks-mcp/` folder.

## Local Development

### Setup

1. Clone the repository to your workspace:
   ```bash
   cd ~/Documents/workspace
   git clone https://github.com/dss99911/obsidian-tasks-mcp.git
   ```

2. Install dependencies:
   ```bash
   cd obsidian-tasks-mcp
   npm install
   ```

3. Identify your Obsidian vault's plugin folder:
   ```bash
   # Example: ~/Documents/workspace/obsidian/.obsidian/plugins/obsidian-tasks-mcp/
   ```

### Development Workflow

**Option 1: Symlink (Recommended)**

Create a symlink from your vault's plugin folder to the source:

```bash
# Remove existing plugin folder if exists
rm -rf ~/Documents/workspace/obsidian/.obsidian/plugins/obsidian-tasks-mcp

# Create symlink
ln -s ~/Documents/workspace/obsidian-tasks-mcp ~/Documents/workspace/obsidian/.obsidian/plugins/obsidian-tasks-mcp
```

Now builds will automatically be available to Obsidian.

**Option 2: Manual Copy**

After each build, copy files to the plugin folder:

```bash
npm run build
cp main.js manifest.json ~/Documents/workspace/obsidian/.obsidian/plugins/obsidian-tasks-mcp/
```

### Build Commands

```bash
# Production build
npm run build

# Development build with watch mode
npm run dev
```

### Reload Plugin

After building, reload the plugin in Obsidian:
1. Settings → Community plugins
2. Toggle off "Tasks MCP Server"
3. Toggle on "Tasks MCP Server"

Or restart Obsidian.

## Configuration

### MCP Client Setup

Add to your Claude Code MCP configuration (`~/.claude/mcp.json` or project `.mcp.json`):

```json
{
  "mcpServers": {
    "obsidian-tasks": {
      "type": "http",
      "url": "http://localhost:3789/mcp"
    }
  }
}
```

### Plugin Settings

In Obsidian Settings > Tasks MCP Server:

- **Server Port**: Default 3789, configurable
- **Auto-start**: Server starts automatically when Obsidian launches (default: on)

## Tools

### `add_task`

Add a new task to a file. If no `filePath` is provided, adds to today's Daily Note.

**Parameters:**
- `description` (required): Task description
- `filePath`: Target file path (defaults to Daily Note)
- `dueDate`: Due date in YYYY-MM-DD format
- `scheduledDate`: Scheduled date in YYYY-MM-DD format
- `startDate`: Start date in YYYY-MM-DD format
- `priority`: One of `highest`, `high`, `medium`, `low`, `lowest`
- `tags`: Array of tags (with or without # prefix)
- `recurrence`: Recurrence rule (e.g., "every day", "every week")

### `update_task`

Update an existing task. Provide either `taskId` (from query results) or both `filePath` and `lineNumber`.

**Parameters:**
- `taskId`: Task ID in format "filePath:lineNumber"
- `filePath` + `lineNumber`: Alternative to taskId
- `description`: New task description
- `status`: One of `incomplete`, `complete`, `cancelled`, `in_progress`
- `dueDate`: Due date (empty string to remove)
- `scheduledDate`: Scheduled date (empty string to remove)
- `startDate`: Start date (empty string to remove)
- `priority`: Priority level or `none` to remove
- `tags`: Array of tags (replaces existing)
- `recurrence`: Recurrence rule (empty string to remove)

### `remove_task`

Remove a task from a file.

**Parameters:**
- `taskId`: Task ID in format "filePath:lineNumber"
- `filePath` + `lineNumber`: Alternative to taskId

### `toggle_task`

Toggle a task's completion status. When Tasks plugin is available, properly handles:
- Completion dates
- Recurring tasks (creates next occurrence)
- Custom status symbols

**Parameters:**
- `taskId`: Task ID in format "filePath:lineNumber"
- `filePath` + `lineNumber`: Alternative to taskId

### `query_tasks`

Search tasks using Obsidian Tasks query syntax. Each line is a filter with AND logic.

**Supported filters:**

| Category | Filters |
|----------|---------|
| Status | `done`, `not done`, `cancelled`, `in progress` |
| Due date | `due today`, `due before today`, `due after today`, `overdue`, `due YYYY-MM-DD`, `due before YYYY-MM-DD`, `due after YYYY-MM-DD`, `has due date`, `no due date` |
| Scheduled | `scheduled today`, `scheduled before today`, `has scheduled date`, `no scheduled date` |
| Start date | `starts today`, `starts before today`, `has start date`, `no start date` |
| Tags | `has tags`, `no tags`, `tag includes #tag`, `tag does not include #tag` |
| Path | `path includes <string>`, `path does not include <string>` |
| Description | `description includes <string>`, `description does not include <string>` |
| Priority | `priority is highest/high/medium/low/lowest/none` |
| Recurrence | `is recurring`, `is not recurring` |
| Boolean | `<filter1> AND <filter2>`, `<filter1> OR <filter2>`, `NOT <filter>` |

**Example:**
```
not done
due before 2025-05-01
tag includes #work
priority is high
```

### `list_tasks`

Lists all tasks from a specific file or all markdown files with metadata including:
- Status, description, file path, line number
- Due date, scheduled date, start date, created date
- Tags, priority, recurrence rules

### `get_tasks_by_date`

Gets tasks for a specific due date with optional overdue task inclusion.

**Parameters:**
- `date` (required): Due date in YYYY-MM-DD format
- `includeOverdue`: Include overdue tasks (default: false)

## API Endpoints

- `POST /mcp` - MCP JSON-RPC endpoint
- `GET /sse` - Server-Sent Events connection
- `GET /health` - Health check (returns Tasks plugin availability)

## Requirements

- Obsidian v1.0.0+
- [Tasks plugin](https://github.com/obsidian-tasks-group/obsidian-tasks) (optional, recommended for recurrence handling)

> The plugin works without Tasks plugin installed. When Tasks plugin is available, `toggle_task` uses its API for proper recurrence handling.

## Commands

- **Toggle MCP Server**: Start/stop the server manually
- **Show MCP Server Status**: Display current server status

## Task Format

Recognizes standard Obsidian Tasks format:

- Checkbox: `- [ ]` (incomplete), `- [x]` (complete), `- [-]` (cancelled), `- [/]` (in progress)
- Due date: `📅 YYYY-MM-DD` or `🗓️ YYYY-MM-DD`
- Scheduled date: `⏳ YYYY-MM-DD`
- Start date: `🛫 YYYY-MM-DD`
- Created date: `➕ YYYY-MM-DD`
- Priority: `⏫⏫` (highest), `⏫` (high), `🔼` (medium), `🔽` (low), `⏬` (lowest)
- Recurrence: `🔁 every day/week/month`
- Tags: `#tag1 #tag2`

**Example:**
```
- [ ] Complete project report 📅 2025-05-01 ⏳ 2025-04-25 #work ⏫
```

## Security Note

This plugin runs an HTTP server on localhost. Only local applications can connect to it. If you need remote access, consider using a secure tunnel.

## Documentation

- [Blog: Manage Obsidian Tasks with AI - Tasks MCP Plugin Guide](https://dss99911.github.io/tools/obsidian/2026/01/06/Obsidian-Tasks-MCP-Plugin.html) - Detailed guide with use cases and examples

## License

MIT License
