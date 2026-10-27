// Entry point for `npx multi-google-mcp <command>`. The MCP server is loaded on its own so it never
// shares stdin with the setup prompts.
if (process.argv[2] === 'mcp') await import('./mcp');
else await import('./cli');
export {};
