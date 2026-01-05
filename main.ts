import { App, Notice, Plugin, PluginSettingTab, Setting, TFile } from 'obsidian';
import * as http from 'http';

// Tasks API interface
interface TasksApiV1 {
	createTaskLineModal(): Promise<string>;
	editTaskLineModal(taskLine: string): Promise<string>;
	executeToggleTaskDoneCommand: (line: string, path: string) => string;
}

// Extended App interface for accessing internal plugins
interface AppWithPlugins extends App {
	plugins?: {
		plugins?: Record<string, { apiV1?: TasksApiV1 }>;
	};
	internalPlugins?: {
		plugins?: Record<string, { instance?: { options?: { folder?: string; format?: string } } }>;
	};
}

interface TasksMcpSettings {
	port: number;
	enableServer: boolean;
}

const DEFAULT_SETTINGS: TasksMcpSettings = {
	port: 3789,
	enableServer: true
}

// MCP Protocol types
interface JsonRpcRequest {
	jsonrpc: '2.0';
	id: string | number;
	method: string;
	params?: unknown;
}

interface JsonRpcResponse {
	jsonrpc: '2.0';
	id: string | number | null;
	result?: unknown;
	error?: {
		code: number;
		message: string;
		data?: unknown;
	};
}

interface McpTool {
	name: string;
	description: string;
	inputSchema: {
		type: string;
		properties: Record<string, unknown>;
		required?: string[];
	};
}

// Task interface with rich metadata
interface Task {
	id: string;
	description: string;
	status: 'complete' | 'incomplete' | 'cancelled' | 'in_progress';
	statusSymbol: string;
	filePath: string;
	lineNumber: number;
	tags: string[];
	dueDate?: string;
	scheduledDate?: string;
	createdDate?: string;
	startDate?: string;
	priority?: 'highest' | 'high' | 'medium' | 'low' | 'lowest';
	recurrence?: string;
	originalMarkdown: string;
}

