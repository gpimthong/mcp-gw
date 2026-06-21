import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { BackendRegistry } from './backend-registry.js';
import { logger } from './logger.js';

const SEP = '__';

export class ToolAggregator {
  constructor(private registry: BackendRegistry) {}

  listAllTools(): Tool[] {
    const tools: Tool[] = [];
    for (const { name: backend, tools: backendTools } of this.registry.getAllConnected()) {
      for (const tool of backendTools) {
        tools.push({
          ...tool,
          name: `${backend}${SEP}${tool.name}`,
          description: `[${backend}] ${tool.description ?? ''}`.trimEnd(),
        });
      }
    }
    return tools;
  }

  async callTool(prefixedName: string, args: Record<string, unknown> | undefined): Promise<unknown> {
    const sepIdx = prefixedName.indexOf(SEP);
    if (sepIdx === -1) throw new Error(`Invalid tool name (missing "__" prefix): ${prefixedName}`);

    const backendName = prefixedName.slice(0, sepIdx);
    const toolName = prefixedName.slice(sepIdx + SEP.length);

    const client = this.registry.getClient(backendName);
    if (!client) throw new Error(`Backend "${backendName}" is not connected`);

    logger.log({
      level: 'info',
      type: 'tool_call',
      backend: backendName,
      tool: toolName,
      message: `→ ${backendName}::${toolName}`,
      data: args,
    });

    const t0 = Date.now();
    try {
      const result = await client.callTool({ name: toolName, arguments: args });
      const durationMs = Date.now() - t0;
      logger.log({
        level: result.isError ? 'warn' : 'info',
        type: 'tool_result',
        backend: backendName,
        tool: toolName,
        durationMs,
        status: result.isError ? 'error' : 'ok',
        message: `← ${backendName}::${toolName} ${result.isError ? 'ERR' : 'OK'} ${durationMs}ms`,
      });
      return result;
    } catch (err) {
      const durationMs = Date.now() - t0;
      const msg = err instanceof Error ? err.message : String(err);
      logger.log({
        level: 'error',
        type: 'tool_result',
        backend: backendName,
        tool: toolName,
        durationMs,
        status: 'error',
        message: `← ${backendName}::${toolName} THROW ${durationMs}ms: ${msg}`,
      });
      throw err;
    }
  }
}
