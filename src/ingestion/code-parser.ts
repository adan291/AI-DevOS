/**
 * Code Parser
 * 
 * Parses TypeScript/JavaScript code to extract:
 * - Classes and their methods
 * - Functions
 * - Imports/exports
 * - Comments and documentation
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

/** Extracted code entity */
export interface CodeEntity {
  type: 'class' | 'function' | 'interface' | 'type' | 'variable' | 'import';
  name: string;
  filePath: string;
  startLine: number;
  endLine: number;
  content: string;
  documentation?: string;
  metadata: {
    isExported: boolean;
    isAsync?: boolean;
    parameters?: string[];
    returnType?: string;
    extends?: string;
    implements?: string[];
    decorators?: string[];
  };
}

/** File parse result */
export interface ParseResult {
  filePath: string;
  language: 'typescript' | 'javascript';
  entities: CodeEntity[];
  imports: string[];
  exports: string[];
}

/**
 * Simple regex-based TypeScript/JavaScript parser
 * For production, use tree-sitter or TypeScript compiler API
 */
export class CodeParser {
  
  /** Parse a single file */
  parseFile(filePath: string): ParseResult | null {
    if (!fs.existsSync(filePath)) {
      return null;
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const ext = path.extname(filePath).toLowerCase();
    const language = ext === '.ts' || ext === '.tsx' ? 'typescript' : 'javascript';

    const entities: CodeEntity[] = [];
    const imports: string[] = [];
    const exports: string[] = [];
    const lines = content.split('\n');

    // Extract imports
    const importMatches = content.matchAll(/import\s+(?:{[^}]+}|\*\s+as\s+\w+|\w+)\s+from\s+['"]([^'"]+)['"]/g);
    for (const match of importMatches) {
      imports.push(match[1]);
    }

    // Extract classes
    const classRegex = /(?:\/\*\*[\s\S]*?\*\/\s*)?(export\s+)?(abstract\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([^{]+))?\s*\{/g;
    let match;
    while ((match = classRegex.exec(content)) !== null) {
      const startLine = content.slice(0, match.index).split('\n').length;
      const classContent = this.extractBlock(content, match.index + match[0].length - 1);
      const endLine = startLine + classContent.split('\n').length - 1;
      
      // Extract JSDoc comment before class
      const docMatch = content.slice(0, match.index).match(/\/\*\*[\s\S]*?\*\/\s*$/);
      
      entities.push({
        type: 'class',
        name: match[3],
        filePath,
        startLine,
        endLine,
        content: match[0] + classContent,
        documentation: docMatch ? docMatch[0].trim() : undefined,
        metadata: {
          isExported: !!match[1],
          extends: match[4],
          implements: match[5]?.split(',').map(s => s.trim()),
        },
      });

      if (match[1]) exports.push(match[3]);
    }

    // Extract functions
    const funcRegex = /(?:\/\*\*[\s\S]*?\*\/\s*)?(export\s+)?(async\s+)?function\s+(\w+)\s*\(([^)]*)\)(?:\s*:\s*([^{]+))?\s*\{/g;
    while ((match = funcRegex.exec(content)) !== null) {
      const startLine = content.slice(0, match.index).split('\n').length;
      const funcContent = this.extractBlock(content, match.index + match[0].length - 1);
      const endLine = startLine + funcContent.split('\n').length - 1;
      
      const docMatch = content.slice(0, match.index).match(/\/\*\*[\s\S]*?\*\/\s*$/);
      
      entities.push({
        type: 'function',
        name: match[3],
        filePath,
        startLine,
        endLine,
        content: match[0] + funcContent,
        documentation: docMatch ? docMatch[0].trim() : undefined,
        metadata: {
          isExported: !!match[1],
          isAsync: !!match[2],
          parameters: match[4]?.split(',').map(s => s.trim()).filter(Boolean),
          returnType: match[5]?.trim(),
        },
      });

      if (match[1]) exports.push(match[3]);
    }

    // Extract interfaces (TypeScript)
    if (language === 'typescript') {
      const interfaceRegex = /(?:\/\*\*[\s\S]*?\*\/\s*)?(export\s+)?interface\s+(\w+)(?:\s+extends\s+([^{]+))?\s*\{/g;
      while ((match = interfaceRegex.exec(content)) !== null) {
        const startLine = content.slice(0, match.index).split('\n').length;
        const interfaceContent = this.extractBlock(content, match.index + match[0].length - 1);
        const endLine = startLine + interfaceContent.split('\n').length - 1;
        
        const docMatch = content.slice(0, match.index).match(/\/\*\*[\s\S]*?\*\/\s*$/);
        
        entities.push({
          type: 'interface',
          name: match[2],
          filePath,
          startLine,
          endLine,
          content: match[0] + interfaceContent,
          documentation: docMatch ? docMatch[0].trim() : undefined,
          metadata: {
            isExported: !!match[1],
            extends: match[3]?.trim(),
          },
        });

        if (match[1]) exports.push(match[2]);
      }

      // Extract type aliases
      const typeRegex = /(?:\/\*\*[\s\S]*?\*\/\s*)?(export\s+)?type\s+(\w+)\s*=\s*([^;]+);/g;
      while ((match = typeRegex.exec(content)) !== null) {
        const startLine = content.slice(0, match.index).split('\n').length;
        
        entities.push({
          type: 'type',
          name: match[2],
          filePath,
          startLine,
          endLine: startLine,
          content: match[0],
          metadata: {
            isExported: !!match[1],
          },
        });

        if (match[1]) exports.push(match[2]);
      }
    }

    return { filePath, language, entities, imports, exports };
  }

  /** Parse all files in a directory recursively */
  parseDirectory(dirPath: string, extensions = ['.ts', '.tsx', '.js', '.jsx']): ParseResult[] {
    const results: ParseResult[] = [];
    
    const processDir = (dir: string) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        if (entry.isDirectory()) {
          // Skip node_modules, dist, etc.
          if (!['node_modules', 'dist', '.git', 'coverage'].includes(entry.name)) {
            processDir(fullPath);
          }
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (extensions.includes(ext)) {
            const result = this.parseFile(fullPath);
            if (result) {
              results.push(result);
            }
          }
        }
      }
    };

    processDir(dirPath);
    return results;
  }

  /** Extract a code block starting from an opening brace */
  private extractBlock(content: string, startIndex: number): string {
    let depth = 1;
    let i = startIndex + 1;
    
    while (i < content.length && depth > 0) {
      if (content[i] === '{') depth++;
      else if (content[i] === '}') depth--;
      i++;
    }
    
    return content.slice(startIndex, i);
  }
}

/** Factory function */
export function createCodeParser(): CodeParser {
  return new CodeParser();
}
