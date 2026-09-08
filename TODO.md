# TODO

Two rules stand over every item: the interface stays quiet and projects stay
optional, and a feature ships as a whole workflow or not at all.

## Done since 0339b9a (2026-09-08)

- [x] Edit sent messages as new branches, preserving the originals. A pencil on the bubble; what is sent goes beside the original under the same parent, quoting the same cards. Ghost chats too.
- [x] Per-chat thinking, applied honestly per model. The composer's options mark (sliders, before the model) holds a switch that defaults to the instance setting and travels with the tab. Claude models are asked; OpenAI-style providers take no such flag, and the plate says so and only keeps the reply's headroom.
- [x] Show unknown context limits explicitly. The same plate names the model's declared window or says it is not declared and that the instance budget applies.
- [x] Paginate conversation history beyond the first 200. Keyset pages on `GET /api/conversations?before=&beforeId=`; "Show older" at the foot of the Chats list.
- [x] The composer's row: a borderless "+" (attach: the corpus library today, files later) and the options mark before the model selector; the bordered Sources pill is gone.
- [x] Generation belongs to the server, not the request. A `Job` (`src/lib/server/runs.ts`) writes the response, numbers every event and keeps them, checkpoints the row once a second; `POST /api/chat` starts one and listens; `GET /api/chat/stream?conversationId=&after=` listens again, from a snapshot or from the last event heard. A saved response survives a reload, a closed tab and a dropped connection; the tab listens again by itself. Stopping is the Stop button alone. A restart still marks half-written rows interrupted, in words, and resubmits nothing. Ghost chats stay bound to their request by design.

- [x] The response clock is a setting (Settings › Chat › Response time, ten minutes by default, up to three hours), and the sentence that says a response ran out names it.
- [x] Statistics under messages (Settings › Chat › Statistics): the request's size under yours, the reply's tokens, speed and time under the model's; the provider's counts where it reports them (`stream_options.include_usage`, asked once and dropped for a server that refuses it; Anthropic's `message_start`/`message_delta` usage), estimates marked with a tilde where it does not. Stored on the assistant row (schema v5).
- [x] Settings › Usage: totals and a by-model table for today, 7 days, 30 days, all time.

## Next release: dependable daily chat

- [ ] Say in the tab, quietly, that a response is being followed rather than written here, when it was started elsewhere.
- [ ] Per-provider thinking controls where a provider has a real one (OpenRouter's `reasoning`, DeepSeek's `thinking`, vLLM's `chat_template_kwargs`), declared per slot in the environment rather than guessed from a model's name.
- [ ] Add model-aware token budgets: a discovered model's window is unknown today; let the operator declare it once per provider as a default, not only per model.
- [ ] A matching `(updated_at, id)` index once the archive is large enough to notice.
- [ ] Connection diagnostics, if a concrete failure calls for more than Settings › Models already says. No silent provider switching, no automatic paid test requests.

## Documents and attachments

The "+" in the composer is the door; the library is the first thing behind it.

- [ ] Add canonical assets with provenance, MIME type, size, hash, bounded storage, and deletion.
- [ ] Support text, Markdown, and PDF attachments.
- [ ] Make extracted text inspectable before sending it to a model.
- [ ] Allow explicit selection of document content included in a request.
- [ ] Disclose external destinations before sending attached content, as the library disclosure does now.
- [ ] Cite identifiable document passages in answers.
- [ ] Include small documents whole; add chunking and retrieval for larger material.
- [ ] Keep corpus an optional library connector, separate from amalgam's own document storage and retrieval.

## Web research

- [ ] Add explicit Search web and Read page capabilities independent of the selected chat provider.
- [ ] Show searches, fetched pages, and source excerpts.
- [ ] Back citations with stored excerpts.
- [ ] Disclose external destinations.
- [ ] Treat fetched content as untrusted input and protect server-side fetching.
- [ ] Bound research requests, execution time, and spending.
- [ ] Start with user-triggered research rather than autonomous agents.

## Creation

- [ ] Add a document/artifact editor with version history and export.
- [ ] Add image generation using the shared asset and job infrastructure.
- [ ] Add audio transcription using the shared asset and job infrastructure.
- [ ] Add runtime integrations after durable jobs and approval boundaries are established.
- [ ] Add real-time voice with an appropriate real-time transport.

## Quality and operations

- [ ] Expand regression coverage for branch isolation and context trimming.
- [ ] Test restart recovery end to end (the startup pass over half-written rows) and more provider failure shapes; cancellation and reconnects are covered.
- [ ] Exercise database backup restoration.

## Deferred

- Multi-user hosting until tenant ownership, authorization, quotas, and credential security are implemented and reviewed.
- Plugin marketplace until concrete integration needs justify it.
- Autonomous agents until daily chat, assets, durable jobs, and bounded research are dependable.
