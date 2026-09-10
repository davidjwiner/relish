import type { TestConvex } from 'convex-test';
import type { GenericSchema, SchemaDefinition } from 'convex/server';
export declare function registerWorkflow<
  Schema extends SchemaDefinition<GenericSchema, boolean>,
>(t: TestConvex<Schema>): void;
