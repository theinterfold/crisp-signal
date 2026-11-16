// Shared by the browser and the /api/pin function, so it must not import the app's config.

/** CRISP's limit (`CRISPProgram.MAX_VOTE_OPTIONS`). */
export const MAX_OPTIONS = 10

export const LIMITS = { title: 160, organisation: 80, description: 4000, option: 80 } as const

/** What a poll publishes off-chain. The on-chain E3 fixes how many options a ballot has. */
export type PollMetadata = {
  schema: 'crisp-signal/poll@1'
  title: string
  description: string
  organisation: string
  options: string[]
}

const isText = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max

/** Accepts exactly a CRISP Signal poll document within the form's limits; anything else throws. */
export function parseMetadata(value: unknown): PollMetadata {
  if (
    typeof value === 'object' &&
    value !== null &&
    'schema' in value &&
    value.schema === 'crisp-signal/poll@1' &&
    'title' in value &&
    isText(value.title, LIMITS.title) &&
    value.title.trim() !== '' &&
    'description' in value &&
    isText(value.description, LIMITS.description) &&
    'organisation' in value &&
    isText(value.organisation, LIMITS.organisation) &&
    'options' in value &&
    Array.isArray(value.options) &&
    value.options.length >= 2 &&
    value.options.length <= MAX_OPTIONS &&
    value.options.every((o: unknown) => isText(o, LIMITS.option) && o.trim() !== '')
  ) {
    return {
      schema: value.schema,
      title: value.title,
      description: value.description,
      organisation: value.organisation,
      options: value.options,
    }
  }
  throw new Error('Not a CRISP Signal poll document.')
}
