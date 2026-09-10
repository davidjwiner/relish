# Step 4: Taste Profile

**Status: proposed design and implementation plan.** This document covers the saved-preferences view at `/taste-profile`. Background saving is specified separately in [Background preference extraction](./conversation-preference-extraction.md).

## Product goal

Give users a clear answer to “What does Relish know about my music taste?” They should be able to recognize their saved artists and tracks, distinguish likes from dislikes, and see their own reasons where available. The page should feel like a personal music collection that grows through conversation.

The first release shows explicit saved preferences. Generated taste summaries, genre groupings, and connections between artists come later, once there is enough reliable evidence. Liking one track must never imply liking its artist or the artist's entire catalog.

## Current state and scope

- The authenticated route exists but renders `FeaturePage` with “Coming soon.”
- `preferences.list` already returns an authenticated, paginated list with a display name, target, reaction, optional reason, and timestamps. It caps each page at 50 records.
- Preferences refer to either artists or tracks. Track names include version and artist information when available. There is no genre metadata or generated summary in the schema.
- Chat currently reads preferences but does not write them. Background extraction, evidence provenance, and removal tombstones are planned work, not existing capabilities.

The MVP is a read-only collection with server-side filters and incremental loading. It introduces no preference-writing tools, direct editing, model calls, or music research. It can be built and verified with fixture data before extraction ships, but the complete conversation-to-profile experience depends on extraction being enabled.

## Page design

Keep the existing app shell, navigation, Avenir typography, paper background, ink text, and lime accent. Use a centered content column around 960px wide, with white rows, subtle borders, and generous spacing. Use music icons as placeholders; artwork is not required.

```text
Taste Profile                              [Talk about music]
The artists and tracks you've shared a preference for.

Reaction   [All]  [Likes]  [Dislikes]
Type       [All music]  [Artists]  [Tracks]

Saved preferences                          Recently added

[track]  Stick Season                                Like
         Noah Kahan · Track
         Why you like it: “I love the storytelling.”
         Added Sep 10, 2026

[artist] Nora En Pure                                Like
         Artist
         Added Sep 9, 2026

                         [Load more]
```

The examples illustrate layout, not seeded production preferences. Default both filters to All so dislikes remain visible. Use “Recently added” because the existing list orders by record creation; do not label this “Recently updated.” There is no sort menu in the MVP.

### Preference rows

Each row shows:

| Element  | Behavior                                                                                                                              |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Target   | Artist name, or track title with version and artist names. Keep track and artist preferences separate.                                |
| Type     | Visible “Artist” or “Track” label with a decorative icon.                                                                             |
| Reaction | Text badge: “Like” or “Dislike.” Use a neutral treatment for dislikes; never communicate reaction through color alone.                |
| Reason   | “Why you like it” or “Why you dislike it,” followed by the saved user reason. Omit the block if absent; never generate a replacement. |
| Date     | “Added” using `createdAt` in the user's locale. Show “Updated” as secondary detail only when `updatedAt` differs.                     |

Render names and reasons as plain text. Wrap long names and keep full reasons available through an accessible “Show more” control when they exceed three lines. Rows are not clickable without a real destination. Do not add playback, external links, confidence scores, or decorative percentages.

Reasons may use quotation styling only when the saving contract guarantees the user's exact words. Legacy reasons without that guarantee use plain text. Missing artist or track records use the existing “Unknown artist” / “Unknown track” fallback and preserve the preference's reaction and reason.

### Filters and navigation

Use two independent groups of labeled toggle buttons: reaction (All, Likes, Dislikes) and type (All music, Artists, Tracks). Persist selection in URL parameters, for example `/taste-profile?reaction=like&type=track`, so back navigation restores the view. Invalid values resolve to All.

Changing either filter starts a fresh paginated subscription. Filter on the server before pagination; filtering only loaded rows would hide valid matches later in the collection. Request 30 rows initially and 30 more per “Load more” action. Disable the button during loading and remove it when exhausted. Avoid total counts until an accurate, bounded count implementation is needed; a loaded page is not the full collection.

“Talk about music” opens `/chat`. It does not send a message or modify an existing draft. Search, alphabetical sorting, and grouping are deferred until collection size warrants them.

### Responsive behavior and accessibility

On mobile, stack the header action beneath the introduction, allow filters to wrap, and place badges alongside or below the name without clipping. Keep a single column at every width. Use semantic headings and list markup, `aria-pressed` on filter buttons, visible focus states, and comfortably sized touch targets. Announce loading and result changes politely without reading the entire collection. Loading additional rows must retain focus on the initiating control or move it predictably if that control disappears.

## Empty, loading, and failure states

