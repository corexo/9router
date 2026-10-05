# Findings

Both variants now use request-sized filtering; previously jev-1m imposed a 200k minimum and top-three fallback. Unknown windows previously passed. Metadata was missing on virtual model entries. Omni nineRouter entries lacked contextWindow; explicit local overrides added without changing provider credentials. No live client compaction verification or deploy performed.
