import { describe, expect, it } from 'vitest';
import { tasteReviewOutputFor } from './tasteReviewAgent';

const validOutput = {
  overview: 'You enjoy melodic electronic music.',
  overviewEvidenceIds: ['p1'],
  drawnTo: [
    {
      text: 'Melodic electronic music.',
      evidenceIds: ['p1', 'p2'],
    },
  ],
  avoids: [],
  nuances: [],
  evidenceLevel: 'limited' as const,
};

describe('taste review output schema', () => {
  it('accepts only the evidence aliases supplied for this review', () => {
    const schema = tasteReviewOutputFor(['p1', 'p2']);

    expect(schema.parse(validOutput)).toEqual(validOutput);
    expect(
      schema.safeParse({
        ...validOutput,
        overviewEvidenceIds: ['p1 with extra commentary'],
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        ...validOutput,
        drawnTo: [
          {
            ...validOutput.drawnTo[0],
            evidenceIds: ['p3'],
          },
        ],
      }).success,
    ).toBe(false);
  });
});
