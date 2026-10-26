/**
 * Base Tool Interface
 * 
 * Tools are capabilities that agents can use to interact with external systems:
 * - Search knowledge base
 * - Query code repositories
 * - Fetch documentation
 * - Execute commands
 */

/** Tool parameter definition */
export interface ToolParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  required: boolean;
  default?: unknown;
}

/** Tool execution result */
export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

/** Base tool interface */
export interface Tool {
  /** Unique tool name */
  name: string;
  
  /** Human-readable description for the LLM */
  description: string;
  
  /** Parameters the tool accepts */
  parameters: ToolParameter[];
  
  /** Execute the tool with given arguments */
  execute(args: Record<string, unknown>): Promise<ToolResult>;
}

/** Tool registry for managing available tools */
export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  getAll(): Tool[] {
    return Array.from(this.tools.values());
  }

  /** Generate tool descriptions for LLM prompt */
  getToolDescriptions(): string {
    const tools = this.getAll();
    if (tools.length === 0) return 'No tools available.';

    return tools.map(tool => {
      const params = tool.parameters
        .map(p => `  - ${p.name} (${p.type}${p.required ? ', required' : ''}): ${p.description}`)
        .join('\n');
      return `### ${tool.name}\n${tool.description}\nParameters:\n${params}`;
    }).join('\n\n');
  }

  /** Parse tool call from LLM output */
  parseToolCall(output: string): { toolName: string; args: Record<string, unknown> } | null {
    // Look for JSON tool call format: {"tool": "name", "args": {...}}
    const jsonMatch = output.match(/\{[\s\S]*"tool"[\s\S]*"args"[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.tool && typeof parsed.tool === 'string') {
          return { toolName: parsed.tool, args: parsed.args ?? {} };
        }
      } catch {
        // Not valid JSON
      }
    }

    // Look for markdown code block with tool call
    const codeBlockMatch = output.match(/```(?:json)?\s*\n?\{[\s\S]*"tool"[\s\S]*\}\s*\n?```/);
    if (codeBlockMatch) {
      try {
        const jsonStr = codeBlockMatch[0].replace(/```(?:json)?\s*\n?/, '').replace(/\s*\n?```/, '');
        const parsed = JSON.parse(jsonStr);
        if (parsed.tool && typeof parsed.tool === 'string') {
          return { toolName: parsed.tool, args: parsed.args ?? {} };
        }
      } catch {
        // Not valid JSON
      }
    }

    return null;
  }
}

/** Global tool registry */
export const globalToolRegistry = new ToolRegistry();
