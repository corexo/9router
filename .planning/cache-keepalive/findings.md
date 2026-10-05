# Findings

- Current worktree contains 97 staged/modified/untracked paths; do not overwrite or stage unrelated user changes.
- Keep-alive default is only 3 sessions (`settingsRepo.js`); UI/API fallback also 3.
- `getKeepAliveCandidates` ranks Top N across all active sessions before checking `probePrefix`, so unsupported/incomplete-prefix sessions occupy slots and eligible sessions are ignored.
- Session tracker allows 200 entries, while prompt prefix capture in chat handler takes only first four messages, strips non-text blocks, and is only after routing.
- Branch `9router-cache-feature` lacks current keep-alive files; no direct earlier implementation to port found.
