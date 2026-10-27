# Goals

One section per kind of person this app serves. Each check in golden.jsonl names one with `goal`.

## vibe: a listener finds tracks by the feeling they want
- **Who:** a listener who knows the moment or mood, not the track or artist.
- **They ask:** "Driving to the beach", "Girls night out", "Party at my house".
- **Gets:** Audius tracks that fit, each with artist, genre, mood and length, linking to the track on Audius.
- **Failure looks like:** results from the wrong genre or mood (sleepy lofi for "party at my house"),
  or word matches on titles instead of meaning (a track literally named "Beach" that is a dark ambient piece).
- **Coverage:** the top 50,000 Audius tracks by play count, listed, ungated and not deleted,
  from the weekly Audius database dump (audius-pgdump on S3). Refreshed weekly.
- **Must never show:** artist wallets, locations, or anything from the dump outside the public catalog
  (plays by user, notifications, keys). Unlisted, deleted or gated tracks.
- **By / kill:** _to settle_
- **Baseline (2026-10-27, Claude Sonnet, 5 questions × 5 picks; the three above plus
  "late night lofi to study to" and "dark heavy dubstep for the gym"):**
  - closed-book: **0/25** confidently on Audius. Named major-label hits (Dua Lipa, Daft Punk)
    that are mostly not on Audius.
  - web search: 25/25 audius.co URLs, but only **~6/25 single tracks with real vibe evidence**.
    The rest were judged by title alone, or were mixes, albums, playlists or profiles. audius.co
    pages don't render to a fetch (JS app), so genre, mood and BPM were unreadable.
  - Lift to aim for: single, playable tracks whose genre and mood fit, chosen by meaning, for every question.
