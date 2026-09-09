// Keep the component's test-only TypeScript sources out of application typechecking.
// Workpool 0.4.11's test entry imports a source file with an unused local.
import workflowTest from '@convex-dev/workflow/test';
export const registerWorkflow = (t) => workflowTest.register(t);
