import { defineSchema } from 'convex/server';
import { authTables } from '@convex-dev/auth/server';

// Conversations, messages, and streams belong to the Agent component.
export default defineSchema({ ...authTables });
