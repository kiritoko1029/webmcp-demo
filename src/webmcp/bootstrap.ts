import { initializeWebModelContext } from '@mcp-b/global';
import type { WebMCP } from 'webmcp-types';

declare global {
  interface Navigator {
    modelContext?: WebMCP.ModelContext;
  }
  interface Window {
    webmcpClient?: {
      listTools: () => Promise<WebMCP.RegisteredTool[]>;
      call: (toolName: string, input?: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown>;
    };
  }
}

let bootstrapped = false;
let runtimeMode: 'native+mcpb' | 'polyfill+mcpb' | 'unavailable' = 'unavailable';

export function bootstrapWebMCP(): {
  context: WebMCP.ModelContext | undefined;
  mode: typeof runtimeMode;
} {
  if (bootstrapped) {
    return { context: document.modelContext, mode: runtimeMode };
  }
  bootstrapped = true;

  const hadNativeContext = typeof document !== 'undefined' && 'modelContext' in document && Boolean(document.modelContext);

  try {
    initializeWebModelContext({
      autoInitialize: true,
    });
  } catch (err) {
    console.warn('[WebMCP] initializeWebModelContext warning:', err);
  }

  const context = typeof document !== 'undefined' ? document.modelContext : undefined;
  if (context) {
    runtimeMode = hadNativeContext ? 'native+mcpb' : 'polyfill+mcpb';

    // Provide backwards-compatible alias on navigator.modelContext for older scripts/tutorials
    if (typeof navigator !== 'undefined' && !('modelContext' in navigator)) {
      try {
        Object.defineProperty(navigator, 'modelContext', {
          get: () => document.modelContext,
          configurable: true,
        });
      } catch {
        // Ignore if navigator is non-configurable in strict environments
      }
    }

    // Convenience DevTools console helper wrapping standard document.modelContext
    window.webmcpClient = {
      async listTools() {
        const mc = document.modelContext;
        if (!mc) throw new Error('document.modelContext is unavailable');
        return await mc.getTools();
      },
      async call(toolName: string, input: Record<string, unknown> = {}, signal?: AbortSignal) {
        const mc = document.modelContext;
        if (!mc) throw new Error('document.modelContext is unavailable');
        const tools = await mc.getTools();
        const target = tools.find((t) => t.name === toolName);
        if (!target) {
          throw new Error(`Tool "${toolName}" not found in document.modelContext.getTools()`);
        }
        const raw = await mc.executeTool(target, input, signal ? { signal } : undefined);
        try {
          return JSON.parse(raw);
        } catch {
          return raw;
        }
      },
    };
  }

  return { context, mode: runtimeMode };
}

export function getWebMCPRuntimeMode() {
  return runtimeMode;
}
