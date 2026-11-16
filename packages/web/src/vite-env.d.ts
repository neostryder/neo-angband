/// <reference types="vite/client" />

// ModuleSource publishes compiler types without the Babel type packages they reference.
declare module "@babel/traverse" {
  export type Visitor = object;
}
declare module "@babel/generator" {
  export type GeneratorOptions = object;
}
