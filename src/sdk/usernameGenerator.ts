import { randomInt } from 'node:crypto';

export type UsernameGeneratorType =
  | 'random_word'
  | 'plus_addressed_email'
  | 'catch_all_email'
  | 'forwarded_email_alias';

export type GenerateUsernameInput = {
  type?: UsernameGeneratorType;
  capitalize?: boolean;
  includeNumber?: boolean;

  /**
   * Base email address used for plus-addressing. Example: "alice@example.com".
   */
  email?: string;

  /**
   * Domain used for catch-all addresses. Example: "example.com".
   */
  domain?: string;
};

type RandInt = (max: number) => number;

type Deps = {
  randInt?: RandInt;
};

const DEFAULT_DEPS: Required<Deps> = {
  randInt: (max) => randomInt(max),
};

const ONSETS = [
  'b',
  'c',
  'd',
  'f',
  'g',
  'h',
  'j',
  'k',
  'l',
  'm',
  'n',
  'p',
  'r',
  's',
  't',
  'v',
  'w',
  'z',
  'br',
  'cr',
  'dr',
  'fr',
  'gr',
  'pr',
  'tr',
  'ch',
  'sh',
  'st',
  'sl',
  'pl',
] as const;

const VOWELS = [
  'a',
  'e',
  'i',
  'o',
  'u',
  'ae',
  'ai',
  'ea',
  'ee',
  'ie',
  'oa',
  'oo',
  'ou',
] as const;

const CODAS = [
  '',
  'n',
  'r',
  's',
  't',
  'l',
  'm',
  'nd',
  'st',
  'rt',
  'ng',
] as const;

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function randomWord(
  opts: { capitalize?: boolean; includeNumber?: boolean },
  deps: Required<Deps>,
): string {
  // "Word-like" usernames without pulling a large word list dependency.
  // Produces a pronounceable-ish token such as "cravon" or "Plenast7".
  // With the current arrays, minimum output is 4 chars ("baba") and maximum
  // is ~14 chars, so the length check always passes on the first iteration.
  const syllables = 2 + deps.randInt(2); // 2-3
  let s = '';
  for (let j = 0; j < syllables; j++) {
    const onset = ONSETS[deps.randInt(ONSETS.length)];
    const vowel = VOWELS[deps.randInt(VOWELS.length)];
    const coda = CODAS[deps.randInt(CODAS.length)];
    s += onset;
    s += vowel;
    // Avoid overly long tokens by preferring empty coda on earlier syllables.
    if (j === syllables - 1) {
      s += coda;
    } else if (coda.length <= 1) {
      s += coda;
    }
  }

  if (opts.capitalize) s = titleCase(s);
  if (opts.includeNumber) s += String(deps.randInt(10));
  return s;
}

function parseEmail(email: string): { local: string; domain: string } {
  const trimmed = email.trim();
  const at = trimmed.indexOf('@');
  if (at <= 0 || at === trimmed.length - 1) {
    throw new Error('Invalid email address');
  }
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  return { local, domain };
}

function normalizeDomain(domain: string): string {
  const d = domain.trim().replace(/^@+/, '');
  if (!d || d.includes(' ') || d.includes('/')) {
    throw new Error('Invalid domain');
  }
  return d;
}

export function generateUsername(
  input: GenerateUsernameInput = {},
  deps?: Deps,
): string {
  const d = { ...DEFAULT_DEPS, ...deps };
  const type = input.type ?? 'random_word';

  if (type === 'forwarded_email_alias') {
    // Bitwarden UI can generate email aliases via provider integrations (e.g.
    // SimpleLogin/AnonAddy/etc). The `bw` CLI doesn't expose this today.
    throw new Error('forwarded_email_alias is not supported');
  }

  const word = randomWord(
    { capitalize: input.capitalize, includeNumber: input.includeNumber },
    d,
  );

  if (type === 'random_word') return word;

  if (type === 'plus_addressed_email') {
    if (!input.email) {
      throw new Error('email is required for plus_addressed_email');
    }
    const { local, domain } = parseEmail(input.email);
    const baseLocal = local.split('+')[0];
    return `${baseLocal}+${word}@${domain}`;
  }

  if (type === 'catch_all_email') {
    if (!input.domain) {
      throw new Error('domain is required for catch_all_email');
    }
    const domain = normalizeDomain(input.domain);
    return `${word}@${domain}`;
  }

  // Exhaustive check — TypeScript errors here if a new type is added without a handler.
  throw new Error(
    `Unsupported username generator type: ${type satisfies never}`,
  );
}
