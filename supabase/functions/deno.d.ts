// Type definitions for Supabase Edge Functions (Deno runtime) for IDE / TypeScript Server
// This file allows editor IntelliSense and prevents false-positive TS2304 / TS2307 errors.

interface DenoEnv {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
  has(key: string): boolean;
  delete(key: string): void;
  toObject(): Record<string, string>;
  [key: string]: any;
}

interface DenoNamespace {
  env: DenoEnv;
  serve(handler: (req: Request) => Response | Promise<Response>, options?: any): void;
  args: string[];
  [key: string]: any;
}

declare const Deno: DenoNamespace;

declare module "https://*" {
  const content: any;
  export default content;
  export const serve: any;
  export const createClient: any;
}
