# Skynet counter — invariants

- The keyword list is closed. Nine keywords, fixed weights. Nothing is added at
  runtime, and a keyword outside the list is an error, never a judgement call.
- A score must be traceable to a literal keyword match in the article's own title
  or summary. No inference from the topic, the outlet, or the headline's tone.
- Most articles score 0. A run where everything scored above zero is a bug in the
  scoring, not a busy news day.
- The counter is derived, never asserted. It is recomputed from the persisted
  article history on every run; no stage writes a counter value it reasoned about.
