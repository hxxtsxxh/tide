// Tide research modes: one data-driven registry. Adding a mode is data, not code.
// Client-safe (no server imports). Hosts are EXACT hostnames (guards-core normalizeSourceUrl matches exactly).

export const MODE_IDS = ['general', 'technical', 'finance', 'health', 'society'] as const;
export type ModeId = (typeof MODE_IDS)[number];
/** Old boards, archives and snapshots carry no mode: they are Technical (Ripple's only behavior). */
export const LEGACY_MODE: ModeId = 'technical';
export const DEFAULT_UI_MODE: ModeId = 'general';

export type AuthorityTier = 'official' | 'academic' | 'reference' | 'survey' | 'news' | 'industry';
export const TIER_INFO: Record<AuthorityTier, { score: number; label: string }> = {
  official: { score: 95, label: 'Official statistics / central bank / intergovernmental' },
  academic: { score: 88, label: 'Peer-reviewed / academic' },
  reference: { score: 78, label: 'Reference / data' },
  survey: { score: 70, label: 'Survey / think tank' },
  news: { score: 60, label: 'News' },
  industry: { score: 45, label: 'Industry body (interested party)' },
};

/** Authority-tier hints for curated hosts (used by src/lib/perspective). */
export const HOST_TIERS: Record<string, AuthorityTier> = {
  'www.federalreserve.gov': 'official',
  'www.newyorkfed.org': 'official',
  'fred.stlouisfed.org': 'official',
  'www.stlouisfed.org': 'official',
  'www.bls.gov': 'official',
  'www.bea.gov': 'official',
  'www.census.gov': 'official',
  'www.imf.org': 'official',
  'www.worldbank.org': 'official',
  'www.oecd.org': 'official',
  'www.bis.org': 'official',
  'www.ecb.europa.eu': 'official',
  'www.who.int': 'official',
  'www.cdc.gov': 'official',
  'www.nih.gov': 'official',
  'www.nber.org': 'academic',
  'www.nature.com': 'academic',
  'arxiv.org': 'academic',
  'pubmed.ncbi.nlm.nih.gov': 'academic',
  'pmc.ncbi.nlm.nih.gov': 'academic',
  'news.stanford.edu': 'academic',
  'en.wikipedia.org': 'reference',
  'www.britannica.com': 'reference',
  'ourworldindata.org': 'reference',
  'www.pewresearch.org': 'survey',
  'www.gallup.com': 'survey',
  'www.brookings.edu': 'survey',
  'apnews.com': 'news',
  'www.bbc.com': 'news',
  'www.npr.org': 'news',
  'www.gold.org': 'industry',
};

const REFERENCE = ['en.wikipedia.org', 'www.britannica.com'];
const NEWS = ['apnews.com', 'www.bbc.com', 'www.npr.org'];
const FINANCE = ['www.federalreserve.gov', 'www.newyorkfed.org', 'fred.stlouisfed.org', 'www.stlouisfed.org', 'www.bls.gov', 'www.bea.gov', 'www.census.gov', 'www.nber.org', 'www.imf.org', 'www.worldbank.org', 'www.oecd.org', 'www.bis.org', 'www.ecb.europa.eu', 'www.gold.org', ...REFERENCE, ...NEWS];
const HEALTH = ['www.who.int', 'www.cdc.gov', 'www.nih.gov', 'pubmed.ncbi.nlm.nih.gov', 'pmc.ncbi.nlm.nih.gov', 'www.nature.com', 'arxiv.org', 'ourworldindata.org', ...REFERENCE, ...NEWS];
const SOCIETY = ['www.pewresearch.org', 'www.gallup.com', 'www.brookings.edu', 'news.stanford.edu', 'www.nber.org', 'www.bls.gov', 'www.oecd.org', 'ourworldindata.org', ...REFERENCE, ...NEWS];

export type Example = { label: string; title: string; question: string; urls: string[]; requirements: string };
export type ModeSpec = {
  id: ModeId;
  label: string;
  description: string;
  helper: string;
  requirementsLabel: string;
  requirementsPlaceholder: string;
  /** null = the server's technical policy (RIPPLE_SOURCE_HOSTS or DEFAULT_SOURCE_HOSTS). */
  hosts: readonly string[] | null;
  examples: Example[];
};

