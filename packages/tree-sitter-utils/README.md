# @aiderdesk/tree-sitter-utils

A comprehensive tree-sitter library for code analysis, symbol extraction, and repository mapping.

## Features

- 🌳 **Tree-Sitter Based**: Uses tree-sitter for accurate AST parsing
- 📦 **On-Demand WASM Loading**: Automatically downloads language WASM files when needed
- 🔍 **Symbol Extraction**: Extract functions, classes, variables, and other symbols from code
- 🗺️ **Repository Mapping**: Generate comprehensive repository maps with PageRank-based symbol ranking
- 💾 **Smart Caching**: SQLite-based caching for fast repeated analysis
- 🌐 **Multi-Language Support**: Supports 18+ programming languages out of the box

## Installation

```bash
npm install @aiderdesk/tree-sitter-utils
```

## Quick Start

### Extract Symbols from Files

```typescript
import { extractSymbols } from '@aiderdesk/tree-sitter-utils';

const symbols = await extractSymbols([
  '/path/to/file.ts',
  '/path/to/another-file.py'
]);

console.log(symbols);
// [
//   { name: 'MyClass', kind: 'def', line: 10, rel_fname: 'file.ts', ... },
//   { name: 'myFunction', kind: 'def', line: 25, rel_fname: 'file.ts', ... }
// ]
```

### Generate Repository Map

```typescript
import { getRepoMap } from '@aiderdesk/tree-sitter-utils';

const map = await getRepoMap('/path/to/project', {
  maxLines: 1000,
  excludePatterns: ['node_modules/**', 'dist/**']
});

console.log(map);
// src/index.ts:
// ├── class MyClass
// ├── function myFunction
// ...
```

### Advanced Usage with TreeSitterAnalyzer

```typescript
import { TreeSitterAnalyzer } from '@aiderdesk/tree-sitter-utils';

const analyzer = new TreeSitterAnalyzer();

// Initialize (optional - lazy initialization supported)
await analyzer.initialize();

// Get repository map
const repoMap = await analyzer.getRepoMap('/path/to/project', {
  maxLines: 500,
  mentionedFiles: new Set(['src/important.ts']),
  mentionedIdents: new Set(['ImportantClass'])
});

// Extract symbols
const symbols = await analyzer.extractSymbols(['/path/to/file.ts'], {
  useCache: true
});

// Parse single file
const parseResult = await analyzer.parseFile('/path/to/file.ts');
```

## Supported Languages

- Python
- JavaScript / JSX
- TypeScript / TSX
- Java
- Go
- Rust
- C / C++
- C#
- Ruby
- PHP
- Scala
- Dart
- OCaml / OCaml Interface
- Haskell
- Julia

## Configuration Options

### RepoMapOptions

```typescript
interface RepoMapOptions {
  root: string;                    // Root directory of the project
  files?: string[];                // Specific files to analyze (optional)
  excludePatterns?: string[];      // Glob patterns to exclude
  mentionedFiles?: Set<string>;    // Files to prioritize in ranking
  mentionedIdents?: Set<string>;   // Identifiers to prioritize
  chatFiles?: Set<string>;         // Files to exclude from output
  maxLines?: number;               // Maximum lines in output
}
```

### SymbolOptions

```typescript
interface SymbolOptions {
  useCache?: boolean;              // Use SQLite cache (default: true)
  rootDir?: string;                // Root directory for relative paths
}
```

## How It Works

1. **On-Demand WASM Loading**: When a language is first encountered, the library automatically downloads its WASM file from unpkg and caches it in `~/.cache/aiderdesk/tree-sitter/wasm/`

2. **Tree-Sitter Parsing**: Uses tree-sitter queries (`.scm` files) to extract definitions and references from source code

3. **PageRank Algorithm**: Builds a dependency graph and applies PageRank to rank symbols by importance

4. **Smart Caching**: SQLite-based caching tracks file modification times to avoid re-parsing unchanged files

## API Reference

### Convenience Functions

- `extractSymbols(filePaths: string[], options?: SymbolOptions): Promise<Symbol[]>`
- `getRepoMap(root: string, options?: RepoMapOptions): Promise<string>`

### TreeSitterAnalyzer Class

- `initialize(): Promise<void>` - Initialize the analyzer
- `getRepoMap(options: RepoMapOptions): Promise<string>` - Generate repository map
- `extractSymbols(filePaths: string[], options?: SymbolOptions): Promise<Symbol[]>` - Extract symbols
- `parseFile(filePath: string): Promise<ParseResult>` - Parse single file

## Background repository maps

The `getRepoMap` convenience function runs discovery, parsing, SQLite access, ranking, and rendering in a shared background worker. `TreeSitterAnalyzer` remains the direct, in-process API; use it only where synchronous CPU work is acceptable, such as an existing worker.

For an independently disposable service:

```typescript
import { RepoMapService } from '@aiderdesk/tree-sitter-utils';

const service = new RepoMapService();
const controller = new AbortController();
try {
  const map = await service.getRepoMap({
    root: '/absolute/path/to/task-checkout',
    maxLines: 2000,
    signal: controller.signal,
  });
} finally {
  service.dispose();
}
```

Pass the actual task checkout/worktree root, not a parent project's directory. Identical concurrent requests share a job; cancelling one subscriber does not cancel other subscribers. Abandoned active jobs terminate their worker, and idle workers expire after five minutes. Worker failures reject the request instead of performing work on the caller's thread.

File metadata is checked on every request. Unchanged snapshots reuse parsed tags, dependency analysis, and matching rendered results; persistent tags also survive worker restarts. The first complete parse of a large repository can still take substantial time, even though it no longer blocks the caller's event loop.

`TreeSitterAnalyzer` and `TreeSitterParser` also expose asynchronous `dispose()` methods to release their resources.

See [BENCHMARK.md](BENCHMARK.md) for measured results, correctness checks, reproduction commands, and limitations. These tests and benchmarks invoke generation directly without the AiderDesk extension API.

## License

MIT

### Prewarming repository analysis

`getRepoMap(root, { excludePatterns, prepareOnly: true, signal })` builds/refreshes the cached tags and dependency index in the same worker used by normal generation. It returns an empty string without ranking or rendering. A later normal request still validates the inventory and file metadata before reusing analysis and applies its own prompt-specific ranking and rendering options. Use a background-owned signal for prewarming, rather than the signal of an individual agent run.
