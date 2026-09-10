import { components, internal } from '../_generated/api';
import { Browserbase } from '../components/browserbase';

export const browser: Browserbase = new Browserbase(
  components.browserbase,
  internal.browserActions.execute,
);
