// The terms that say an article is about AI at all — the shared half of every
// subject gate on this site.
//
// It is one exported list rather than a copy per domain because "is this story
// about AI?" is literally the same question in `environment` and in
// `ai-business`, and two lists answering it would be two rules that have to
// agree: adding a lab to one and not the other makes the same article on-subject
// on one counter and invisible on the other, silently. What a domain does *not*
// share is the rest of its gate — `environment` extends this with the physical
// plant (a data centre, a GPU, a training run), because a story can name the
// buildout without naming the thing being built. That part belongs to the
// domain; this part does not.
//
// The two rules `mentionsSubject` enforces, both learned on Radio-Canada's fils
// (STU-1292), decide how entries here are spelled:
//
//   - Matching is **whole-token**, so plurals are spelled out rather than left
//     to a prefix — "ai" as a substring matches aircraft, said and rain.
//   - A term carrying a capital is matched **case-sensitively**. `AI` and `IA`
//     are the terms that rule exists for: French elides — j'ai, n'ai, qu'ai —
//     and normalisation flattens every one of those to the token `ai`.
//
// Accents fold on both sides, so the French terms are written unaccented and an
// accented article still reaches them.
//
// Deliberately not a roster of labs. `mistral`, `hugging face`, `perplexity` and
// the next ten are a maintenance treadmill, and a story about any of them says
// "AI" in its body prose anyway — the gate reads 4000 characters, not a headline.
// The four names below are here because business and climate coverage routinely
// names the company where it would not name the technology: "Nvidia led the
// round", "OpenAI signed for the campus".
export const AI_SUBJECT = [
  'AI',
  'IA',
  'artificial intelligence',
  'intelligence artificielle',
  'machine learning',
  'apprentissage automatique',
  'neural network',
  'neural networks',
  'reseau de neurones',
  'reseaux de neurones',
  'llm',
  'llms',
  'large language model',
  'large language models',
  'chatbot',
  'chatbots',
  'chatgpt',
  'openai',
  'anthropic',
  'deepmind',
  'nvidia',
] as const;
