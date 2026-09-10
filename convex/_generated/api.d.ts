/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as chat from "../chat.js";
import type * as crons from "../crons.js";
import type * as http from "../http.js";
import type * as lib_musicAgent from "../lib/musicAgent.js";
import type * as lib_preferenceAuth from "../lib/preferenceAuth.js";
import type * as lib_preferenceExtraction from "../lib/preferenceExtraction.js";
import type * as lib_preferenceTools from "../lib/preferenceTools.js";
import type * as lib_preferenceTypes from "../lib/preferenceTypes.js";
import type * as preferenceWorkflows from "../preferenceWorkflows.js";
import type * as preferences from "../preferences.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  chat: typeof chat;
  crons: typeof crons;
  http: typeof http;
  "lib/musicAgent": typeof lib_musicAgent;
  "lib/preferenceAuth": typeof lib_preferenceAuth;
  "lib/preferenceExtraction": typeof lib_preferenceExtraction;
  "lib/preferenceTools": typeof lib_preferenceTools;
  "lib/preferenceTypes": typeof lib_preferenceTypes;
  preferenceWorkflows: typeof preferenceWorkflows;
  preferences: typeof preferences;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  agent: import("@convex-dev/agent/_generated/component.js").ComponentApi<"agent">;
  workflow: import("@convex-dev/workflow/_generated/component.js").ComponentApi<"workflow">;
  exa: import("@exalabs/convex-exa/_generated/component.js").ComponentApi<"exa">;
  staticHosting: import("@convex-dev/static-hosting/_generated/component.js").ComponentApi<"staticHosting">;
};
