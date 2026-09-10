// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { executeBrowser } from './lib/browserbaseNode';

const mocks = vi.hoisted(() => ({
  init: vi.fn(),
  disconnect: vi.fn(),
  release: vi.fn(),
  options: vi.fn(),
  goto: vi.fn(),
  click: vi.fn(),
  fill: vi.fn(),
  innerText: vi.fn(),
  act: vi.fn(),
  observe: vi.fn(),
  extract: vi.fn(),
  locator: vi.fn(),
}));
vi.mock('@browserbasehq/sdk', () => ({
  default: class {
    static APIError = class extends Error {
      status = 500;
    };
    sessions = { update: mocks.release };
  },
}));
vi.mock('@browserbasehq/stagehand', () => ({
  Stagehand: class {
    constructor(options: unknown) {
      mocks.options(options);
    }
    init = mocks.init;
    close = mocks.disconnect;
    act = mocks.act;
    observe = mocks.observe;
    extract = mocks.extract;
    context = {
      pages: () => [
        {
          goto: mocks.goto,
          locator: mocks.locator,
          title: async () => 'Example',
          url: () => 'https://example.com',
        },
      ],
    };
  },
}));
beforeEach(() => {
  vi.resetAllMocks();
  mocks.innerText.mockResolvedValue('Page text');
  mocks.act.mockResolvedValue({ success: true, message: 'Clicked' });
  mocks.observe.mockResolvedValue([
    {
      selector: 'a',
      description: 'More information',
      method: 'click',
      arguments: [],
    },
  ]);
  mocks.extract.mockResolvedValue({ extraction: 'Relevant facts' });
  mocks.locator.mockReturnValue({
    click: mocks.click,
    fill: mocks.fill,
    innerText: mocks.innerText,
  });
});
afterEach(() => vi.useRealTimers());
const config = { apiKey: 'test-key' };

it('reconnects to the provided session and disconnects without releasing healthy sessions', async () => {
  await executeBrowser(
    config,
    'session-1',
    { operation: 'goto', url: 'https://example.com' },
    5000,
  );
  expect(
    await executeBrowser(
      config,
      'session-1',
      { operation: 'extract', instruction: 'Get facts' },
      5000,
    ),
  ).toMatchObject({ text: 'Relevant facts' });
  expect(mocks.options).toHaveBeenCalledWith(
    expect.objectContaining({
      browserbaseSessionID: 'session-1',
      keepAlive: true,
      model: 'auto',
    }),
  );
  expect(mocks.goto).toHaveBeenCalledWith('https://example.com', {
    waitUntil: 'domcontentloaded',
    timeoutMs: 5000,
  });
  expect(mocks.disconnect).toHaveBeenCalledTimes(2);
  expect(mocks.release).not.toHaveBeenCalled();
});
it('maps selector controls and strips extra observation fields', async () => {
  await executeBrowser(
    config,
    'session-1',
    { operation: 'fill', selector: '#search', value: 'music' },
    5000,
  );
  await executeBrowser(
    config,
    'session-1',
    { operation: 'click', selector: 'button' },
    5000,
  );
  expect(mocks.fill).toHaveBeenCalledWith('music');
  expect(mocks.click).toHaveBeenCalledTimes(1);
  expect(
    (
      await executeBrowser(
        config,
        'session-1',
        { operation: 'observe', instruction: 'Find a link' },
        5000,
      )
    ).actions,
  ).toEqual([{ selector: 'a', description: 'More information' }]);
});
it('caps page text and marks truncation', async () => {
  mocks.innerText.mockResolvedValue('x'.repeat(12_000));
  const result = await executeBrowser(
    config,
    'session-1',
    { operation: 'text' },
    5000,
  );
  expect(result.text).toHaveLength(8000);
  expect(result.truncated).toBe(true);
});
it('releases the remote session after a failed interaction, without retrying', async () => {
  mocks.act.mockResolvedValue({ success: false, message: 'Could not click' });
  await expect(
    executeBrowser(
      config,
      'session-1',
      { operation: 'act', instruction: 'Click link' },
      5000,
    ),
  ).rejects.toThrow('BROWSER_ACTION_FAILED');
  expect(mocks.act).toHaveBeenCalledTimes(1);
  expect(mocks.release).toHaveBeenCalledWith('session-1', {
    status: 'REQUEST_RELEASE',
  });
  expect(mocks.disconnect).toHaveBeenCalledTimes(1);
});
it('retires the remote session when an operation exceeds its deadline', async () => {
  vi.useFakeTimers();
  mocks.click.mockReturnValue(new Promise(() => {}));
  const work = executeBrowser(
    config,
    'session-1',
    { operation: 'click', selector: 'button' },
    100,
  );
  const assertion = expect(work).rejects.toThrow('BROWSER_TIMEOUT');
  await vi.advanceTimersByTimeAsync(101);
  await assertion;
  expect(mocks.release).toHaveBeenCalledTimes(1);
  expect(mocks.disconnect).toHaveBeenCalledTimes(1);
});
