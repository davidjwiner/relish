'use node';

import { internalAction } from './_generated/server';
import { browserActionDefinition } from './components/browserbase/node';

// Components cannot run Node.js. This internal host adapter supplies the SDK runtime.
export const execute = internalAction(browserActionDefinition());
