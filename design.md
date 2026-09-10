# What is Relish?

- Taste is an agentic web app that learns my music taste over time
- The target user is an American adult living in a coastal city (e.g., SF, NY, LA) who regularly goes to a lot of music events. Mix of genres
- The user is enough of a music enthusiast to have a large catalog of artists they know they like but they don't really understand or have the vocabulary to describe their taste
- They user struggles to discover new artists with Spotify. They also often find themselves at a loss when trying to describe _why_ they like the music they do to friends and family

# MVP features

- There should be a left nav with three features: Chat, Taste Profile, and Radar
- Chat - clicking on this should open a basic chat window (ideally using assistant-ui style interface) where they can chat back and forth with the AI model. A few example prompts users might have: "I love the first track on Nora En Pure's weekly radio show, can you add that to my taste profile" (note: will require researching it on 1001 tracklists and updating), "I just heard this Noah Kahan song Stick Season that I love, are there other artists you might recommend?"
- Taste Profile - should log a history of all the different kinds of music that the user likes. In the beginning it can just be different genres and sub-genres but over time we might build more of a map / connections between them.

- Radar - should show upcoming local music shows based on the user's taste profile.

# Constraints

- Use Convex to build this app, with Convex Auth for authentication.
- Use the Convex Agent component for conversations, messages, and agent tools.
- Use the Convex Workflow component for multi-step research and preference-update flows.
- Route model calls through the Convex LLM gateway.
- Build the frontend with React, TypeScript, Vite, React Router, and Tailwind CSS. Use pnpm with a committed lockfile and Prettier for formatting.

# Data models

Start with five application models: Users, Artists, Tracks, Preferences, and Shows. Keep relationships and scoring simple until we have tested the core experience.

## MVP application models

- **Users** - The user's app profile, including location and app settings, linked to their authentication identity.
- **Artists** - Artists the user likes or may discover. Artist identities connect music preferences to show lineups.
- **Tracks** - Individual songs linked to their artist(s). A user can like a particular track without liking everything by its artist. An optional album name on a track is sufficient initially.
- **Preferences** - A user's explicitly stated like or dislike of an artist or track. Each preference includes:
  - User reference.
  - Target artist or track reference.
  - Reaction: like or dislike.
  - Optional reason in the user's own words.
  - Optional originating chat-message reference.
  - Creation and update timestamps.
- **Shows** - Real upcoming music events, including artist lineup, date/time, venue details, location, and event link. Keep venue details directly on the show initially.

## Conversations

The Convex Agent component manages Threads and Messages. Add application-specific metadata only as needed, rather than duplicating conversation storage.

## Preferences and taste interpretations

Keep user statements distinct from AI interpretations. "I like Stick Season because of the storytelling" is a preference. "You like intimate storytelling" is an interpretation that can initially live in a generated taste-profile summary, clearly presented as an inference.

Genre and subgenre groupings can also be generated for the profile initially. We do not need a separate taste taxonomy or graph model for the MVP.

## Shows and recommendations

A Show is a real event; a Recommendation explains why that show fits a particular user. Initially, compute recommendations from the user's preferences and available shows when needed. Add persistent recommendation records later if the product needs them.

Keep show interest separate from music taste. Dismissing a show because it is on a Tuesday should not create a dislike of the artist.

# Implementation steps

1. Set up app scaffold with Convex Auth (allowing user to login and log out)
2. Create chat interface using the Convex Agent component and assistant-ui, with model calls routed through the Convex LLM gateway.
3. Add tools to the agent that allow it to search the web (using the Exa component) and create, read, update, and delete user preferences from the conversation. Use the Convex Workflow component to coordinate multi-step research and preference-update flows.
4. Add user preferences view that lets the user view their saved preferences for artists or tracks. See [Taste Profile design and implementation plan](./step-4-taste-profile.md).
5. Finally, add Radar (lets user view recommendations)