// Task parsing utilities
class TaskParser {
	static readonly taskRegex = /^([\s\t>]*)([-*+]|[0-9]+[.)]) +\[(.)\] *(.*)/u;
	static readonly hashTagsRegex = /(^|\s)#[^ !@#$%^&*(),.?":{}|<>]+/g;
	static readonly dueDateRegex = /[📅🗓️]\s?(\d{4}-\d{2}-\d{2})/u;
	static readonly scheduledDateRegex = /⏳\s?(\d{4}-\d{2}-\d{2})/u;
	static readonly startDateRegex = /🛫\s?(\d{4}-\d{2}-\d{2})/u;
	static readonly createdDateRegex = /➕\s?(\d{4}-\d{2}-\d{2})/u;
	static readonly recurrenceRegex = /🔁\s?(.*?)(?=(\s|$))/u;

	static parseTaskLine(line: string, filePath: string, lineNumber: number): Task | null {
		const match = line.match(this.taskRegex);
		if (!match) return null;

		const statusChar = match[3];
		const description = match[4].trim();

		// Extract tags
		const tags = (description.match(this.hashTagsRegex) || [])
			.map(tag => tag.trim())
			.filter(tag => tag.length > 0);

		// Extract dates
		const dueMatch = description.match(this.dueDateRegex);
		const scheduledMatch = description.match(this.scheduledDateRegex);
		const startMatch = description.match(this.startDateRegex);
		const createdMatch = description.match(this.createdDateRegex);
		const recurrenceMatch = description.match(this.recurrenceRegex);

		// Determine priority
		let priority: Task['priority'] = undefined;
		const priorityMatches = description.match(/⏫⏫|⏫|🔼|🔽|⏬/g);
		if (priorityMatches && priorityMatches.length > 0) {
			const firstPriority = priorityMatches[0];
			if (firstPriority === '⏫⏫') priority = 'highest';
			else if (firstPriority === '⏫') priority = 'high';
			else if (firstPriority === '🔼') priority = 'medium';
			else if (firstPriority === '🔽') priority = 'low';
			else if (firstPriority === '⏬') priority = 'lowest';
		}

		// Determine status
		let status: Task['status'] = 'incomplete';
		if (['x', 'X'].includes(statusChar)) {
			status = 'complete';
		} else if (statusChar === '-') {
			status = 'cancelled';
		} else if (statusChar === '/') {
			status = 'in_progress';
		}

		return {
			id: `${filePath}:${lineNumber}`,
			description,
			status,
			statusSymbol: statusChar,
			filePath,
			lineNumber,
			tags,
			dueDate: dueMatch ? dueMatch[1] : undefined,
			scheduledDate: scheduledMatch ? scheduledMatch[1] : undefined,
			startDate: startMatch ? startMatch[1] : undefined,
			createdDate: createdMatch ? createdMatch[1] : undefined,
			priority,
			recurrence: recurrenceMatch ? recurrenceMatch[1] : undefined,
			originalMarkdown: line
		};
	}

	static getToday(): string {
		return new Date().toISOString().split('T')[0];
	}

	static applyFilter(task: Task, filter: string): boolean {
		filter = filter.toLowerCase().trim();

		// Boolean combinations
		if (filter.includes(' and ')) {
			const parts = filter.split(' and ');
			return parts.every(part => this.applyFilter(task, part.trim()));
		}

		if (filter.includes(' or ')) {
			const parts = filter.split(' or ');
			return parts.some(part => this.applyFilter(task, part.trim()));
		}

		if (filter.startsWith('not ') && filter !== 'not done') {
			const subFilter = filter.substring(4);
			return !this.applyFilter(task, subFilter);
		}

		// Status filters
		if (filter === 'done') {
			return task.status === 'complete';
		}
		if (filter === 'not done') {
			return task.status === 'incomplete' || task.status === 'in_progress';
		}
		if (filter === 'cancelled') {
			return task.status === 'cancelled';
		}
		if (filter === 'in progress') {
			return task.status === 'in_progress';
		}

		// Due date filters
		const today = this.getToday();

		if (filter === 'due today') {
			return task.dueDate === today;
		}
		if (filter === 'due before today' || filter === 'overdue') {
			return task.dueDate !== undefined && task.dueDate < today;
		}
		if (filter === 'due after today') {
			return task.dueDate !== undefined && task.dueDate > today;
		}
		if (filter === 'no due date') {
			return task.dueDate === undefined;
		}
		if (filter === 'has due date') {
			return task.dueDate !== undefined;
		}

		// Due date with specific date
		const dueDateMatch = filter.match(/^due\s+(?:on\s+)?(\d{4}-\d{2}-\d{2})$/);
		if (dueDateMatch) {
			return task.dueDate === dueDateMatch[1];
		}

		const dueBeforeMatch = filter.match(/^due\s+before\s+(\d{4}-\d{2}-\d{2})$/);
		if (dueBeforeMatch) {
			return task.dueDate !== undefined && task.dueDate < dueBeforeMatch[1];
		}

		const dueAfterMatch = filter.match(/^due\s+after\s+(\d{4}-\d{2}-\d{2})$/);
		if (dueAfterMatch) {
			return task.dueDate !== undefined && task.dueDate > dueAfterMatch[1];
		}

		// Scheduled date filters
		if (filter === 'scheduled today') {
			return task.scheduledDate === today;
		}
		if (filter === 'scheduled before today') {
			return task.scheduledDate !== undefined && task.scheduledDate < today;
		}
		if (filter === 'no scheduled date') {
			return task.scheduledDate === undefined;
		}
		if (filter === 'has scheduled date') {
			return task.scheduledDate !== undefined;
		}

		// Start date filters
		if (filter === 'starts today') {
			return task.startDate === today;
		}
		if (filter === 'starts before today') {
			return task.startDate !== undefined && task.startDate < today;
		}
		if (filter === 'no start date') {
			return task.startDate === undefined;
		}
		if (filter === 'has start date') {
			return task.startDate !== undefined;
		}

		// Tag filters
		if (filter === 'no tags') {
			return !task.tags || task.tags.length === 0;
		}
		if (filter === 'has tags') {
			return task.tags && task.tags.length > 0;
		}
		if (filter.startsWith('tag includes ') || filter.startsWith('tag include ')) {
			const tagToFind = filter.replace(/^tag includes? /, '').trim().replace(/^#/, '');
			return task.tags && task.tags.some(tag => tag.replace(/^#/, '').toLowerCase().includes(tagToFind));
		}
		if (filter.startsWith('tag does not include ') || filter.startsWith('tag do not include ')) {
			const tagToExclude = filter.replace(/^tag (does not|do not) include /, '').trim().replace(/^#/, '');
			return !task.tags || !task.tags.some(tag => tag.replace(/^#/, '').toLowerCase().includes(tagToExclude));
		}

		// Path filters
		if (filter.startsWith('path includes ')) {
			const pathToFind = filter.replace('path includes ', '').trim();
			return task.filePath.toLowerCase().includes(pathToFind.toLowerCase());
		}
		if (filter.startsWith('path does not include ')) {
			const pathToExclude = filter.replace('path does not include ', '').trim();
			return !task.filePath.toLowerCase().includes(pathToExclude.toLowerCase());
		}

		// Description filters
		if (filter.startsWith('description includes ')) {
			const textToFind = filter.replace('description includes ', '').trim();
			return task.description.toLowerCase().includes(textToFind.toLowerCase());
		}
		if (filter.startsWith('description does not include ')) {
			const textToExclude = filter.replace('description does not include ', '').trim();
			return !task.description.toLowerCase().includes(textToExclude.toLowerCase());
		}

		// Priority filters
		if (filter.startsWith('priority is ')) {
			const priority = filter.replace('priority is ', '').trim();
			if (priority === 'none') {
				return task.priority === undefined;
			}
			return task.priority === priority;
		}

		// Recurrence filter
		if (filter === 'is recurring') {
			return task.recurrence !== undefined;
		}
		if (filter === 'is not recurring') {
			return task.recurrence === undefined;
		}

		// Default: check if description contains the filter text
		return task.description.toLowerCase().includes(filter);
	}

	static queryTasks(tasks: Task[], queryText: string): Task[] {
		const filters = queryText.split('\n')
			.map(line => line.trim())
			.filter(line => line && !line.startsWith('#'));

		return tasks.filter(task => {
			for (const filter of filters) {
				if (!this.applyFilter(task, filter)) {
					return false;
				}
			}
			return true;
		});
	}
}

export default class TasksMcpPlugin extends Plugin {
	settings: TasksMcpSettings;
	server: http.Server | null = null;

	async onload() {
		await this.loadSettings();

		// Add settings tab
		this.addSettingTab(new TasksMcpSettingTab(this.app, this));

		// Add command to start/stop server
		this.addCommand({
			id: 'toggle-mcp-server',
			// eslint-disable-next-line obsidianmd/ui/sentence-case -- MCP is an acronym
			name: 'Toggle MCP server',
			callback: () => {
				if (this.server) {
					this.stopServer();
				} else {
					this.startServer();
				}
			}
		});

		this.addCommand({
			id: 'show-server-status',
			// eslint-disable-next-line obsidianmd/ui/sentence-case -- MCP is an acronym
			name: 'Show MCP server status',
			callback: () => {
				if (this.server) {
					new Notice(`MCP server running on port ${this.settings.port}`);
				} else {
					// eslint-disable-next-line obsidianmd/ui/sentence-case -- MCP is an acronym
					new Notice('MCP server is not running');
				}
			}
		});

		// Auto-start server if enabled
		if (this.settings.enableServer) {
			// Delay to ensure Tasks plugin is loaded
			setTimeout(() => this.startServer(), 2000);
		}
	}

	onunload() {
		this.stopServer();
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	getTasksApi(): TasksApiV1 | null {
		const tasksPlugin = (this.app as AppWithPlugins).plugins?.plugins?.['obsidian-tasks-plugin'];
		if (!tasksPlugin?.apiV1) {
			return null;
		}
		return tasksPlugin.apiV1;
	}

	getDailyNotePath(): string {
		const today = new Date();
		const year = today.getFullYear();
		const month = String(today.getMonth() + 1).padStart(2, '0');
		const day = String(today.getDate()).padStart(2, '0');

		// Try to get Daily Notes plugin settings
		const dailyNotesPlugin = (this.app as AppWithPlugins).internalPlugins?.plugins?.['daily-notes'];
		const options = dailyNotesPlugin?.instance?.options;

		let folder = options?.folder || 'Daily Notes';
		const format = options?.format || 'YYYY-MM-DD';

		// Simple format replacement
		let filename = format
			.replace('YYYY', String(year))
			.replace('MM', month)
			.replace('DD', day);

		// Ensure .md extension
		if (!filename.endsWith('.md')) {
			filename += '.md';
		}

		// Build full path
		if (folder && !folder.endsWith('/')) {
			folder += '/';
		}

		return folder + filename;
	}

	buildTaskMarkdown(args: {
		description: string;
		dueDate?: string;
		scheduledDate?: string;
		startDate?: string;
		priority?: string;
		tags?: string[];
		recurrence?: string;
	}): string {
		let task = `- [ ] ${args.description}`;

		// Add priority emoji
		if (args.priority) {
			const priorityEmojis: Record<string, string> = {
				highest: '⏫⏫',
				high: '⏫',
				medium: '🔼',
				low: '🔽',
				lowest: '⏬'
			};
			if (priorityEmojis[args.priority]) {
				task += ` ${priorityEmojis[args.priority]}`;
			}
		}

		// Add recurrence
		if (args.recurrence) {
			task += ` 🔁 ${args.recurrence}`;
		}

		// Add dates
		if (args.startDate) {
			task += ` 🛫 ${args.startDate}`;
		}
		if (args.scheduledDate) {
			task += ` ⏳ ${args.scheduledDate}`;
		}
		if (args.dueDate) {
			task += ` 📅 ${args.dueDate}`;
		}

		// Add tags
		if (args.tags && args.tags.length > 0) {
			const formattedTags = args.tags.map(tag => tag.startsWith('#') ? tag : `#${tag}`);
			task += ` ${formattedTags.join(' ')}`;
		}

		return task;
	}

	async addTaskToFile(filePath: string, taskMarkdown: string): Promise<{ success: boolean; filePath: string; task: string }> {
		const file = this.app.vault.getAbstractFileByPath(filePath);

		// Create file if it doesn't exist
		if (!file) {
			// Ensure parent folder exists
			const folderPath = filePath.substring(0, filePath.lastIndexOf('/'));
			if (folderPath) {
				const folder = this.app.vault.getAbstractFileByPath(folderPath);
				if (!folder) {
					await this.app.vault.createFolder(folderPath);
				}
			}

			// Create file with task
			await this.app.vault.create(filePath, taskMarkdown + '\n');
			return { success: true, filePath, task: taskMarkdown };
		}

		if (!(file instanceof TFile)) {
			throw new Error(`${filePath} is not a file`);
		}

		// Append task to existing file
		const content = await this.app.vault.read(file);
		const newContent = content.endsWith('\n')
			? content + taskMarkdown + '\n'
			: content + '\n' + taskMarkdown + '\n';

		await this.app.vault.modify(file, newContent);
		return { success: true, filePath, task: taskMarkdown };
	}

	async updateTaskInFile(filePath: string, lineNumber: number, newTaskMarkdown: string): Promise<{ success: boolean; filePath: string; lineNumber: number; oldTask: string; newTask: string }> {
		const file = this.app.vault.getAbstractFileByPath(filePath);
		if (!file || !(file instanceof TFile)) {
			throw new Error(`File not found: ${filePath}`);
		}

		const content = await this.app.vault.read(file);
		const lines = content.split('\n');

		if (lineNumber < 1 || lineNumber > lines.length) {
			throw new Error(`Invalid line number: ${lineNumber}. File has ${lines.length} lines.`);
		}

		const oldTask = lines[lineNumber - 1];
		lines[lineNumber - 1] = newTaskMarkdown;

		await this.app.vault.modify(file, lines.join('\n'));
		return { success: true, filePath, lineNumber, oldTask, newTask: newTaskMarkdown };
	}

	async removeTaskFromFile(filePath: string, lineNumber: number): Promise<{ success: boolean; filePath: string; lineNumber: number; removedTask: string }> {
		const file = this.app.vault.getAbstractFileByPath(filePath);
		if (!file || !(file instanceof TFile)) {
			throw new Error(`File not found: ${filePath}`);
		}

		const content = await this.app.vault.read(file);
		const lines = content.split('\n');

		if (lineNumber < 1 || lineNumber > lines.length) {
			throw new Error(`Invalid line number: ${lineNumber}. File has ${lines.length} lines.`);
		}

		const removedTask = lines[lineNumber - 1];
		lines.splice(lineNumber - 1, 1);

		await this.app.vault.modify(file, lines.join('\n'));
		return { success: true, filePath, lineNumber, removedTask };
	}

	parseTaskId(id: string): { filePath: string; lineNumber: number } {
		const lastColon = id.lastIndexOf(':');
		if (lastColon === -1) {
			throw new Error(`Invalid task ID format: ${id}. Expected format: filePath:lineNumber`);
		}
		const filePath = id.substring(0, lastColon);
		const lineNumber = parseInt(id.substring(lastColon + 1));
		if (isNaN(lineNumber)) {
			throw new Error(`Invalid line number in task ID: ${id}`);
		}
		return { filePath, lineNumber };
	}

	startServer() {
		if (this.server) {
			// eslint-disable-next-line obsidianmd/ui/sentence-case -- MCP is an acronym
			new Notice('MCP server is already running');
			return;
		}

		this.server = http.createServer((req, res) => {
			// CORS headers
			res.setHeader('Access-Control-Allow-Origin', '*');
			res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
			res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

			if (req.method === 'OPTIONS') {
				res.writeHead(200);
				res.end();
				return;
			}

			// SSE endpoint
			if (req.url === '/sse' && req.method === 'GET') {
				res.writeHead(200, {
					'Content-Type': 'text/event-stream',
					'Cache-Control': 'no-cache',
					'Connection': 'keep-alive'
				});

				// Send initial connection event
				res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);

				// Keep connection alive
				const keepAlive = setInterval(() => {
					res.write(': keepalive\n\n');
				}, 30000);

				req.on('close', () => {
					clearInterval(keepAlive);
				});

				return;
			}

			// MCP JSON-RPC endpoint
			if (req.url === '/mcp' && req.method === 'POST') {
				let body = '';
				req.on('data', chunk => body += chunk);
				req.on('end', () => {
					void (async () => {
						try {
							const request: JsonRpcRequest = JSON.parse(body);
							const response = await this.handleMcpRequest(request);
							res.writeHead(200, { 'Content-Type': 'application/json' });
							res.end(JSON.stringify(response));
						} catch (e) {
							const error: JsonRpcResponse = {
								jsonrpc: '2.0',
								id: null,
								error: {
									code: -32700,
									message: 'Parse error',
									data: e instanceof Error ? e.message : String(e)
								}
							};
							res.writeHead(400, { 'Content-Type': 'application/json' });
							res.end(JSON.stringify(error));
						}
					})();
				});
				return;
			}

			// Health check
			if (req.url === '/health') {
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ status: 'ok', tasksApiAvailable: this.getTasksApi() !== null }));
				return;
			}

			res.writeHead(404);
			res.end('Not found');
		});

		this.server.listen(this.settings.port, () => {
			new Notice(`MCP server started on port ${this.settings.port}`);
			console.debug(`Tasks MCP server listening on http://localhost:${this.settings.port}`);
		});

		this.server.on('error', (err: NodeJS.ErrnoException) => {
			if (err.code === 'EADDRINUSE') {
				new Notice(`Port ${this.settings.port} is already in use`);
			} else {
				new Notice(`Server error: ${err.message}`);
			}
			this.server = null;
		});
	}

	stopServer() {
		if (this.server) {
			this.server.close();
			this.server = null;
			// eslint-disable-next-line obsidianmd/ui/sentence-case -- MCP is an acronym
			new Notice('MCP server stopped');
		}
	}

	async handleMcpRequest(request: JsonRpcRequest): Promise<JsonRpcResponse> {
		const { method, params, id } = request;

		switch (method) {
			case 'initialize':
				return {
					jsonrpc: '2.0',
					id,
					result: {
						protocolVersion: '2024-11-05',
						serverInfo: {
							name: 'obsidian-tasks-mcp',
							version: '1.1.0'
						},
						capabilities: {
							tools: {}
						}
					}
				};

			case 'tools/list':
				return {
					jsonrpc: '2.0',
					id,
					result: {
						tools: this.getToolList()
					}
				};

			case 'tools/call':
				return await this.handleToolCall(id, params as { name: string; arguments: Record<string, unknown> });

			default:
				return {
					jsonrpc: '2.0',
					id,
					error: {
						code: -32601,
						message: `Method not found: ${method}`
					}
				};
		}
	}

	getToolList(): McpTool[] {
		return [
			{
				name: 'add_task',
				description: 'Add a new task to a file. If no filePath is provided, adds to today\'s Daily Note.',
				inputSchema: {
					type: 'object',
					properties: {
						description: {
							type: 'string',
							description: 'Task description (required)'
						},
						filePath: {
							type: 'string',
							description: 'File path to add the task. Defaults to today\'s Daily Note if not provided.'
						},
						dueDate: {
							type: 'string',
							description: 'Due date in YYYY-MM-DD format'
						},
						scheduledDate: {
							type: 'string',
							description: 'Scheduled date in YYYY-MM-DD format'
						},
						startDate: {
							type: 'string',
							description: 'Start date in YYYY-MM-DD format'
						},
						priority: {
							type: 'string',
							enum: ['highest', 'high', 'medium', 'low', 'lowest'],
							description: 'Task priority'
						},
						tags: {
							type: 'array',
							items: { type: 'string' },
							description: 'Array of tags (with or without # prefix)'
						},
						recurrence: {
							type: 'string',
							description: 'Recurrence rule (e.g., "every day", "every week", "every month")'
						}
					},
					required: ['description']
				}
			},
			{
				name: 'update_task',
				description: 'Update an existing task. Provide either taskId (filePath:lineNumber) or both filePath and lineNumber.',
				inputSchema: {
					type: 'object',
					properties: {
						taskId: {
							type: 'string',
							description: 'Task ID in format "filePath:lineNumber" (from query_tasks result)'
						},
						filePath: {
							type: 'string',
							description: 'File path containing the task (alternative to taskId)'
						},
						lineNumber: {
							type: 'number',
							description: 'Line number of the task (1-based, alternative to taskId)'
						},
						description: {
							type: 'string',
							description: 'New task description'
						},
						dueDate: {
							type: 'string',
							description: 'Due date in YYYY-MM-DD format (use empty string to remove)'
						},
						scheduledDate: {
							type: 'string',
							description: 'Scheduled date in YYYY-MM-DD format (use empty string to remove)'
						},
						startDate: {
							type: 'string',
							description: 'Start date in YYYY-MM-DD format (use empty string to remove)'
						},
						priority: {
							type: 'string',
							enum: ['highest', 'high', 'medium', 'low', 'lowest', 'none'],
							description: 'Task priority (use "none" to remove)'
						},
						tags: {
							type: 'array',
							items: { type: 'string' },
							description: 'Array of tags (replaces existing tags)'
						},
						recurrence: {
							type: 'string',
							description: 'Recurrence rule (use empty string to remove)'
						},
						status: {
							type: 'string',
							enum: ['incomplete', 'complete', 'cancelled', 'in_progress'],
							description: 'Task status'
						}
					}
				}
			},
			{
				name: 'remove_task',
				description: 'Remove a task from a file. Provide either taskId or both filePath and lineNumber.',
				inputSchema: {
					type: 'object',
					properties: {
						taskId: {
							type: 'string',
							description: 'Task ID in format "filePath:lineNumber"'
						},
						filePath: {
							type: 'string',
							description: 'File path containing the task'
						},
						lineNumber: {
							type: 'number',
							description: 'Line number of the task (1-based)'
						}
					}
				}
			},
			{
				name: 'toggle_task',
				description: 'Toggle a task between done and not done. Uses Tasks plugin API for proper recurrence handling.',
				inputSchema: {
					type: 'object',
					properties: {
						taskId: {
							type: 'string',
							description: 'Task ID in format "filePath:lineNumber"'
						},
						filePath: {
							type: 'string',
							description: 'File path containing the task'
						},
						lineNumber: {
							type: 'number',
							description: 'Line number of the task (1-based)'
						}
					}
				}
			},
			{
				name: 'list_tasks',
				description: 'Lists all tasks from a specific file or all markdown files with rich metadata',
				inputSchema: {
					type: 'object',
					properties: {
						filePath: {
							type: 'string',
							description: 'Optional: Path to a specific file. If not provided, searches all markdown files.'
						}
					}
				}
			},
			{
				name: 'query_tasks',
				description: `Search for tasks using Obsidian Tasks query syntax. Each line is a filter (AND logic between lines).

Supported filters:
- Status: done, not done, cancelled, in progress
- Due dates: due today, due before today, due after today, overdue, due YYYY-MM-DD, due before YYYY-MM-DD, due after YYYY-MM-DD, has due date, no due date
- Scheduled: scheduled today, scheduled before today, has scheduled date, no scheduled date
- Start: starts today, starts before today, has start date, no start date
- Tags: has tags, no tags, tag includes #tag, tag does not include #tag
- Path: path includes string, path does not include string
- Description: description includes string, description does not include string
- Priority: priority is highest/high/medium/low/lowest/none
- Recurrence: is recurring, is not recurring
- Boolean: filter1 AND filter2, filter1 OR filter2, NOT filter

Example query:
not done
due before 2025-05-01
tag includes #work`,
				inputSchema: {
					type: 'object',
					properties: {
						query: {
							type: 'string',
							description: 'Query string using Obsidian Tasks syntax. Each line is a filter.'
						},
						filePath: {
							type: 'string',
							description: 'Optional: Path to search. If not provided, searches all markdown files.'
						}
					},
					required: ['query']
				}
			},
			{
				name: 'get_tasks_by_date',
				description: 'Gets tasks with a specific due date or date range',
				inputSchema: {
					type: 'object',
					properties: {
						date: {
							type: 'string',
							description: 'Due date in YYYY-MM-DD format'
						},
						includeOverdue: {
							type: 'boolean',
							description: 'Include overdue tasks (default: false)'
						}
					},
					required: ['date']
				}
			}
		];
	}

	async handleToolCall(id: string | number, params: { name: string; arguments: Record<string, unknown> }): Promise<JsonRpcResponse> {
		const { name, arguments: args } = params;
		const tasksApi = this.getTasksApi();

		try {
			switch (name) {
				case 'toggle_task': {
					// Resolve filePath and lineNumber
					let filePath: string;
					let lineNumber: number;

					if (args.taskId) {
						const parsed = this.parseTaskId(args.taskId as string);
						filePath = parsed.filePath;
						lineNumber = parsed.lineNumber;
					} else if (args.filePath && args.lineNumber) {
						filePath = args.filePath as string;
						lineNumber = args.lineNumber as number;
					} else {
						return this.errorResponse(id, 'Either taskId or both filePath and lineNumber are required');
					}

					// Get the task line from the file
					const file = this.app.vault.getAbstractFileByPath(filePath);
					if (!file || !(file instanceof TFile)) {
						return this.errorResponse(id, `File not found: ${filePath}`);
					}

					const content = await this.app.vault.read(file);
					const lines = content.split('\n');
					if (lineNumber < 1 || lineNumber > lines.length) {
						return this.errorResponse(id, `Invalid line number: ${lineNumber}`);
					}

					const taskLine = lines[lineNumber - 1];

					// Use Tasks API if available for proper recurrence handling
					if (tasksApi) {
						const result = tasksApi.executeToggleTaskDoneCommand(taskLine, filePath);
						// The API returns the new task line but doesn't modify the file
						// We need to apply the change ourselves
						lines[lineNumber - 1] = result;
						await this.app.vault.modify(file, lines.join('\n'));
						return {
							jsonrpc: '2.0',
							id,
							result: {
								content: [{
									type: 'text',
									text: JSON.stringify({ success: true, filePath, lineNumber, oldTask: taskLine, newTask: result }, null, 2)
								}]
							}
						};
					}

					// Fallback: toggle manually if Tasks plugin not available
					const task = TaskParser.parseTaskLine(taskLine, filePath, lineNumber);
					if (!task) {
						return this.errorResponse(id, `No task found at ${filePath}:${lineNumber}`);
					}

					let newStatusChar: string;
					if (task.status === 'complete') {
						newStatusChar = ' ';
					} else {
						newStatusChar = 'x';
					}

					const newTaskLine = taskLine.replace(/\[.\]/, `[${newStatusChar}]`);
					lines[lineNumber - 1] = newTaskLine;
					await this.app.vault.modify(file, lines.join('\n'));

					return {
						jsonrpc: '2.0',
						id,
						result: {
							content: [{
								type: 'text',
								text: JSON.stringify({ success: true, filePath, lineNumber, oldTask: taskLine, newTask: newTaskLine }, null, 2)
							}]
						}
					};
				}

				case 'update_task': {
					// Resolve filePath and lineNumber
					let filePath: string;
					let lineNumber: number;

					if (args.taskId) {
						const parsed = this.parseTaskId(args.taskId as string);
						filePath = parsed.filePath;
						lineNumber = parsed.lineNumber;
					} else if (args.filePath && args.lineNumber) {
						filePath = args.filePath as string;
						lineNumber = args.lineNumber as number;
					} else {
						return this.errorResponse(id, 'Either taskId or both filePath and lineNumber are required');
					}

					// Get current task
					const file = this.app.vault.getAbstractFileByPath(filePath);
					if (!file || !(file instanceof TFile)) {
						return this.errorResponse(id, `File not found: ${filePath}`);
					}

					const content = await this.app.vault.read(file);
					const lines = content.split('\n');
					if (lineNumber < 1 || lineNumber > lines.length) {
						return this.errorResponse(id, `Invalid line number: ${lineNumber}`);
					}

					const currentLine = lines[lineNumber - 1];
					const currentTask = TaskParser.parseTaskLine(currentLine, filePath, lineNumber);
					if (!currentTask) {
						return this.errorResponse(id, `No task found at ${filePath}:${lineNumber}`);
					}

					// Build updated task with merged properties
					const newDescription = args.description !== undefined ? args.description as string : currentTask.description
						// Remove existing metadata from description for rebuilding
						.replace(/[📅🗓️]\s?\d{4}-\d{2}-\d{2}/gu, '')
						.replace(/⏳\s?\d{4}-\d{2}-\d{2}/gu, '')
						.replace(/🛫\s?\d{4}-\d{2}-\d{2}/gu, '')
						.replace(/➕\s?\d{4}-\d{2}-\d{2}/gu, '')
						.replace(/🔁\s?[^\s]*/gu, '')
						.replace(/⏫⏫|⏫|🔼|🔽|⏬/gu, '')
						.replace(/(^|\s)#[^\s]+/g, '')
						.trim();

					// Determine status
					let statusChar = currentTask.statusSymbol;
					if (args.status !== undefined) {
						const statusMap: Record<string, string> = {
							'incomplete': ' ',
							'complete': 'x',
							'cancelled': '-',
							'in_progress': '/'
						};
						statusChar = statusMap[args.status as string] || statusChar;
					}

					// Determine other properties (use new value if provided, else keep current)
					const dueDate = args.dueDate !== undefined
						? (args.dueDate === '' ? undefined : args.dueDate as string)
						: currentTask.dueDate;
					const scheduledDate = args.scheduledDate !== undefined
						? (args.scheduledDate === '' ? undefined : args.scheduledDate as string)
						: currentTask.scheduledDate;
					const startDate = args.startDate !== undefined
						? (args.startDate === '' ? undefined : args.startDate as string)
						: currentTask.startDate;
					const priority = args.priority !== undefined
						? (args.priority === 'none' ? undefined : args.priority as string)
						: currentTask.priority;
					const tags = args.tags !== undefined
						? args.tags as string[]
						: currentTask.tags;
					const recurrence = args.recurrence !== undefined
						? (args.recurrence === '' ? undefined : args.recurrence as string)
						: currentTask.recurrence;

					// Get indentation from original line
					const indentMatch = currentLine.match(/^([\s\t>]*)([-*+]|[0-9]+[.)])/);
					const indent = indentMatch ? indentMatch[1] : '';
					const marker = indentMatch ? indentMatch[2] : '-';

					// Build new task markdown
					let newTaskMarkdown = `${indent}${marker} [${statusChar}] ${newDescription}`;

					// Add priority
					if (priority) {
						const priorityEmojis: Record<string, string> = {
							highest: '⏫⏫',
							high: '⏫',
							medium: '🔼',
							low: '🔽',
							lowest: '⏬'
						};
						if (priorityEmojis[priority]) {
							newTaskMarkdown += ` ${priorityEmojis[priority]}`;
						}
					}

					// Add recurrence
					if (recurrence) {
						newTaskMarkdown += ` 🔁 ${recurrence}`;
					}

					// Add dates
					if (startDate) {
						newTaskMarkdown += ` 🛫 ${startDate}`;
					}
					if (scheduledDate) {
						newTaskMarkdown += ` ⏳ ${scheduledDate}`;
					}
					if (dueDate) {
						newTaskMarkdown += ` 📅 ${dueDate}`;
					}

					// Add tags
					if (tags && tags.length > 0) {
						const formattedTags = tags.map(tag => tag.startsWith('#') ? tag : `#${tag}`);
						newTaskMarkdown += ` ${formattedTags.join(' ')}`;
					}

					const result = await this.updateTaskInFile(filePath, lineNumber, newTaskMarkdown);
					return {
						jsonrpc: '2.0',
						id,
						result: {
							content: [{
								type: 'text',
								text: JSON.stringify(result, null, 2)
							}]
						}
					};
				}

				case 'remove_task': {
					// Resolve filePath and lineNumber
					let filePath: string;
					let lineNumber: number;

					if (args.taskId) {
						const parsed = this.parseTaskId(args.taskId as string);
						filePath = parsed.filePath;
						lineNumber = parsed.lineNumber;
					} else if (args.filePath && args.lineNumber) {
						filePath = args.filePath as string;
						lineNumber = args.lineNumber as number;
					} else {
						return this.errorResponse(id, 'Either taskId or both filePath and lineNumber are required');
					}

					const result = await this.removeTaskFromFile(filePath, lineNumber);
					return {
						jsonrpc: '2.0',
						id,
						result: {
							content: [{
								type: 'text',
								text: JSON.stringify(result, null, 2)
							}]
						}
					};
				}

				case 'list_tasks': {
					const filePath = args.filePath as string | undefined;
					const tasks = await this.getAllTasks(filePath);
					return {
						jsonrpc: '2.0',
						id,
						result: {
							content: [{
								type: 'text',
								text: JSON.stringify(tasks, null, 2)
							}]
						}
					};
				}

				case 'query_tasks': {
					const query = args.query as string;
					const filePath = args.filePath as string | undefined;
					const allTasks = await this.getAllTasks(filePath);
					const filteredTasks = TaskParser.queryTasks(allTasks, query);
					return {
						jsonrpc: '2.0',
						id,
						result: {
							content: [{
								type: 'text',
								text: JSON.stringify(filteredTasks, null, 2)
							}]
						}
					};
				}

				case 'get_tasks_by_date': {
					const date = args.date as string;
					const includeOverdue = args.includeOverdue as boolean || false;
					const allTasks = await this.getAllTasks();
					const query = includeOverdue
						? `has due date\ndue before ${date} or due ${date}\nnot done`
						: `due ${date}`;
					const filteredTasks = TaskParser.queryTasks(allTasks, query);
					return {
						jsonrpc: '2.0',
						id,
						result: {
							content: [{
								type: 'text',
								text: JSON.stringify(filteredTasks, null, 2)
							}]
						}
					};
				}

				case 'add_task': {
					const description = args.description as string;
					if (!description) {
						return this.errorResponse(id, 'description is required');
					}

					const filePath = (args.filePath as string) || this.getDailyNotePath();
					const taskMarkdown = this.buildTaskMarkdown({
						description,
						dueDate: args.dueDate as string | undefined,
						scheduledDate: args.scheduledDate as string | undefined,
						startDate: args.startDate as string | undefined,
						priority: args.priority as string | undefined,
						tags: args.tags as string[] | undefined,
						recurrence: args.recurrence as string | undefined
					});

					const result = await this.addTaskToFile(filePath, taskMarkdown);
					return {
						jsonrpc: '2.0',
						id,
						result: {
							content: [{
								type: 'text',
								text: JSON.stringify(result, null, 2)
							}]
						}
					};
				}

				default:
					return this.errorResponse(id, `Unknown tool: ${name}`);
			}
		} catch (e) {
			return this.errorResponse(id, e instanceof Error ? e.message : String(e));
		}
	}

	errorResponse(id: string | number, message: string): JsonRpcResponse {
		return {
			jsonrpc: '2.0',
			id,
			error: {
				code: -32000,
				message
			}
		};
	}

	async getAllTasks(filePath?: string): Promise<Task[]> {
		const tasks: Task[] = [];

		let files: TFile[];
		if (filePath) {
			const file = this.app.vault.getAbstractFileByPath(filePath);
			files = file instanceof TFile ? [file] : [];
		} else {
			files = this.app.vault.getMarkdownFiles();
		}

		for (const file of files) {

			const content = await this.app.vault.read(file);
			const lines = content.split('\n');

			lines.forEach((line, index) => {
				const task = TaskParser.parseTaskLine(line, file.path, index + 1);
				if (task) {
					tasks.push(task);
				}
			});
		}

		return tasks;
	}
}

class TasksMcpSettingTab extends PluginSettingTab {
	plugin: TasksMcpPlugin;

	constructor(app: App, plugin: TasksMcpPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName('Server port')
			// eslint-disable-next-line obsidianmd/ui/sentence-case -- MCP is an acronym
			.setDesc('Port number for the MCP server')
			.addText(text => text
				.setPlaceholder('3789')
				.setValue(String(this.plugin.settings.port))
				.onChange(async (value) => {
					const port = parseInt(value);
					if (!isNaN(port) && port > 0 && port < 65536) {
						this.plugin.settings.port = port;
						await this.plugin.saveSettings();
					}
				}));

		new Setting(containerEl)
			.setName('Auto-start server')
			// eslint-disable-next-line obsidianmd/ui/sentence-case -- MCP is an acronym
			.setDesc('Automatically start the MCP server when the app launches')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableServer)
				.onChange(async (value) => {
					this.plugin.settings.enableServer = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Server status')
			.setDesc(this.plugin.server ? `Running on port ${this.plugin.settings.port}` : 'Not running')
			.addButton(button => button
				.setButtonText(this.plugin.server ? 'Stop server' : 'Start server')
				.onClick(() => {
					if (this.plugin.server) {
						this.plugin.stopServer();
					} else {
						this.plugin.startServer();
					}
					this.display(); // Refresh the view
				}));

		new Setting(containerEl).setName('Usage').setHeading();
		// eslint-disable-next-line obsidianmd/ui/sentence-case -- MCP is an acronym
		containerEl.createEl('p', { text: 'Add this to your MCP client configuration:' });

		const codeBlock = containerEl.createEl('pre');
		codeBlock.createEl('code', {
			text: `{
  "mcpServers": {
    "obsidian-tasks": {
      "url": "http://localhost:${this.plugin.settings.port}/mcp"
    }
  }
}`
		});

		new Setting(containerEl).setName('Query syntax').setHeading();
		// eslint-disable-next-line obsidianmd/ui/sentence-case -- "Tasks" is the plugin name
		containerEl.createEl('p', { text: 'Use query_tasks with Tasks query syntax:' });

		const queryExample = containerEl.createEl('pre');
		/* eslint-disable obsidianmd/ui/sentence-case -- code example */
		queryExample.createEl('code', {
			text: `not done
due before 2025-05-01
tag includes #work
priority is high`
		});
		/* eslint-enable obsidianmd/ui/sentence-case */
	}
}