const YIELD: Example = {
  label: 'Yield curve → recession',
  title: 'Yield curve and recessions',
  question: 'Does an inverted yield curve reliably predict a U.S. recession within 12 months?',
  urls: ['https://en.wikipedia.org/wiki/Inverted_yield_curve', 'https://www.newyorkfed.org/research/capital_markets/ycfaq', 'https://en.wikipedia.org/wiki/Yield_curve'],
  requirements: 'Judge reliability since 1970; note lead times and false signals.',
};
const GOLD: Example = {
  label: 'Gold as a safe haven',
  title: 'Gold in market crashes',
  question: 'Is gold always a safe haven during financial market crashes?',
  urls: ['https://en.wikipedia.org/wiki/Gold_as_an_investment', 'https://www.gold.org/goldhub/research/relevance-of-gold-as-a-strategic-asset'],
  requirements: 'Consider 2008, March 2020 and other equity crashes.',
};
const REMOTE: Example = {
  label: 'Remote work productivity',
  title: 'Remote work and productivity',
  question: 'Does remote work improve employee productivity?',
  urls: ['https://en.wikipedia.org/wiki/Remote_work', 'https://www.nber.org/papers/w30866', 'https://www.gallup.com/workplace/398135/advantages-challenges-hybrid-work.aspx'],
  requirements: 'Distinguish fully remote from hybrid work.',
};
const COFFEE: Example = {
  label: 'Coffee and type 2 diabetes',
  title: 'Coffee and diabetes risk',
  question: 'Does moderate coffee consumption lower the risk of type 2 diabetes?',
  urls: ['https://en.wikipedia.org/wiki/Health_effects_of_coffee'],
  requirements: 'Observational vs. trial evidence; what counts as moderate.',
};

export const MODES: ModeSpec[] = [
  {
    id: 'general',
    label: 'General',
    description: 'Open questions across curated sources',
    helper: 'Ask an open empirical question. Tide reads curated public sources, keeps only quote-verified facts, and shows how the answer depends on whom you trust.',
    requirementsLabel: 'Context or criteria (optional)',
    requirementsPlaceholder: 'e.g. Time period, region, or what would count as “reliable”.',
    hosts: [...new Set([...FINANCE, ...HEALTH, ...SOCIETY])],
    examples: [YIELD, GOLD, REMOTE],
  },
  {
    id: 'technical',
    label: 'Technical',
    description: 'Software and developer documentation',
    helper: 'Connect public documentation to facts and decisions. When a page or requirement changes, see which answers need another look.',
    requirementsLabel: 'Your requirements',
    requirementsPlaceholder: 'e.g. I need to process three source URLs at a time.',
    hosts: null,
    examples: [
      {
        label: 'Page fetching',
        title: 'My page-ingestion research',
        question: 'Can I safely fetch public pages in batches of three and recover from individual page failures?',
        urls: ['https://docs.telem.ai/api/', 'https://docs.telem.ai/resources/fetch-best-practices/'],
        requirements: 'I need to process three source URLs at a time.',
      },
    ],
  },
  {
    id: 'finance',
    label: 'Finance & Economics',
    description: 'Central banks, statistics agencies, research',
    helper: 'Weigh central-bank, statistics-agency, research and reference sources on a markets or economics question.',
    requirementsLabel: 'Context or criteria (optional)',
    requirementsPlaceholder: 'e.g. U.S. only, since 1970.',
    hosts: FINANCE,
    examples: [YIELD, GOLD],
  },
  {
    id: 'health',
    label: 'Health & Science',
    description: 'Public-health agencies, journals, reference',
    helper: 'Weigh public-health agencies, peer-reviewed literature and reference sources. Not medical advice.',
    requirementsLabel: 'Context or criteria (optional)',
    requirementsPlaceholder: 'e.g. Adults; randomized trials preferred.',
    hosts: HEALTH,
    examples: [COFFEE],
  },
  {
    id: 'society',
    label: 'Work & Society',
    description: 'Surveys, think tanks, labor research',
    helper: 'Weigh surveys, labor statistics, think-tank and academic research on a work or society question.',
    requirementsLabel: 'Context or criteria (optional)',
    requirementsPlaceholder: 'e.g. Knowledge workers in the U.S.',
    hosts: SOCIETY,
    examples: [REMOTE],
  },
];

export const modeOf = (id: string | undefined | null): ModeSpec => MODES.find((m) => m.id === id) ?? MODES.find((m) => m.id === LEGACY_MODE)!;
export const isModeId = (id: unknown): id is ModeId => typeof id === 'string' && (MODE_IDS as readonly string[]).includes(id);

/** Effective exact-host list for a mode. Technical uses the server's configured policy. */
export function hostsForMode(id: string | undefined, technicalHosts: readonly string[], overrides: Partial<Record<ModeId, string[]>> = {}): string[] {
  const m = modeOf(id);
  return [...(overrides[m.id] ?? m.hosts ?? technicalHosts)];
}
