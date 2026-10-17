import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { BASIS_KINDS } from '../domain/food.js';
import type { LabelImage, LabelRead, LabelReader } from './food-candidate.js';

// The 栄養成分表示 reader (S12, docs/06 2026-09-19): one call to Claude Haiku 4.5 with the photo,
// answered as JSON in a fixed schema (structured outputs), which is checked again here because a
// model's output is untrusted input (docs/03 §10). The photo is sent from memory and kept nowhere;
// no value read is logged (docs/03 §7).

/** Haiku 4.5, as decided for label reads (docs/06, 2026-09-19). */
export const LABEL_MODEL = 'claude-haiku-4-5';

const TIMEOUT_MS = 30_000;

const value = z.number().nullable();

/** What the model answers. A value the label does not print is null, never a guess. */
export const LabelAnswer = z.object({
  readable: z.boolean(),
  name: z.string().nullable(),
  brand: z.string().nullable(),
  state: z.enum(['raw', 'cooked']).nullable(),
  basisKind: z.enum(BASIS_KINDS),
  basisGrams: value,
  energyKcal: value,
  proteinG: value,
  carbG: value,
  fatG: value,
  fiberG: value,
});

const INSTRUCTIONS = `You read the nutrition facts table (栄養成分表示) on a photo of Japanese food packaging.

Answer with readable: false, and every other field null (basisKind "per_100g"), when the photo shows no nutrition facts table you can read.

Otherwise:
- basisKind is the amount the table's values are for: "per_100g" for 100 g当たり, "per_100ml" for 100 ml当たり, "per_piece" for one piece (1個, 1本, 1枚), "per_serving" for one serving (1食, 1杯), "per_package" for one package (1袋, 1箱, 1パック). basisGrams is the weight of that amount in grams when the label prints it, as in 1袋(113g)当たり, else null. For per_100g it is 100; for per_100ml it is null so the user can weigh 100 ml before saving.
- energyKcal is エネルギー in kcal. proteinG is たんぱく質, fatG is 脂質, both in grams.
- carbG is 糖質 when the label prints 糖質, else 炭水化物, in grams. fiberG is 食物繊維 in grams.
- Copy each number exactly as printed. A value the label does not print is null: never estimate, never compute one from others. A value printed as a range or as "微量" or "Tr" is 0 only for 微量 or Tr; a range is null.
- name is the product's name as printed on the package if it is in the photo, else null. brand is the maker or brand if it is in the photo, else null.
- state is "cooked" for food sold ready to eat after cooking (サラダチキン, 焼き魚), "raw" for an uncooked ingredient, null when you cannot tell.`;

export function labelReader({ apiKey }: { apiKey: string }): LabelReader {
  const client = new Anthropic({ apiKey, timeout: TIMEOUT_MS, maxRetries: 0 });
  return {
    async read(image: LabelImage): Promise<LabelRead> {
      let answer: z.infer<typeof LabelAnswer> | null;
      try {
        const response = await client.messages.parse({
          model: LABEL_MODEL,
          max_tokens: 1024,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: image.mediaType,
                    data: Buffer.from(image.data).toString('base64'),
                  },
                },
                { type: 'text', text: INSTRUCTIONS },
              ],
            },
          ],
          output_config: { format: zodOutputFormat(LabelAnswer) },
        });
        if (response.stop_reason === 'refusal') return { kind: 'unreadable' };
        answer = response.parsed_output;
      } catch {
        // Any error is the reader failing, never the photo: the photo was re-encoded on the phone
        // and its type checked here, and a spent workspace answers 400 too (docs/13 §3). Retaking
        // would spend another of the day's calls, so the user carries on by hand (docs/09 F9).
        return { kind: 'failed' };
      }
      return labelReadOf(answer);
    },
  };
}

/** The candidate in the model's answer, checked again against the schema. */
export function labelReadOf(answer: unknown): LabelRead {
  const checked = LabelAnswer.safeParse(answer);
  if (!checked.success) return { kind: 'failed' };
  const read = checked.data;
  const values = [read.energyKcal, read.proteinG, read.carbG, read.fatG, read.fiberG];
  const sane = values.every((given) => given === null || (Number.isFinite(given) && given >= 0));
  if (!read.readable || !sane || values.every((given) => given === null)) {
    return { kind: 'unreadable' };
  }
  const grams =
    read.basisKind === 'per_100g'
      ? 100
      : read.basisKind === 'per_100ml'
        ? null
        : read.basisGrams !== null && read.basisGrams > 0
          ? read.basisGrams
          : null;
  return {
    kind: 'read',
    model: LABEL_MODEL,
    candidate: {
      name: read.name?.trim() || null,
      brand: read.brand?.trim() || null,
      state: read.state,
      basis: { kind: read.basisKind, grams },
      energyKcal: read.energyKcal,
      proteinG: read.proteinG,
      carbG: read.carbG,
      fatG: read.fatG,
      fiberG: read.fiberG,
    },
  };
}