| State                         | Presentation                                                                                                                                            |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First load                    | Row skeletons with an accessible loading label; do not flash an empty state.                                                                            |
| No saved preferences          | “Your taste has a story.” / “Your saved artist and track preferences will appear here.” Show “Talk about music.”                                        |
| Extraction enabled            | Add quiet explanatory copy: “Preferences from your conversations may take a few minutes to appear.” This is an expectation, not a completion guarantee. |
| Filters match nothing         | “No preferences match these filters.” Provide “Clear filters”; do not imply the whole profile is empty.                                                 |
| Initial query failure         | “We couldn't load your taste profile.” Provide a retry that reestablishes the query.                                                                    |
| Connection lost after loading | Keep available rows visible with a small reconnecting notice; do not present stale data as freshly synchronized.                                        |
| Loading more                  | Keep existing rows and show a pending state on “Load more.” Preserve them if loading fails and allow retry.                                             |

Use generic no-results copy whenever filters are active, avoiding a separate full-collection query just to choose empty-state wording. Auth expiration follows the existing auth boundary. Never show another account's cached rows after sign-out or account change.

Subscribe to persisted preferences so newly committed extraction results appear automatically. Do not optimistically insert preferences from chat text, poll workflow status, display extraction banners, or claim that processing is complete. A removed preference must disappear once tombstones are supported. The page is a view of current preferences, not an audit history of every change.

## Data and API plan

Add a dedicated `preferences.listProfile` query so the chat-facing `preferences.list` contract stays stable. Reuse ownership and target-description helpers where appropriate. The proposed query accepts pagination options plus optional reaction and target-kind filters; it derives the user from authentication and never accepts a caller-selected user ID.

Return the normal pagination envelope and a validated presentation shape: preference ID, target kind, title, artist names and optional track version, reaction, optional reason, `createdAt`, and `updatedAt`. Resolve target metadata only for the bounded page. Do not return internal workflow fields or load complete transcripts.

Implement indexed access for each filter combination: user; user/reaction; user/target kind; user/reaction/target kind. Preserve creation-descending ordering. Verify that the discriminated target's kind can serve as the indexed field with the installed Convex version; if necessary, introduce a validated, backfilled top-level kind field. Do not scan the entire user collection to serve a filtered page.

Coordinate with the extraction schema before implementation. If tombstones have landed, include active-state filtering in the query's index strategy and omit removed records before pagination. Update the shared normal-read behavior at that integration point so neither chat nor the profile exposes tombstones. Existing records need an explicit migration/default policy; missing new fields must not silently hide legacy preferences.

Source-conversation links are a follow-up. The current `originatingMessageId` alone is insufficient to construct a reliable thread URL. Once extraction adds source thread/message provenance, an ownership-checked link can open `/chat/:threadId`. Exact-message scrolling requires additional chat support. If the source was deleted or is unavailable, retain the saved preference and omit the link.

## Implementation plan

1. **Define the read contract.** Add the profile query, result validator, necessary indexes, and any migration required by the extraction schema. Cover ownership, filter combinations, ordering, and pagination with backend tests. Keep normal chat reads compatible.
2. **Build the collection.** Create `src/pages/TasteProfilePage.tsx` and focused components under `src/taste/` for filters and rows. Replace only the Taste Profile placeholder route. Connect URL filters and a reactive paginated query; reuse existing styling and recovery patterns.
3. **Finish interaction states.** Implement empty, loading, retry, disconnected, and load-more behavior; long-reason disclosure; responsive layouts; and keyboard/screen-reader behavior. Use fixture data for likes, dislikes, artists, tracks, versions, and missing metadata.
4. **Integrate background saving.** Once extraction is available, verify chat-to-profile updates, reaction changes, removals, and legacy records. Enable the eventual-consistency explanation with the extraction rollout. Keep all extraction work out of the page's read path.
5. **Validate and release.** Run the repository's tests, lint, format check, and build after implementation. Review the page at mobile and desktop sizes and verify the actual authenticated flow before release.

The first three steps can ship as the saved-preferences viewer. Step four is required before presenting conversation-driven population as available. This document does not enable extraction or change runtime behavior.

## Acceptance criteria

- Only the signed-in user's active saved preferences are visible; unauthenticated requests fail and cross-account data never appears.
- Artist and track likes/dislikes are represented faithfully, including track versions and optional reasons. A track like does not create an artist like.
- All six individual filter choices and their combinations work across multiple pages, including a match beyond the first unfiltered page. Filters reset pagination and survive back navigation.
- Creation ordering, missing-target fallbacks, long names/reasons, and empty collections display correctly without fabricated metadata or totals.
- Loading, errors, reconnecting, and empty results are distinguishable; retry and loading more preserve usable content and keyboard access.
- When extraction is enabled, committed additions, reaction changes, and removals update the view without a manual reload or a preference-saving call from the page.
- At a 320px viewport and desktop widths, there is no horizontal overflow; filters, disclosure, and pagination work with keyboard-only navigation.

## Later iterations

After validating the collection, consider an explicitly labeled “Relish's interpretation” summary with links to supporting preferences, followed by genre/subgenre groupings. Neither should be presented as a direct user statement. A music map can build on those groupings later.

Users can remove a preference directly from its row after a confirmation prompt. The MVP removes the current record after an ownership check. Once background extraction is enabled, replace deletion with a tombstone that uses the same evidence-ordering boundary as extraction, so an older conversation batch cannot recreate a preference the user removed. Direct edits and reaction changes remain a separate follow-up.
