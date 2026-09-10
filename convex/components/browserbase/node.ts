'use node';

import BrowserbaseSDK from '@browserbasehq/sdk';
import { Stagehand } from '@browserbasehq/stagehand';
import { v } from 'convex/values';
import {
  MAX_TEXT,
  OPERATION_TIMEOUT_MS,
  operationValidator,
  resultValidator,
  safeBrowserError,
  validateOperation,
  type BrowserOperation,
  type BrowserResult,
} from './component/validation';

type Config = { apiKey: string; projectId?: string };

export async function deadline<T>(
  work: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('BROWSER_TIMEOUT')),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function sdk(config: Config) {
  return new BrowserbaseSDK({
    apiKey: config.apiKey,
    maxRetries: 0,
    timeout: 5000,
  });
}

export async function closeBrowser(
  config: Config,
  sessionId: string,
): Promise<void> {
  try {
    await sdk(config).sessions.update(sessionId, {
      ...(config.projectId ? { projectId: config.projectId } : {}),
      status: 'REQUEST_RELEASE',
    });
  } catch (error) {
    if (error instanceof BrowserbaseSDK.APIError && error.status === 404)
      return;
    throw error;
  }
}

export async function executeBrowser(
  config: Config,
  sessionId: string,
  operation: BrowserOperation,
  timeoutMs: number,
): Promise<BrowserResult> {
  const stagehand = new Stagehand({
    env: 'BROWSERBASE',
    apiKey: config.apiKey,
    projectId: config.projectId,
    browserbaseSessionID: sessionId,
    keepAlive: true,
    model: 'auto',
    verbose: 0,
    disablePino: true,
    logger: () => {},
    logInferenceToFile: false,
    selfHeal: false,
  });
  let finished = false;
  const work = async (): Promise<BrowserResult> => {
    await stagehand.init();
    if (finished) {
      await stagehand.close();
      throw new Error('BROWSER_TIMEOUT');
    }
    const page = stagehand.context.pages()[0];
    if (!page) throw new Error('BROWSER_SESSION_UNAVAILABLE');
    let text = '';
    let actions: BrowserResult['actions'] = [];
    switch (operation.operation) {
      case 'goto':
        await page.goto(operation.url, {
          waitUntil: 'domcontentloaded',
          timeoutMs,
        });
        break;
      case 'click':
        await page.locator(operation.selector).click();
        break;
      case 'fill':
        await page.locator(operation.selector).fill(operation.value);
        break;
      case 'text':
        text = await page.locator('body').innerText();
        break;
      case 'act': {
        const result = await stagehand.act(operation.instruction, {
          page,
          timeout: timeoutMs,
        });
        if (!result.success) throw new Error('BROWSER_ACTION_FAILED');
        text = result.message;
        break;
      }
      case 'observe':
        actions = await stagehand.observe(operation.instruction, {
          page,
          timeout: timeoutMs,
        });
        break;
      case 'extract': {
        const result = await stagehand.extract(operation.instruction, {
          page,
          timeout: timeoutMs,
        });
        text = result.extraction;
        break;
      }
    }
    return {
      url: page.url().slice(0, 4000),
      title: (await page.title()).slice(0, 300),
      text: text.slice(0, MAX_TEXT),
      truncated:
        text.length > MAX_TEXT ||
        actions.length > 10 ||
        actions.some(
          (a) => a.selector.length > 1000 || a.description.length > 300,
        ),
      actions: actions.slice(0, 10).map((a) => ({
        selector: a.selector.slice(0, 1000),
        description: a.description.slice(0, 300),
      })),
    };
  };
  try {
    return await deadline(work(), Math.min(timeoutMs, OPERATION_TIMEOUT_MS));
  } catch (error) {
    // An operation may still be running remotely. Retire this session instead of retrying.
    finished = true;
    await closeBrowser(config, sessionId).catch(() => {});
    throw error;
  } finally {
    finished = true;
    // With v3 keepAlive this disconnects CDP, without ending a healthy remote session.
    await deadline(stagehand.close(), 5000).catch(() => {});
  }
}

export function browserActionDefinition(
  execute: typeof executeBrowser = executeBrowser,
) {
  return {
    args: {
      sessionId: v.string(),
      operation: operationValidator,
      timeoutMs: v.number(),
    },
    returns: resultValidator,
    handler: async (
      _ctx: unknown,
      args: {
        sessionId: string;
        operation: BrowserOperation;
        timeoutMs: number;
      },
    ) => {
      try {
        const apiKey = process.env.BROWSERBASE_API_KEY;
        if (!apiKey) throw new Error('BROWSER_NOT_CONFIGURED');
        if (
          !args.sessionId ||
          !Number.isFinite(args.timeoutMs) ||
          args.timeoutMs <= 0
        )
          throw new Error('BROWSER_INVALID_INPUT');
        return await execute(
          { apiKey, projectId: process.env.BROWSERBASE_PROJECT_ID },
          args.sessionId,
          validateOperation(args.operation),
          Math.min(args.timeoutMs, OPERATION_TIMEOUT_MS),
        );
      } catch (error) {
        throw new Error(safeBrowserError(error));
      }
    },
  };
}
