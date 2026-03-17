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
  if (!s) return s;
  const first = s.charAt(0);
  return first.toUpperCase() + s.slice(1);
}

function randomWord(
  opts: { capitalize?: boolean; includeNumber?: boolean },
  deps: Required<Deps>,
): string {
  // "Word-like" usernames without pulling a large word list dependency.
  // Produces a pronounceable-ish token such as "cravon" or "Plenast7".
  for (let i = 0; i < 12; i++) {
    const syllables = 2 + deps.randInt(2); // 2-3
    let s = '';
    for (let j = 0; j < syllables; j++) {
      s += ONSETS[deps.randInt(ONSETS.length)] ?? 'k';
      s += VOWELS[deps.randInt(VOWELS.length)] ?? 'a';
      const coda = CODAS[deps.randInt(CODAS.length)] ?? '';
      // Avoid overly long tokens by preferring empty coda on earlier syllables.
      s += j === syllables - 1 ? coda : coda.length > 1 ? '' : coda;
    }

    if (s.length < 4 || s.length > 18) continue;
    if (opts.capitalize) s = titleCase(s);
    if (opts.includeNumber) s += String(deps.randInt(10));
    return s;
  }

  // Fallback: still deterministic with deps.randInt in tests.
  const fallback = `user${deps.randInt(1_000_000)}`;
  return opts.capitalize ? titleCase(fallback) : fallback;
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
    const baseLocal = local.split('+')[0] ?? local;
    return `${baseLocal}+${word}@${domain}`;
  }

  if (type === 'catch_all_email') {
    if (!input.domain) {
      throw new Error('domain is required for catch_all_email');
    }
    const domain = normalizeDomain(input.domain);
    return `${word}@${domain}`;
  }

  // Exhaustive check.
  const _never: never = type;
  return _never;
}
